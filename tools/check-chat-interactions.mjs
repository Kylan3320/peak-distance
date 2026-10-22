// Built MV3 extension, real storage/message routing, isolated profile and controlled AI stream.
// Run: npm run build && node tools/check-chat-interactions.mjs
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const profile = await mkdtemp(join(tmpdir(), 'pd-chat-interactions-'));
const extension = resolve(process.env.PEAK_DISTANCE_CHAT_EXTENSION || '.output/chrome-mv3');
const output = resolve('.upstream/chat-interactions');
await mkdir(output, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 440, height: 850 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
context.setDefaultTimeout(8000);
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(worker.url()).host}`;
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ displayLanguage: 'zh-Hans', deepseekApiKey: 'disposable-test-key' });
    globalThis.chatRequests = [];
    globalThis.chatReplies = [];
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://api.deepseek.com/')) throw new Error(`Unexpected request: ${url}`);
      globalThis.chatRequests.push(JSON.parse(init.body));
      return new Response(new ReadableStream({ start(controller) {
        globalThis.chatReplies.push(() => {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Controlled answer [p1]"}}]}\n\ndata: [DONE]\n\n'));
          controller.close();
        });
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  const control = await context.newPage();
  await control.goto(`${base}/options.html`);
  const send = message => control.evaluate(async message => chrome.runtime.sendMessage({
    windowId: (await chrome.windows.getCurrent()).id, ...message,
  }), message);
  const waitForRequests = count => worker.evaluate(async count => {
    const deadline = Date.now() + 8000;
    while (globalThis.chatRequests.length !== count) {
      if (Date.now() > deadline) throw new Error(`Expected ${count} AI requests, got ${globalThis.chatRequests.length}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }, count);
  const selectedText = 'SELECTION_TEST: I get what she is saying. Historically, people disagree about code.';
  const attached = await send({ type: 'chatEnsure',
    source: { sourceType: 'x', sourceKey: 'x:interaction-test', title: 'Controlled post', url: 'https://x.com/example/status/1' },
    material: { label: '选中句段', blocks: [{ id: 'p1', text: selectedText }] },
    quote: { blockIds: ['p1'], note: selectedText },
  });
  assert.equal(attached.ok, true);
  assert.equal((await send({ type: 'chatRecent' })).chats.length, 0);

  const panel = await context.newPage();
  await panel.addInitScript(() => {
    // Isolate the injected transition from Chromium's tab activation events.
    document.addEventListener('visibilitychange', event => {
      if (event.isTrusted) event.stopImmediatePropagation();
    }, true);
    // Inject exactly between the first attachment render and boot's readiness commit.
    const observer = new MutationObserver(() => {
      const attachment = document.getElementById('chat-attachment');
      const contextReady = document.getElementById('panel-mode')?.hasAttribute('data-i18n-aria-label-values');
      if (!contextReady || !document.body?.inert || !attachment || attachment.hidden) return;
      observer.disconnect();
      globalThis.bootVisibilityRace = true;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    observer.observe(document, { subtree: true, attributes: true });
  });
  await panel.goto(`${base}/sidepanel.html#chat`);
  await panel.waitForFunction(() => !document.body.inert);
  assert.equal(await panel.evaluate(() => globalThis.bootVisibilityRace), true);
  const input = panel.locator('#chat-input');
  assert.ok((await input.boundingBox()).height <= 48, 'The composer starts with a single compact line');
  assert.equal(await panel.locator('#chat-starters button').count(), 3);
  assert.ok((await panel.locator('#chat-attachment-chip').boundingBox()).height <= 40, 'Material preview occupies one row');
  assert.equal(await panel.locator('#chat-attachment-focus').isVisible(), false);
  await panel.locator('#chat-attachment-chip').click();
  assert.equal(await panel.locator('#chat-attachment-focus').isVisible(), true);
  assert.ok((await panel.locator('#chat-attachment-detail').innerText()).includes(selectedText));
  await panel.locator('#chat-attachment-chip').click();
  assert.equal(await panel.locator('#chat-attachment-focus').isVisible(), false);
  await panel.screenshot({ path: join(output, 'chat-with-selection.png') });
  await input.fill('解释一下这段话，并提炼重点');
  await panel.locator('#chat-send').click();
  await panel.waitForFunction(() => document.querySelector('#chat-list .msg.user .q')?.textContent === '解释一下这段话，并提炼重点');
  assert.equal(await panel.locator('.chat-welcome').count(), 0);
  assert.equal(await input.inputValue(), '');
  assert.equal(await panel.locator('#chat-stop').isVisible(), true);
  assert.equal(await panel.locator('#chat-starters button').count(), 0);
  const first = (await send({ type: 'chatActive' })).chat;
  assert.ok(first.id);
  assert.equal(first.messages.length, 2);
  assert.equal(first.editId, attached.chat.editId);
  console.log('PASS boot visibility race: first send exits welcome, clears submitted input and displays the question/answer placeholder');

  await waitForRequests(1);
  await input.fill('下一问草稿');
  await input.press('Enter');
  assert.equal(await input.inputValue(), '下一问草稿');
  assert.equal(await worker.evaluate(() => globalThis.chatRequests.length), 1);
  await worker.evaluate(() => globalThis.chatReplies.shift()());
  await panel.waitForFunction(() => document.querySelector('#chat-list .state.done'));
  assert.equal(await input.inputValue(), '下一问草稿');
  assert.ok((await panel.locator('#chat-list').innerText()).includes('Controlled answer'));
  await panel.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await panel.locator('#chat-attachment-remove').click();
  await panel.locator('#chat-attachment').waitFor({ state: 'hidden' });
  assert.equal(await input.inputValue(), '下一问草稿');
  assert.equal(await panel.locator('#chat-meta-error').isVisible(), false);
  assert.equal((await send({ type: 'chatActive' })).chat.activeSnapshotVersion, null);
  assert.equal((await send({ type: 'chatGet', chatId: first.id })).chat.snapshots[0].blocks[0].text, selectedText);
  console.log('PASS answering blocks duplicate Enter submissions; removing selection preserves the next draft and historical material');

  let turns = 1;
  async function ask(question, key = 'Enter') {
    await input.fill(question);
    await input.press(key);
    turns++;
    await waitForRequests(turns);
    await panel.waitForFunction(count => document.querySelectorAll('#chat-list .msg.user').length === count, turns);
    assert.equal(await input.inputValue(), '');
    await worker.evaluate(() => globalThis.chatReplies.shift()());
    await panel.waitForFunction(count => document.querySelectorAll('#chat-list .state.done').length === count, turns);
  }
  await ask('移除选区之后继续问');
  const afterRemove = await worker.evaluate(() => globalThis.chatRequests.at(-1));
  assert.ok(!JSON.stringify(afterRemove).includes(selectedText));
  await panel.locator('#chat-head [data-i18n-aria-label="新对话"]').click();
  await panel.locator('.chat-welcome').waitFor();
  await panel.locator('#chat-head [data-i18n-aria-label="历史"]').click();
  await panel.locator('.chat-recent-row .chat-tool').click();
  await panel.waitForFunction(() => document.querySelectorAll('#chat-list .msg.user').length === 2);
  assert.equal(await panel.locator('.chat-welcome').count(), 0);
  assert.equal((await send({ type: 'chatActive' })).chat.id, first.id);
  await panel.locator('.cite').first().click();
  assert.ok((await panel.locator('#chat-cite-panel').innerText()).includes(selectedText));
  await panel.locator('.cite-close').click();
  await ask('在历史线程中继续交流');
  const continued = await worker.evaluate(() => globalThis.chatRequests.at(-1));
  assert.ok(JSON.stringify(continued).includes('移除选区之后继续问'));
  assert.ok(!JSON.stringify(continued).includes(selectedText));
  assert.equal((await send({ type: 'chatRecent' })).chats.length, 1);
  console.log('PASS history opens the saved thread, retains old citations and continues the same conversation with the correct context');

  await input.fill('第一行');
  await input.press('Shift+Enter');
  assert.equal(await input.inputValue(), '第一行\n');
  assert.equal(await worker.evaluate(() => globalThis.chatRequests.length), turns);
  await ask('第一行\n第二行');
  for (const key of ['Control+Enter', 'Meta+Enter']) await ask(`快捷发送 ${key}`, key);
  await input.fill('输入法确认候选');
  for (const options of [{ isComposing: true }, { keyCode: 229 }, { isComposing: true, ctrlKey: true }, { altKey: true }]) {
    const allowed = await input.evaluate((element, options) => element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true, ...options,
    })), options);
    assert.equal(allowed, true);
    assert.equal(await input.inputValue(), '输入法确认候选');
  }
  assert.equal(await worker.evaluate(() => globalThis.chatRequests.length), turns);
  await ask('确认候选结束后发送');
  await input.fill(''); await input.press('Enter');
  await input.fill('x'.repeat(4001)); await input.press('Enter');
  assert.equal(await input.inputValue(), 'x'.repeat(4001));
  assert.equal(await worker.evaluate(() => globalThis.chatRequests.length), turns);
  assert.equal(await panel.locator('#chat-meta-error').isVisible(), true);
  await input.fill('');
  assert.equal(await panel.locator('#chat-send').getAttribute('title'), 'Enter 发送，Shift + Enter 换行');
  console.log('PASS Enter, Shift+Enter, Ctrl/⌘+Enter, IME confirmation, Alt+Enter, empty and overlong input');
  await ask('验证完成后继续交流');
  for (const [width, height] of [[440, 850], [390, 640], [1100, 850]]) {
    await panel.setViewportSize({ width, height });
    const compact = await input.boundingBox();
    assert.ok(compact.height <= 48);
    const listHeight = await panel.locator('#chat-list').evaluate(element => element.clientHeight);
    const resize = panel.locator('#chat-resize');
    const edge = await resize.boundingBox();
    const frame = await panel.locator('#chat-input-row').boundingBox();
    await panel.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await panel.mouse.down();
    await panel.mouse.move(edge.x + edge.width / 2, edge.y - 120, { steps: 10 });
    await panel.mouse.up();
    const expanded = await input.boundingBox();
    const expandedFrame = await panel.locator('#chat-input-row').boundingBox();
    assert.ok(expanded.height >= compact.height + 60, 'Top edge enlarges the composer');
    assert.ok(expandedFrame.y < frame.y - 60 && Math.abs(expandedFrame.y + expandedFrame.height - frame.y - frame.height) < 1, 'The outer top edge moves while the bottom stays fixed');
    assert.ok(expanded.height <= Math.min(240, height * .3) + 1, 'Resizing leaves room for the conversation');
    const raisedEdge = await resize.boundingBox();
    await panel.mouse.move(raisedEdge.x + raisedEdge.width / 2, raisedEdge.y + raisedEdge.height / 2);
    await panel.mouse.down();
    await panel.mouse.move(raisedEdge.x + raisedEdge.width / 2, raisedEdge.y + 260, { steps: 10 });
    await panel.mouse.up();
    assert.ok((await input.boundingBox()).height <= 48, 'Top edge shrinks the composer');
    await resize.focus(); await resize.press('ArrowUp');
    assert.ok((await input.boundingBox()).height >= 60, 'Keyboard enlarges the composer');
    await resize.press('ArrowDown');
    assert.ok((await input.boundingBox()).height <= 48, 'Keyboard shrinks the composer');
    await resize.press('ArrowUp'); await resize.press('Home');
    assert.ok((await input.boundingBox()).height <= 48);
    assert.ok(await panel.locator('#chat-list').evaluate(element => element.clientHeight) >= listHeight - 1);
    assert.ok(listHeight >= height * .5, 'Conversation retains at least half of the viewport');
    if (width < 560) assert.ok((await panel.locator('.app-header').boundingBox()).height <= 100, 'Narrow header stays compact');
    assert.equal(await panel.locator('#chat-starters button').count(), 0, 'Starter prompts disappear after the first question');
    await resize.evaluate(element => element.blur());
    await panel.screenshot({ path: join(output, `chat-${width}.png`) });
    console.log(`PASS ${width}×${height}: compact header, outer top edge and keyboard resize, conversation space restored`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS narrow/wide rendered conversation; no browser script errors; all AI requests used disposable test data');
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
