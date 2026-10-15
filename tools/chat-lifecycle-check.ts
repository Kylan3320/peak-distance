// Offline lifecycle checks: real handlers/workspace, controlled DB/config boundaries.
// Run: npx tsx tools/chat-lifecycle-check.ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import type { ChatRecordView } from '../shared/chat';
import type { ChatPortEvent, ChatPortMessage } from '../shared/messages';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const session: Record<string, unknown> = {};
let failSessionWrite = false;
let connect!: (port: unknown) => void;
const config = { provider: 'custom', protocol: 'openai', baseUrl: 'https://example.com/v1', model: 'controlled-model', apiKey: 'disposable-key' };
const boundaries = {
  getChat: async (_id: string): Promise<ChatRecordView | null> => null,
  appendChatTurn: async (_input: unknown): Promise<unknown> => { throw Error('Unexpected submission'); },
  getAiConfig: async () => config,
  saveAssistantProgress: async (_input: unknown) => true,
  chatCompletionStream: async (_config: unknown, _messages: unknown, _options: unknown): Promise<unknown> => ({ ok: true, text: 'Answer' }),
};
const bundle = await build({
  absWorkingDir: resolve(import.meta.dirname, '..'),
  stdin: { contents: "export * from './lib/chatService'; export * from './lib/chatWorkspace'; export { emptyChat } from './shared/chat';", resolveDir: resolve(import.meta.dirname, '..') },
  bundle: true, write: false, platform: 'node', format: 'iife', globalName: 'Lifecycle',
  plugins: [{ name: 'controlled-boundaries', setup(builder) {
    builder.onResolve({ filter: /^\.\/(db|aiClient|aiTransport|panelService|vault\/sync)$/ }, args =>
      /(?:chatService|chatWorkspace)\.ts$/.test(args.importer) ? { path: args.path, namespace: 'boundary' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'boundary' }, args => {
      const stubs: Record<string, string> = {
        getVaultIdentity: '() => Promise.resolve(null)',
        getDataVaultIdentity: '() => Promise.resolve(null)',
        flushVaultWrites: '() => Promise.resolve({ committed: 0, failed: 0, skipped: 0 })',
        enqueueChatWrite: '() => Promise.resolve()',
      };
      const names = args.path === './db'
        ? ['appendChatTurn', 'clearChat', 'getChat', 'getVaultIdentity', 'getDataVaultIdentity', 'listChats', 'resetChatTurn', 'saveAssistantProgress', 'setChatRetained']
        : args.path === './vault/sync' ? ['enqueueChatWrite', 'flushVaultWrites']
        : args.path === './aiTransport' ? ['getAiConfig'] : args.path === './aiClient' ? ['chatCompletionStream'] : ['openPanel'];
      return {
        contents: names
          .map((n) => `export const ${n} = ${stubs[n] ?? `((...args) => globalThis.boundaries.${n}(...args))`};`)
          .join('\n'),
      };
    });
  } }],
});
const context = vm.createContext({
  boundaries, crypto: { randomUUID }, structuredClone, AbortController, URL, console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  browser: {
    storage: { session: {
      get: async (key: string) => ({ [key]: structuredClone(session[key]) }),
      set: async (values: Record<string, unknown>) => { if (failSessionWrite) throw Error('Session quota exceeded'); Object.assign(session, structuredClone(values)); },
      remove: async (keys: string | string[]) => { for (const key of [keys].flat()) delete session[key]; },
    }, local: { get: async () => ({ displayLanguage: 'en' }) } },
    i18n: { getUILanguage: () => 'en' },
    runtime: { id: 'controlled-extension', onConnect: { addListener: (listener: typeof connect) => { connect = listener; } } },
  },
});
vm.runInContext(bundle.outputFiles[0]!.text, context);
const api = context.Lifecycle as typeof import('../lib/chatService') & typeof import('../lib/chatWorkspace') & typeof import('../shared/chat');
const request = (windowId: number, message: Record<string, unknown>) => api.handleChatRequest({ ...message, windowId }, {}) as Promise<{ ok: boolean; chat?: ChatRecordView }>;

// A late selection must not navigate away from an already completed New action.
const selection = deferred<ChatRecordView>();
boundaries.getChat = () => selection.promise;
const staleSelection = request(1, { type: 'chatSelect', chatId: 'slow' });
await request(1, { type: 'chatNew' });
selection.resolve({ ...api.emptyChat(), id: 'slow' });
assert.equal((await staleSelection).ok, false);
assert.equal((await api.readChatEdit(1)).id, '');
assert.equal(session['chat-active:1'], '');

api.initChatService();
for (const [index, phase] of (['unchanged', 'commit', 'config', 'remove'] as const).entries()) {
  const changed = phase !== 'unchanged';
  const windowId = index + 2;
  await request(windowId, { type: 'chatNew' });
  const initial = await api.readChatEdit(windowId);
  const source = { sourceType: 'article', sourceKey: 'web:original', title: 'Original', url: 'https://example.com/original' };
  await request(windowId, { type: 'chatEnsure', chatId: '', editId: initial.editId, source,
    material: { label: 'Original', blocks: [{ id: 'p1', text: 'Original material.' }] }, quote: { blockIds: ['p1'], note: 'Original quote' } });
  await request(windowId, { type: 'chatSetDraft', chatId: '', editId: initial.editId, draft: 'Submitted question' });
  const submitted = deferred<{ chatId: string; turnId: string; requestId: string; context: ChatRecordView }>();
  const commit = deferred<unknown>();
  boundaries.appendChatTurn = async input => { submitted.resolve(input as { chatId: string; turnId: string; requestId: string; context: ChatRecordView }); return commit.promise; };
  const ack = deferred<Extract<ChatPortEvent, { type: 'chat-ack' }>>();
  const finished = deferred<void>();
  let receive!: (message: ChatPortMessage) => void;
  connect({ name: 'blc-chat', sender: { id: 'controlled-extension', tab: { windowId } },
    onMessage: { addListener: (listener: typeof receive) => { receive = listener; } },
    onDisconnect: { addListener: () => {} },
    postMessage: (event: ChatPortEvent) => { if (event.type === 'chat-ack') ack.resolve(event); if (event.type === 'chat-ev' && ['done','error'].includes(event.kind)) finished.resolve(); },
  });
  const configStarted = deferred<void>();
  const configReady = deferred<typeof config>();
  boundaries.getAiConfig = phase === 'config' ? async () => { configStarted.resolve(); return configReady.promise; } : async () => config;
  receive({ type: 'chat-send', chatId: '', editId: initial.editId, question: 'Submitted question', snapshotVersion: 1, segmentIndex: 0, quote: initial.pendingQuote });
  if (phase === 'config') {
    await configStarted.promise;
    await request(windowId, { type: 'chatSetDraft', chatId: '', editId: initial.editId, draft: 'Next unsent question' });
    configReady.resolve(config);
  }
  const accepted = await Promise.race([submitted.promise, ack.promise.then(event => { throw Error(`Submission rejected: ${event.error}`); })]);
  // A canned DB result represents only the already accepted submission.
  boundaries.getChat = async id => ({ ...structuredClone(accepted.context), id, draft: '', pendingQuote: null, messages: [{ id:'user',role:'user',turnId:accepted.turnId,text:'Submitted question',at:1,snapshotVersion:1 },{ id:'assistant',role:'assistant',turnId:accepted.turnId,requestId:accepted.requestId,text:'',at:1,state:'streaming' }], title: 'Submitted question' });
  if (changed) {
    if (phase === 'commit' || phase === 'remove') await request(windowId, { type: 'chatSetDraft', chatId: '', editId: initial.editId, draft: 'Next unsent question' });
    if (phase === 'remove') await request(windowId, { type: 'chatRemoveMaterial', chatId: '', editId: initial.editId });
    await request(windowId, { type: 'chatEnsure', chatId: '', editId: initial.editId,
      source: { ...source, sourceKey: 'web:next', title: 'Next' },
      material: { label: 'Next', blocks: [{ id: 'p1', text: 'Next unsent material.' }] }, quote: { blockIds: ['p1'], note: 'Next unsent quote' } });
  }
  commit.resolve(await boundaries.getChat(accepted.chatId));
  const timeout = setTimeout(() => ack.resolve({ type: 'chat-ack', chatId: '', ok: false, error: 'ack-timeout' }), 1000);
  assert.equal((await ack.promise).ok, true);
  clearTimeout(timeout);
  const final = await api.readChatEdit(windowId);
  assert.equal(final.id, accepted.chatId);
  assert.equal(session[`chat-active:${windowId}`], accepted.chatId);
  assert.equal(final.draft, changed ? 'Next unsent question' : '', `${phase}: preserve input added after Send`);
  assert.equal(final.pendingQuote?.note ?? null, changed ? 'Next unsent quote' : null);
  assert.equal(final.source?.title, changed ? 'Next' : 'Original');
  assert.equal((session[`chat-edit:${windowId}`] as ChatRecordView).draft, final.draft);
  assert.equal((session[`chat-edit:${windowId}`] as ChatRecordView).pendingQuote?.note ?? null, final.pendingQuote?.note ?? null);
  assert.equal(accepted.context.source?.title, 'Original');
  if (phase === 'remove') {
    assert.equal(final.activeSnapshotVersion, 2);
    assert.equal(final.snapshots.find(s => s.version === 1)?.blocks[0]?.text, 'Original material.');
  }
  await finished.promise;
}
console.log('PASS: stale navigation rejected; normal submission clears sent edits; edits during config/commit remain in workspace and session.');

function testPort(windowId: number) {
  let receive!: (message: ChatPortMessage) => void;
  let disconnect!: () => void;
  const events: ChatPortEvent[] = [];
  connect({ name: 'blc-chat', sender: { id: 'controlled-extension', tab: { windowId } },
    onMessage: { addListener: (listener: typeof receive) => { receive = listener; } },
    onDisconnect: { addListener: (listener: typeof disconnect) => { disconnect = listener; } },
    postMessage: (event: ChatPortEvent) => events.push(event) });
  return { receive, disconnect, events };
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 1500;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Expected lifecycle event');
    await new Promise(done => setTimeout(done, 5));
  }
}
let durable: ChatRecordView;
let postCommitReadFails = false;
boundaries.getAiConfig = async () => config;
boundaries.getChat = async () => {
  if (postCommitReadFails) throw Error('Controlled post-commit read failure');
  return structuredClone(durable);
};
boundaries.appendChatTurn = async input => {
  const turn = input as { chatId: string; turnId: string; requestId: string; question: string; context: ChatRecordView };
  durable = { ...structuredClone(turn.context), id: turn.chatId, messages: [
    { id: 'user', role: 'user', turnId: turn.turnId, text: turn.question, at: 1, snapshotVersion: 0 },
    { id: 'assistant', role: 'assistant', turnId: turn.turnId, requestId: turn.requestId, text: '', state: 'streaming', at: 1 },
  ] };
  return structuredClone(durable);
};
boundaries.saveAssistantProgress = async input => {
  const progress = input as { state?: 'error' | 'stopped'; text?: string };
  Object.assign(durable.messages[1]!, { state: progress.state, text: progress.text });
  return true;
};
for (const [index, failure] of ['session', 'read'].entries()) {
  const windowId = 20 + index;
  await request(windowId, { type: 'chatNew' });
  const edit = await api.readChatEdit(windowId);
  const port = testPort(windowId);
  const append = boundaries.appendChatTurn;
  boundaries.appendChatTurn = async input => {
    const result = await append(input);
    failSessionWrite = failure === 'session'; postCommitReadFails = failure === 'read';
    return result;
  };
  port.receive({ type: 'chat-send', chatId: '', editId: edit.editId, question: 'Committed question', quote: null, snapshotVersion: 0, segmentIndex: 0 });
  await until(() => port.events.some(e => e.type === 'chat-ev' && e.kind === 'error'));
  failSessionWrite = false; postCommitReadFails = false; boundaries.appendChatTurn = append;
  assert.ok(port.events.some(e => e.type === 'chat-ack' && e.ok));
  assert.equal(durable!.messages[1]!.state, 'error');
  assert.equal((await api.handleChatRequest({ type: 'chatTick', windowId }, {}) as { generating: boolean }).generating, false);
  if (failure === 'session') assert.equal((await request(windowId, { type: 'chatActive' })).chat?.messages[1]?.state, 'error');
}
console.log('PASS: post-commit session/read failures acknowledge the durable submission and clear generation with a retryable error.');

const windowId = 30;
await request(windowId, { type: 'chatNew' });
const draft = await api.readChatEdit(windowId);
const started = deferred<AbortSignal>();
boundaries.chatCompletionStream = async (_config, _messages, options) => {
  const signal = (options as { signal: AbortSignal }).signal;
  started.resolve(signal);
  return new Promise(done => signal.addEventListener('abort', () => done({ ok: false, error: 'aborted' }), { once: true }));
};
const oldPort = testPort(windowId);
oldPort.receive({ type: 'chat-send', chatId: '', editId: draft.editId, question: 'Continue across handoff', quote: null, snapshotVersion: 0, segmentIndex: 0 });
const signal = await started.promise;
oldPort.disconnect();
assert.equal(signal.aborted, false);
assert.equal((await api.handleChatRequest({ type: 'chatTick', windowId }, {}) as { generating: boolean }).generating, true);
const nextPort = testPort(windowId);
nextPort.receive({ type: 'chat-subscribe', chatId: durable!.id });
assert.ok(nextPort.events.some(e => e.type === 'chat-active' && e.active));
await api.stopWindowChats(windowId);
assert.equal(signal.aborted, true);
assert.equal(durable!.messages[1]!.state, 'stopped');
await api.removeChatWindow(windowId);
assert.equal(api.chatOperation(windowId), undefined);
assert.equal(api.ownsChatEdit(windowId, draft), false);
assert.equal(Object.keys(session).some(key => key.endsWith(`:${windowId}`)), false);
console.log('PASS: transient port loss preserves generation; confirmed workspace close stops it and destroys window state.');

const firstSnapshot: ChatRecordView['snapshots'][number] = { version:1,createdAt:1,label:'Sent',source:{sourceType:'article',sourceKey:'web:sent',title:'Sent',url:'https://example.com/sent'},blocks:[{id:'p1',text:'Sent material'}] };
durable = { ...durable!,snapshots:[firstSnapshot],activeSnapshotVersion:1,source:firstSnapshot.source,sourceKey:firstSnapshot.source.sourceKey };
durable.messages[0]!.snapshotVersion=1;
const nextSnapshot={...firstSnapshot,version:2,label:'Unsent',blocks:[{id:'p1',text:'Unsent material'}]};
await api.activateChatEdit(40,{...durable,editId:'restore-edit',snapshots:[firstSnapshot,nextSnapshot],activeSnapshotVersion:2,draft:'Unsent draft',pendingQuote:{blockIds:['p1'],note:'Unsent focus'}});
const compact=session['chat-edit:40'] as ChatRecordView;
assert.equal(compact.messages.length,0);assert.equal(compact.snapshots.length,1);assert.equal(compact.snapshots[0]!.version,2);
vm.runInContext(bundle.outputFiles[0]!.text,context);
const reopened=context.Lifecycle as typeof api;
const restored=await reopened.readChatEdit(40);
assert.equal(restored.messages.length,2);
assert.equal(restored.snapshots.map(s=>s.blocks[0]!.text).join('|'),'Sent material|Unsent material');
assert.equal(restored.draft,'Unsent draft');assert.equal(restored.pendingQuote?.note,'Unsent focus');assert.equal(restored.activeSnapshotVersion,2);
console.log('PASS: fresh worker workspace rehydrates committed history from IDB and preserves only the current unsent material, input and focus in session.');

session['chat-edit:41']={...compact};
const reading=deferred<void>();
const delayed=deferred<ChatRecordView>();
boundaries.getChat=async()=>{reading.resolve();return delayed.promise;};
const pending=reopened.handleChatRequest({type:'chatActive',windowId:41},{});
await reading.promise;
await reopened.removeChatWindow(41);
delayed.resolve(durable);
assert.equal((await pending as {ok:boolean}).ok,false);
assert.equal(reopened.chatOperation(41),undefined);
assert.equal(Object.keys(session).some(key=>key.endsWith(':41')),false);
console.log('PASS: a delayed database read cannot recreate a destroyed window or its editor state.');


boundaries.getChat=async()=>null;
const restoredRequest=(message:Record<string,unknown>)=>reopened.handleChatRequest({...message,windowId:42},{});
await restoredRequest({type:'chatNew'});
const temporaryEditor=await reopened.readChatEdit(42);
const temporarySource={sourceType:'article',sourceKey:'web:temporary',title:'Temporary',url:'https://example.com/temporary'};
await restoredRequest({type:'chatEnsure',chatId:'',editId:temporaryEditor.editId,source:temporarySource,material:{label:'First',blocks:[{id:'p1',text:'First temporary material'}]}});
const oldVersion=(await reopened.readChatEdit(42)).activeSnapshotVersion;
await restoredRequest({type:'chatRemoveMaterial',chatId:'',editId:temporaryEditor.editId});
await restoredRequest({type:'chatEnsure',chatId:'',editId:temporaryEditor.editId,source:temporarySource,material:{label:'Second',blocks:[{id:'p1',text:'Second temporary material'}]}});
assert.notEqual((await reopened.readChatEdit(42)).activeSnapshotVersion,oldVersion);
console.log('PASS: removing temporary material does not reuse its editor version before submission.');
