// Real browser IndexedDB and production sync code share a disposable disk directory.
// Only the native directory handle boundary is adapted; native handles/UI are covered by m11-vault-e2e.mjs.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
const root = resolve(import.meta.dirname, "..");
const workspace = mkdtempSync(join(tmpdir(), "pd-vault-sync-"));
const directory = join(workspace, "shared");
mkdirSync(directory);
const contexts = [];
let editLegacyDuringBackup = false;
let editChatDuringDeletion = false;
const bundle = await build({
  absWorkingDir: root,
  stdin: { contents: "export * from './lib/vault/sync'; export * from './lib/vault/records'; export * as db from './lib/db'; export * as format from './lib/vault/format'; export * as files from './lib/vault/fs'; export {emptyChat} from './shared/chat';", resolveDir: root },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  globalName: "Vault",
  plugins: [{ name: "directory-handle-boundary", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/db$/ }, (args) => /[/\\]vault[/\\](sync|fs)\.ts$/.test(args.importer) ? { path: args.path, namespace: "handle" } : void 0);
    builder.onLoad({ filter: /.*/, namespace: "handle" }, () => ({
      contents: `export * from ${JSON.stringify(join(root, "lib/db.ts").replace(/\\/g, "/"))}; export const getVaultHandle = async () => globalThis.__vaultDirectory;`,
      loader: "ts",
      resolveDir: root
    }));
  } }]
});
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<!doctype html><title>Vault sync check</title>");
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
async function open(kind) {
  const executablePath = kind === "chrome" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const channel = kind === 'edge' && existsSync('/Applications/Microsoft Edge.app') ? 'msedge' : 'chromium';
  const context = await chromium.launchPersistentContext(join(workspace, kind), { ...(process.platform === 'win32' ? { executablePath } : { channel }), headless: true });
  console.log(`Browser profile ${kind}: ${process.platform === 'win32' ? executablePath : channel}`);
  contexts.push(context);
  const page = await context.newPage();
  await page.exposeBinding("__vaultDisk", (_source, operation, parts, value) => {
    const target = resolve(directory, ...parts);
    assert.ok(target === directory || target.startsWith(directory + sep));
    if (!existsSync(target)) {
      if (operation === "directory" && value) mkdirSync(target, { recursive: true });
      else if (operation === "file" && value) writeFileSync(target, "");
      else return { missing: true };
    }
    if (operation === "directory") {
      assert.ok(statSync(target).isDirectory());
      return true;
    }
    if (operation === "file") {
      assert.ok(statSync(target).isFile());
      return true;
    }
    if (operation === "read") return readFileSync(target, "utf8");
    if (operation === "write") {
      writeFileSync(target, String(value));
      if (editChatDuringDeletion && parts.at(-1) === 'deleted-chats.json') {
        editChatDuringDeletion = false;
        const chatDir = join(directory, '对话');
        const name = readdirSync(chatDir).find(name => readFileSync(join(chatDir, name), 'utf8').includes('id: delete-during-write\n'));
        const path = join(chatDir, name);
        writeFileSync(path, readFileSync(path, 'utf8') + '\nREMOTE UPDATE DURING DELETE\n');
      }
      if (editLegacyDuringBackup && parts.join('/') === '.peak-distance/legacy/词汇/en/race.md') {
        editLegacyDuringBackup = false;
        const legacyPath = join(directory, '词汇/en/race.md');
        writeFileSync(legacyPath, readFileSync(legacyPath, 'utf8') + '\nLATEST USER NOTE\n');
      }
      return true;
    }
    if (operation === "remove") {
      rmSync(target);
      return true;
    }
    if (operation === "list") return readdirSync(target, { withFileTypes: true }).map((item) => [item.name, item.isDirectory() ? "directory" : "file"]);
    throw Error(`Unknown disk operation ${operation}`);
  });
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.evaluate(() => {
    const globals = window;
    globals.__permission = "granted";
    const local = {};
    globals.browser = { storage: { local: {
      get: async (keys) => Object.fromEntries((keys ?? Object.keys(local)).filter((key) => key in local).map((key) => [key, local[key]])),
      set: async (items) => Object.assign(local, items)
    } } };
    async function disk(operation, parts, value) {
      const result = await globals.__vaultDisk(operation, parts, value);
      if (result?.missing) throw new DOMException("Missing file", "NotFoundError");
      return result;
    }
    function handle(parts = []) {
      return {
        kind: "directory",
        name: "shared",
        queryPermission: async () => globals.__permission,
        getDirectoryHandle: async (name, options) => {
          const path = [...parts, name];
          await disk("directory", path, !!options?.create);
          return handle(path);
        },
        getFileHandle: async (name, options) => {
          const path = [...parts, name];
          await disk("file", path, !!options?.create);
          return { kind: "file", getFile: async () => ({ text: () => disk("read", path) }), createWritable: async () => {
            let text = "";
            return { write: async (value) => {
              text = value;
            }, close: () => disk("write", path, text), abort: async () => {
            } };
          } };
        },
        removeEntry: (name) => disk("remove", [...parts, name]),
        async *[Symbol.asyncIterator]() {
          for (const [name, kind2] of await disk("list", parts)) yield [name, kind2 === "directory" ? handle([...parts, name]) : { kind: kind2 }];
        }
      };
    }
    globals.__vaultDirectory = handle();
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => window.Vault.db.setVaultHandle("shared-test-directory"));
  return page;
}
try {
  const chrome = await open("chrome");
  const edge = await open("edge");
  await chrome.evaluate(async () => {
    const { db } = window.Vault;
    await db.saveSnapshot({ source: "web", expression: "engineer", sentence: "A senior engineer.", url: "https://example.com/one", title: "One", lang: "en" }, {
      result: { kind: "dictionary", selectedSense: 1, entry: { source: "youdao", expression: "engineer", headword: "engineer", url: "https://dict.youdao.com/engineer", senses: [{ definition: "工程师" }, { definition: "设计师", example: "A senior engineer." }] } }
    });
    await db.saveSentence({
      id: "shared-sentence",
      language: "en",
      text: "A senior engineer.",
      zh: "一位资深工程师。",
      translationSource: "google-gtx",
      title: "Video",
      createdAt: 123,
      video: { videoId: "abcdefghijk", trackId: "en-track", trackKind: "manual", trackLang: "en", startMs: 1e3 },
      endMs: 3500
    });
  });
  await edge.evaluate(() => window.Vault.db.saveSnapshot({ source: "web", expression: "speculation", sentence: "Pure speculation.", url: "https://example.com/two", title: "Two", lang: "en" }, {}));
  assert.ok((await chrome.evaluate(() => window.Vault.adoptVault())).ok);
  assert.ok((await edge.evaluate(() => window.Vault.adoptVault())).ok);
  assert.equal((await chrome.evaluate(() => window.Vault.synchronizeVault())).error, void 0);
  for (const page of [chrome, edge]) {
    assert.equal((await page.evaluate(() => window.Vault.db.listEntries())).length, 2);
    const sentence = (await page.evaluate(() => window.Vault.db.listSentences()))[0];
    assert.equal(sentence.video.startMs, 1e3);
    assert.equal(sentence.endMs, 3500);
    assert.equal(sentence.zh, "一位资深工程师。");
    const entry = await page.evaluate(() => window.Vault.db.getEntry("en::engineer"));
    assert.equal(entry.contexts[0].result.entry.senses.length, 2);
    assert.equal(entry.contexts[0].result.selectedSense, 1);
    assert.ok(entry.createdAt > 0);
  }
  assert.equal((await chrome.evaluate(() => window.Vault.synchronizeVault())).committed, 0);
  console.log("PASS two browser profiles exchange vocabulary, complete dictionary data and video sentences; unchanged sync is idempotent");
  await chrome.evaluate(() => window.Vault.db.setEntryNote("en::engineer", "在原句里理解。"));
  await edge.evaluate(() => window.Vault.db.setStatus("en::engineer", "learning"));
  await edge.evaluate(() => window.Vault.synchronizeVault());
  await chrome.evaluate(() => window.Vault.synchronizeVault());
  await edge.evaluate(() => window.Vault.synchronizeVault());
  const merged = await edge.evaluate(() => window.Vault.db.getEntry("en::engineer"));
  assert.equal(merged.status, "learning");
  assert.equal(merged.note, "在原句里理解。");
  console.log("PASS different-field changes merge across browsers without losing notes or state");

  const sentenceBook = join(directory, '句子.md');
  writeFileSync(sentenceBook, readFileSync(sentenceBook, 'utf8') + '\n### 我的笔记\nKEEP THIS PERSONAL NOTE\n');
  await chrome.evaluate(async () => {
    const api = window.Vault;
    const sentence = (await api.db.listSentences())[0];
    const captured = api.sentenceToVaultRecord(sentence);
    await api.db.saveSentence({ ...sentence, zh: '保留笔记的新译文。' });
    await api.db.enqueueVaultWrite({ id: 'sentence:shared-sentence', kind: 'sentence', recordId: 'shared-sentence', payload: captured, queuedAt: Date.now() });
  });
  assert.equal((await chrome.evaluate(() => window.Vault.db.listVaultQueue()))[0].payload.translation, '保留笔记的新译文。');
  await chrome.evaluate(() => window.Vault.synchronizeVault());
  assert.ok(readFileSync(sentenceBook, 'utf8').includes('KEEP THIS PERSONAL NOTE'));
  assert.ok(readFileSync(sentenceBook, 'utf8').includes('保留笔记的新译文。'));
  console.log('PASS stale sentence save is rejected; translation update preserves external personal notes');

  const revisionGuard = await chrome.evaluate(async () => {
    const api = window.Vault;
    const original = api.entryViewToVaultRecord(await api.db.getEntry('en::engineer'));
    const write = { id: 'vocab:en::engineer', kind: 'vocab', recordId: 'en::engineer', payload: original, queuedAt: Date.now() };
    await api.db.enqueueVaultWrite(write);
    const old = (await api.db.listVaultQueue()).find(item => item.recordId === write.recordId);
    await api.db.setEntryNote('en::engineer', 'NEWER LOCAL NOTE');
    const newer = api.entryViewToVaultRecord(await api.db.getEntry('en::engineer'));
    await api.db.enqueueVaultWrite({ ...write, payload: newer });
    await api.db.enqueueVaultWrite(write);
    await api.db.removeVaultWrite(old);
    await api.db.markVaultWriteAttempt(old, 'old failure');
    return (await api.db.listVaultQueue()).find(item => item.recordId === write.recordId);
  });
  assert.equal(revisionGuard.payload.note, 'NEWER LOCAL NOTE');
  assert.equal(revisionGuard.attempts, undefined);
  await chrome.evaluate(() => window.Vault.synchronizeVault());
  console.log('PASS stale captured save and old completion cannot replace or remove a newer pending edit');
  const rejectedSentenceImport = await chrome.evaluate(async () => {
    const api = window.Vault;
    const captured = (await api.db.listSentences())[0];
    await api.db.deleteSentence("shared-sentence");
    return api.db.upsertVaultSentence(captured, null);
  });
  assert.equal(rejectedSentenceImport, false);
  await chrome.evaluate(() => window.Vault.syncFromVault());
  assert.equal((await chrome.evaluate(() => window.Vault.db.listSentences())).length, 0);
  await chrome.evaluate(() => window.Vault.synchronizeVault());
  await edge.evaluate(() => window.Vault.synchronizeVault());
  assert.equal((await edge.evaluate(() => window.Vault.db.listSentences())).length, 0);
  console.log("PASS collection deletion propagates and does not resurrect the saved sentence");

  const deleted = await chrome.evaluate(async () => {
    const api = window.Vault;
    const captured = api.entryViewToVaultRecord(await api.db.getEntry('en::engineer'));
    await api.db.deleteEntry('en::engineer');
    await api.db.enqueueVaultWrite({ id: 'vocab:en::engineer', kind: 'vocab', recordId: captured.id, payload: captured, queuedAt: Date.now() });
    await api.syncFromVault();
    const mapped = api.vaultRecordToEntry(captured, captured.note ?? '');
    const imported = await api.db.importVaultEntry(mapped.entry, mapped.contexts, null);
    return { imported, entry: await api.db.getEntry('en::engineer'), pending: (await api.db.listVaultQueue()).find(item => item.recordId === captured.id) };
  });
  assert.equal(deleted.imported, false); assert.equal(deleted.entry, null); assert.equal(deleted.pending.payload, null);
  await chrome.evaluate(() => window.Vault.synchronizeVault());
  await edge.evaluate(() => window.Vault.syncFromVault());
  assert.equal(await edge.evaluate(() => window.Vault.db.getEntry('en::engineer')), null);
  console.log('PASS vocabulary deletion and tombstone commit atomically; readback/old captured save do not resurrect it');

  const preservedNote = await edge.evaluate(async () => {
    const api = window.Vault;
    const captured = api.entryViewToVaultRecord(await api.db.getEntry('en::speculation'));
    await api.db.setEntryNote(captured.id, 'SAVED DURING READBACK');
    const removed = await api.db.deleteEntry(captured.id, false, captured);
    return { removed, entry: await api.db.getEntry(captured.id) };
  });
  assert.equal(preservedNote.removed, false); assert.equal(preservedNote.entry.note, 'SAVED DURING READBACK');
  await edge.evaluate(() => window.Vault.synchronizeVault());
  console.log('PASS remote deletion cannot erase a local note saved after the readback snapshot');

  const bookPath = join(directory, '生词本.md');
  const intact = readFileSync(bookPath, 'utf8');
  const before = (await edge.evaluate(() => window.Vault.db.listEntries())).length;
  writeFileSync(bookPath, intact.replaceAll('<!-- peak-distance:vocab -->', ''));
  const broken = await edge.evaluate(() => window.Vault.syncFromVault());
  assert.equal(broken.error, 'format'); assert.equal(broken.deleted, 0);
  assert.equal((await edge.evaluate(() => window.Vault.db.listEntries())).length, before);
  writeFileSync(bookPath, intact);
  console.log('PASS broken collection separators report format failure and preserve the running vocabulary');
  await chrome.evaluate(() => {
    window.__permission = "prompt";
  });
  const refused = await chrome.evaluate(() => window.Vault.synchronizeVault());
  assert.equal(refused.error, "no-permission");
  await chrome.evaluate(() => {
    window.__permission = "granted";
  });
  console.log("PASS unavailable permission is reported as a failed sync");
  const legacy = await chrome.evaluate(() => window.Vault.format.serializeVocabRecord({ id: "en::legacy", language: "en", expression: "legacy", status: "saved", forms: [], note: "保留旧笔记", createdAt: 1, updatedAt: 1, contexts: [] }));
  mkdirSync(join(directory, "词汇/en"), { recursive: true });
  writeFileSync(join(directory, "词汇/en/legacy.md"), legacy);
  await edge.evaluate(() => window.Vault.synchronizeVault());
  assert.equal((await edge.evaluate(() => window.Vault.db.getEntry("en::legacy"))).note, "保留旧笔记");
  assert.ok(existsSync(join(directory, ".peak-distance/legacy/词汇/en/legacy.md")));
  assert.ok(!existsSync(join(directory, "词汇/en/legacy.md")));
  assert.equal(readdirSync(directory).filter((name) => name.endsWith(".md")).length, 2);
  console.log("PASS legacy records consolidate into two Markdown collections with verified backups");

  const completeChat = await chrome.evaluate(async () => {
    const api = window.Vault;
    const article = { sourceType: 'article', sourceKey: 'web:original', title: 'Original article', url: 'https://example.com/original' };
    const video = { sourceType: 'youtube', sourceKey: 'yt:abcdefghijk', title: 'Video', url: 'https://www.youtube.com/watch?v=abcdefghijk', video: { videoId: 'abcdefghijk', trackId: 'stable-track', trackKind: 'asr', trackLang: 'ja' } };
    const snapshots = [
      { version: 1, source: article, label: 'Original article', createdAt: 1, blocks: [{ id: 'p1', text: 'Original text' }] },
      { version: 2, source: video, label: 'Video subtitle', createdAt: 2, blocks: [{ id: 'p1', text: '日本語の原文', startMs: 1000, endMs: 2000 }] },
    ];
    const id = 'reliability-chat';
    for (let i = 0; i < 3; i++) {
      const source = i < 2 ? snapshots[i].source : null;
      const context = { ...api.emptyChat(), id, source, sourceKey: source?.sourceKey ?? null, snapshots: snapshots.slice(0, i + 1), activeSnapshotVersion: i < 2 ? i + 1 : null };
      await api.db.appendChatTurn({ chatId: id, turnId: `turn-${i}`, requestId: `request-${i}`, question: `Question ${i}`, quote: i < 2 ? { blockIds: ['p1'], expression: 'test', definition: 'Saved meaning\nSecond line' } : null, snapshotVersion: i < 2 ? i + 1 : 0, segmentIndex: 0, scopeLabel: 'Scope', context, create: i === 0 });
      await api.db.saveAssistantProgress({ chatId: id, requestId: `request-${i}`, text: `Answer ${i} [p1]`, state: ['done','error','stopped'][i], errorKind: i === 1 ? 'network' : undefined });
    }
    const record = await api.db.getChat(id);
    await api.db.setChatRetained(id, record.messages[1].id, true);
    await api.flushVaultWrites();
    return api.db.getChat(id);
  });
  await edge.evaluate(() => window.Vault.syncFromVault());
  const restoredChat = await edge.evaluate(() => window.Vault.db.getChat('reliability-chat'));
  assert.deepEqual(restoredChat.snapshots, completeChat.snapshots);
  assert.deepEqual(restoredChat.messages, JSON.parse(JSON.stringify(completeChat.messages)));
  assert.equal(restoredChat.activeSnapshotVersion, null);
  assert.equal(restoredChat.source, null);
  assert.equal(restoredChat.sourceKey, null);
  console.log('PASS complete chat/material readback retains per-snapshot sources, video positions, message identities, quotes, retention and terminal states');
  const materialPath = readdirSync(join(directory, '材料')).find(name => name.includes('--v1'));
  const materialText = readFileSync(join(directory, '材料', materialPath), 'utf8');
  rmSync(join(directory, '材料', materialPath));
  await edge.evaluate(() => window.Vault.db.clearChat('reliability-chat', false));
  assert.equal((await edge.evaluate(() => window.Vault.syncFromVault())).error, 'format');
  assert.equal(await edge.evaluate(() => window.Vault.db.getChat('reliability-chat')), null);
  writeFileSync(join(directory, '材料', materialPath), materialText);
  await edge.evaluate(() => window.Vault.syncFromVault());
  assert.equal((await edge.evaluate(() => window.Vault.db.getChat('reliability-chat'))).snapshots.length, 2);
  console.log('PASS missing material reports an incomplete restore; fixing the file permits a full retry');
  await chrome.evaluate(async () => {
    await window.Vault.db.clearChat('reliability-chat');
    await window.Vault.syncFromVault();
  });
  assert.equal(await chrome.evaluate(record => window.Vault.db.upsertChatRecordFromVault(record), restoredChat), 'kept-local');
  assert.equal(await chrome.evaluate(() => window.Vault.db.getChat('reliability-chat')), null);
  await chrome.evaluate(() => window.Vault.flushVaultWrites());
  await edge.evaluate(() => window.Vault.syncFromVault());
  assert.equal(await edge.evaluate(() => window.Vault.db.getChat('reliability-chat')), null);
  assert.equal(readdirSync(join(directory, '材料')).length, 0);
  assert.equal(readdirSync(join(directory, '对话')).length, 0);
  await edge.evaluate(async record => {
    await window.Vault.db.upsertChatRecordFromVault(record);
    await window.Vault.db.setChatRetained(record.id, record.messages[1].id, false);
  }, restoredChat);
  assert.equal((await edge.evaluate(() => window.Vault.flushVaultWrites())).error, 'conflict');
  assert.ok(await edge.evaluate(() => window.Vault.db.getChat('reliability-chat')));
  assert.equal(readdirSync(join(directory, '材料')).length, 0);
  await edge.evaluate(async () => { await window.Vault.db.clearChat('reliability-chat'); await window.Vault.flushVaultWrites(); });
  console.log('PASS chat deletion is atomic, removes owned files, propagates to another browser and blocks stale cached writes without losing the conflicting local copy');

  const prefPath = join(directory, '偏好.md');
  writeFileSync(prefPath, '默认理解语言: en\nja -> zh-Hans\n');
  await chrome.evaluate(() => window.Vault.syncFromVault());
  await edge.evaluate(() => window.Vault.syncFromVault());
  assert.equal((await chrome.evaluate(() => browser.storage.local.get(['defaultComprehensionLang']))).defaultComprehensionLang, 'en');
  await chrome.evaluate(async () => {
    await browser.storage.local.set({ defaultComprehensionLang: 'de', displayLanguage: 'fr', deepseekApiKey: 'private-sentinel' });
    await window.Vault.enqueuePreferenceWrite();
  });
  writeFileSync(prefPath, '默认理解语言: en\nja -> zh-Hans\nru -> en\n');
  await chrome.evaluate(() => window.Vault.synchronizeVault());
  await edge.evaluate(() => window.Vault.syncFromVault());
  const mergedPreference = await edge.evaluate(() => browser.storage.local.get(['defaultComprehensionLang','comprehensionOverrides']));
  assert.deepEqual(mergedPreference, { defaultComprehensionLang: 'de', comprehensionOverrides: { ja:'zh-Hans',ru:'en' } });
  assert.ok(!readFileSync(prefPath, 'utf8').includes('private-sentinel'));
  writeFileSync(prefPath, '默认理解语言: fr\nja -> zh-Hans\nru -> en\n');
  await chrome.evaluate(() => window.Vault.syncFromVault());
  assert.equal((await chrome.evaluate(() => browser.storage.local.get(['defaultComprehensionLang']))).defaultComprehensionLang, 'fr');
  await chrome.evaluate(async () => { await browser.storage.local.set({ defaultComprehensionLang:'es' }); await window.Vault.enqueuePreferenceWrite(); });
  writeFileSync(prefPath, '默认理解语言: it\nja -> zh-Hans\nru -> en\n');
  assert.equal((await chrome.evaluate(() => window.Vault.synchronizeVault())).error, 'conflict');
  assert.ok(readFileSync(prefPath,'utf8').includes('it'));
  assert.equal((await chrome.evaluate(() => browser.storage.local.get(['defaultComprehensionLang']))).defaultComprehensionLang, 'es');
  await chrome.evaluate(async () => { await browser.storage.local.set({ defaultComprehensionLang:'it' }); await window.Vault.enqueuePreferenceWrite(); });
  assert.equal((await chrome.evaluate(() => window.Vault.synchronizeVault())).error, undefined);
  console.log('PASS preferences update in both directions, merge independent rules, preserve conflicting values and exclude credentials');

  const switched = await chrome.evaluate(async () => {
    const api = window.Vault;
    const a = window.__vaultDirectory;
    const b = await a.getDirectoryHandle('other-vault', { create:true });
    const bIdentity = await api.files.ensureVault(b);
    const record = { id:'en::cross-vault-target',language:'en',expression:'cross-vault-target',status:'saved',forms:[],createdAt:1,updatedAt:1,contexts:[] };
    await api.files.writeVocabToVault(b, record);
    await api.db.saveSnapshot({ source:'web',expression:record.expression,lang:'en',sentence:'Keep it.',url:'https://example.com',title:'Test' },{});
    await api.flushVaultWrites();
    const aIdentity = await api.db.getVaultIdentity();
    window.__permission='denied';
    await api.db.deleteEntry(record.id);
    await api.flushVaultWrites();
    await api.disconnectVault();
    window.__permission='granted';window.__vaultDirectory=b;
    await api.db.setVaultHandle('B');
    await api.adoptVault();
    const inB = (await api.files.scanVault(b)).vocab.map(v=>v.record.id);
    const pendingInB = await api.db.listVaultQueue();
    await api.disconnectVault();window.__vaultDirectory=a;await api.db.setVaultHandle('A');
    const pendingInA = await api.db.listVaultQueue(); // Disconnected work is invisible until the matching identity is restored.
    await api.adoptVault();
    return { a:aIdentity.vaultId,b:bIdentity.vaultId,inB,pendingInB,pendingInA,afterA:(await api.files.scanVault(a)).vocab.map(v=>v.record.id),afterB:(await api.files.scanVault(b)).vocab.map(v=>v.record.id) };
  });
  assert.notEqual(switched.a, switched.b);
  assert.deepEqual(switched.inB, ['en::cross-vault-target']);
  assert.equal(switched.pendingInB.length,0);
  assert.ok(!switched.afterA.includes('en::cross-vault-target'));
  assert.deepEqual(switched.afterB,['en::cross-vault-target']);
  console.log('PASS failed deletion stays with vault A; connecting B imports no A records, preserves its matching record, and reconnecting A commits only A work');


  const isolation = await chrome.evaluate(async () => {
    const api=Vault, a=__vaultDirectory;
    const b=await a.getDirectoryHandle('isolated-vault',{create:true});
    const source={source:'web',lang:'en',url:'https://example.com/a',title:'A'};
    await api.db.saveSnapshot({...source,expression:'a-private',sentence:'A only original sentence.'},{});
    await api.db.saveSnapshot({...source,expression:'owner',sentence:'A version.'},{});
    await api.db.setEntryNote('en::owner','A note');
    await browser.storage.local.set({defaultComprehensionLang:'fr',comprehensionOverrides:{ja:'en'}});
    await api.enqueuePreferenceWrite();await api.synchronizeVault();
    await api.db.putVaultRaw('conflict:scoped',{owner:'A'});
    const other={id:'en::owner',language:'en',expression:'owner',status:'known',note:'B note',forms:[],createdAt:1,updatedAt:2,contexts:[]};
    await api.files.ensureVault(b);await api.files.writeVocabToVault(b,other);
    await api.files.writePreferenceToVault(b,{defaultComprehensionLang:'de',comprehensionOverrides:{}});
    await api.disconnectVault();__vaultDirectory=b;await api.db.setVaultHandle('B');await api.adoptVault();
    const inB={keys:(await api.db.listEntries()).map(e=>e.key),note:(await api.db.getEntry(other.id)).note,
      staleEdit:await api.db.setEntryNote('en::a-private','Must not copy A'),conflict:await api.db.getVaultRaw('conflict:scoped'),preference:await browser.storage.local.get(['defaultComprehensionLang'])};
    await api.db.setEntryNote(other.id,'B revised note');await api.synchronizeVault();
    await api.disconnectVault();__vaultDirectory=a;await api.db.setVaultHandle('A');await api.adoptVault();
    const inA={keys:(await api.db.listEntries()).map(e=>e.key),note:(await api.db.getEntry(other.id)).note,conflict:await api.db.getVaultRaw('conflict:scoped'),preference:await browser.storage.local.get(['defaultComprehensionLang','comprehensionOverrides'])};
    return {inB,inA,bFile:(await api.files.scanVault(b)).vocab.map(v=>({id:v.record.id,note:v.note}))};
  });
  assert.deepEqual(isolation.inB.keys,['en::owner']);assert.equal(isolation.inB.note,'B note');
  assert.equal(isolation.inB.staleEdit,false);assert.equal(isolation.inB.conflict,null);
  assert.equal(isolation.inB.preference.defaultComprehensionLang,'de');
  assert.ok(isolation.inA.keys.includes('en::a-private'));assert.equal(isolation.inA.note,'A note');
  assert.deepEqual(isolation.inA.conflict,{owner:'A'});
  assert.deepEqual(isolation.inA.preference,{defaultComprehensionLang:'fr',comprehensionOverrides:{ja:'en'}});
  assert.deepEqual(isolation.bFile,[{id:'en::owner',note:'B revised note'}]);
  console.log('PASS switching libraries isolates running records, same-ID values, preferences and conflicts; returning restores the original library without copying data');

  await chrome.evaluate(async()=>{
    const api=Vault,source={source:'web',lang:'en',url:'https://example.com',title:'Offline'};
    await api.db.saveSnapshot({...source,expression:'offline-note',sentence:'Offline note.'},{});
    await api.db.saveSnapshot({...source,expression:'offline-delete',sentence:'Offline delete.'},{});
    await api.synchronizeVault();await api.disconnectVault();
    await api.db.setEntryNote('en::offline-note','Saved while disconnected');
    await api.db.deleteEntry('en::offline-delete');
    await api.db.saveSnapshot({...source,expression:'offline-new',sentence:'Offline new.'},{});
  });
  // Reload the modules so reconnect cannot depend on worker memory.
  await chrome.addScriptTag({content:bundle.outputFiles[0].text});
  const offline=await chrome.evaluate(async()=>{
    const api=Vault;await api.db.setVaultHandle('A');const adoption=await api.adoptVault();
    const scan=await api.files.scanVault(__vaultDirectory);
    return {ok:adoption.ok,note:scan.vocab.find(v=>v.record.id==='en::offline-note')?.note,
      newSaved:scan.vocab.some(v=>v.record.id==='en::offline-new'),deletedFile:!scan.vocab.some(v=>v.record.id==='en::offline-delete'),
      deletedLocal:!await api.db.getEntry('en::offline-delete'),pending:await api.db.listVaultQueue()};
  });
  assert.equal(offline.ok,true);assert.equal(offline.note,'Saved while disconnected');assert.equal(offline.newSaved,true);
  assert.equal(offline.deletedFile,true);assert.equal(offline.deletedLocal,true);assert.equal(offline.pending.length,0);
  console.log('PASS disconnected additions, edits and deletions survive module restart and commit on reconnect without resurrection');

  const conflictLifecycle=await chrome.evaluate(async()=>{
    const api=Vault,id='en::conflict-cleanup';
    await api.db.saveSnapshot({source:'web',expression:'conflict-cleanup',lang:'en',sentence:'Conflict.',url:'https://example.com',title:'Conflict'},{});
    await api.flushVaultWrites();const original=api.entryViewToVaultRecord(await api.db.getEntry(id));
    await api.db.setStatus(id,'known');await api.files.writeVocabToVault(__vaultDirectory,{...original,status:'learning'});
    const failed=await api.synchronizeVault();const conflict=await api.db.getVaultRaw('conflict:'+id);
    await api.db.setStatus(id,'learning');await api.synchronizeVault();const resolved=await api.db.getVaultRaw('conflict:'+id);
    await api.db.putVaultRaw('conflict:'+id,conflict);await api.db.deleteEntry(id);await api.flushVaultWrites();
    return {failed:failed.error,existed:!!conflict,resolved,deleted:await api.db.getVaultRaw('conflict:'+id)};
  });
  assert.equal(conflictLifecycle.failed,'conflict');assert.equal(conflictLifecycle.existed,true);
  assert.equal(conflictLifecycle.resolved,null);assert.equal(conflictLifecycle.deleted,null);
  console.log('PASS successful conflict resolution and record deletion remove obsolete conflict copies');

  const deleteConflict=await chrome.evaluate(async()=>{
    const api=Vault,id='newer-remote-chat';
    await api.db.appendChatTurn({chatId:id,turnId:'local-turn',requestId:'local-request',question:'Local question',quote:null,snapshotVersion:0,segmentIndex:0,scopeLabel:'Plain',context:api.emptyChat(),create:true});
    await api.db.saveAssistantProgress({chatId:id,requestId:'local-request',text:'Local answer',state:'done'});await api.flushVaultWrites();
    return api.db.getChat(id);
  });
  await edge.evaluate(record=>Vault.db.upsertChatRecordFromVault(record),deleteConflict);
  await edge.evaluate(async()=>{
    const api=Vault,id='newer-remote-chat';
    await api.db.appendChatTurn({chatId:id,turnId:'remote-turn',requestId:'remote-request',question:'New remote question',quote:null,snapshotVersion:0,segmentIndex:0,scopeLabel:'Plain'});
    await api.db.saveAssistantProgress({chatId:id,requestId:'remote-request',text:'New remote answer',state:'done'});await api.flushVaultWrites();
  });
  const protectedDelete=await chrome.evaluate(async()=>{
    const api=Vault,id='newer-remote-chat';await api.db.clearChat(id);const result=await api.flushVaultWrites();
    const scan=await api.files.scanVault(__vaultDirectory);
    const file=scan.chats.map(c=>api.files.parseChatDocument(c.text)).find(c=>c.id===id);
    return {result,messages:file.messages.map(m=>m.text),tombstoned:scan.deletedChats.includes(id),conflict:await api.db.getVaultRaw('conflict:chat:'+id),pending:(await api.db.listVaultQueue()).filter(w=>w.recordId===id)};
  });
  assert.equal(protectedDelete.result.error,'conflict');assert.equal(protectedDelete.tombstoned,false);
  assert.ok(protectedDelete.messages.includes('New remote answer'));assert.ok(protectedDelete.conflict);assert.equal(protectedDelete.pending.length,1);
  console.log('PASS deleting from an older browser preserves newer remote messages and records a durable conflict without a deletion marker');

  await chrome.evaluate(async()=>{
    const api=Vault,id='delete-during-write';
    await api.db.appendChatTurn({chatId:id,turnId:'race-turn',requestId:'race-request',question:'Race question',quote:null,snapshotVersion:0,segmentIndex:0,scopeLabel:'Plain',context:api.emptyChat(),create:true});
    await api.db.saveAssistantProgress({chatId:id,requestId:'race-request',text:'Race answer',state:'done'});await api.flushVaultWrites();
    await api.db.clearChat(id);
  });
  editChatDuringDeletion=true;
  const racedDelete=await chrome.evaluate(async()=>{
    const api=Vault,id='delete-during-write';const result=await api.flushVaultWrites(),scan=await api.files.scanVault(__vaultDirectory);
    return {error:result.error,tombstoned:scan.deletedChats.includes(id),file:scan.chats.find(c=>c.text.includes('id: '+id+'\n'))?.text,
      conflict:await api.db.getVaultRaw('conflict:chat:'+id)};
  });
  assert.equal(racedDelete.error,'conflict');assert.equal(racedDelete.tombstoned,false);
  assert.ok(racedDelete.file.includes('REMOTE UPDATE DURING DELETE'));
  assert.ok(racedDelete.conflict.remote.some(file=>file.text.includes('REMOTE UPDATE DURING DELETE')));
  console.log('PASS external edits during deletion roll back the new deletion marker and retain a recoverable conflict');

  const raced = legacy.replaceAll('en::legacy', 'en::race').replaceAll('expression: legacy', 'expression: race');
  writeFileSync(join(directory, '词汇/en/race.md'), raced);
  editLegacyDuringBackup = true;
  await assert.rejects(edge.evaluate(() => window.Vault.syncFromVault()), /conflict: legacy file changed/);
  assert.ok(readFileSync(join(directory, '词汇/en/race.md'), 'utf8').includes('LATEST USER NOTE'));
  console.log('PASS legacy changes during backup are retained and migration stops with a conflict');
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await new Promise((done) => server.close(() => done()));
  assert.ok(resolve(workspace).startsWith(resolve(tmpdir()) + sep) && workspace.includes("pd-vault-sync-"));
  rmSync(workspace, { recursive: true, force: true });
}
