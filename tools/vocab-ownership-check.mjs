// Production panel + worker + real IndexedDB/OPFS; delay only list response delivery.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const temporaryRoot = resolve(tmpdir());
const profile = await mkdtemp(join(temporaryRoot, 'pd-vocab-owner-'));
const extension = resolve(process.env.PEAK_DISTANCE_UI_EXTENSION || '.output/chrome-mv3');
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.platform === 'win32' ? { executablePath: process.env.BLC_CHROME || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' } : { channel: 'chromium' }),
    headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(10000);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(worker.url()).host}`;
  const control = await context.newPage(); await control.goto(`${base}/options.html`);
  console.log('Opened production worker and control page');
  await control.evaluate(() => chrome.storage.local.set({ displayLanguage: 'zh-Hans' }));
  const send = message => control.evaluate(message => chrome.runtime.sendMessage(message), message);
  assert.equal((await send({ type: 'listEntries' })).ok, true); // Let the worker create/upgrade the schema first.
  async function selectLibrary(name) {
    await control.evaluate(async name => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
      await new Promise((done, reject) => {
        const request = indexedDB.open('blc-learning');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('vault', 'readwrite');
          tx.objectStore('vault').put(directory, 'handle');
          tx.oncomplete = () => { db.close(); done(); }; tx.onabort = () => reject(tx.error);
        };
      });
    }, name);
    const response = await send({ type: 'vaultConnect' }); assert.equal(response.ok, true);
    console.log(`Connected library ${name}`); return response.vault.vaultId;
  }
  const expressions = ['statusword', 'noteword', 'deleteword', 'formword'];
  async function seedLibrary(label, status) {
    for (const expression of expressions) {
      assert.equal((await send({ type: 'save', snapshot: { source: 'web', expression, sentence: `${label} ${expression}.`, url: `https://example.com/${label}`, title: label, lang: 'en' }, status })).ok, true);
    }
    await control.evaluate(() => new Promise((done, reject) => {
      const request = indexedDB.open('blc-learning'); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries');
        const read = store.get('en::formword'); read.onsuccess = () => store.put({ ...read.result, forms: ['inflected'] });
        tx.oncomplete = () => { db.close(); done(); }; tx.onabort = () => reject(tx.error);
      };
    }));
    for (const expression of expressions) assert.equal((await send({ type: 'setNote', key: `en::${expression}`, note: `${label} note` })).ok, true);
    assert.equal((await send({ type: 'vaultFlush' })).ok, true);
    console.log(`Seeded library ${label}`);
  }
  const vaultA = await selectLibrary('A'); await seedLibrary('A', 'saved');
  // The control lives in another real window, as when settings switch the library elsewhere.
  const [panel] = await Promise.all([
    context.waitForEvent('page'),
    control.evaluate(url => chrome.windows.create({ url, type: 'normal' }), `${base}/sidepanel.html#list`),
  ]);
  await panel.waitForLoadState();
  await panel.waitForFunction(() => !document.body.inert && document.querySelectorAll('#list .entry').length === 4);
  panel.on('dialog', dialog => dialog.accept());
  await panel.evaluate(() => {
    globalThis.originalSend = chrome.runtime.sendMessage; globalThis.heldLists = []; globalThis.writeResults = [];
    chrome.runtime.sendMessage = function(message, callback) {
      if (message.type === 'listEntries') return originalSend.call(this, message, value => heldLists.push({ callback, value }));
      if (['setStatus', 'setNote', 'deleteEntry', 'removeForm'].includes(message.type)) {
        return originalSend.call(this, message, value => { writeResults.push({ message, value }); callback(value); });
      }
      return originalSend.apply(this, arguments);
    };
  });
  const vaultB = await selectLibrary('B'); assert.notEqual(vaultA, vaultB); await seedLibrary('B', 'learning');
  const before = await send({ type: 'listEntries' });
  const row = expression => panel.locator(`#list .entry[data-key="en::${expression}"]`);
  await row('noteword').getByRole('button',{name:'编辑笔记',exact:true}).click();
  assert.equal(await row('noteword').locator('textarea').inputValue(), 'A note');
  await row('statusword').locator('select.status').selectOption('known');
  await row('noteword').locator('textarea').fill('Stale A edit');
  await row('noteword').getByRole('button', { name: '保存笔记', exact: true }).click();
  await row('deleteword').getByRole('button',{name:'删除',exact:true}).click();
  await row('formword').locator('.form-chip button').click();
  await panel.waitForFunction(() => writeResults.length === 4);
  const writes = await panel.evaluate(() => writeResults);
  const after = await send({ type: 'listEntries' });
  console.log('Stale A card writes after switching to B:', JSON.stringify(writes));
  assert.deepEqual(after, before, 'stale cards must not change B records, contexts, notes, forms or timestamps');
  assert.ok(writes.every(({ message }) => message.vaultId === vaultA), 'every card action must carry the identity read with the card');
  assert.ok(writes.every(({ value }) => !value.ok || value.removed === false));
  for (const message of [
    { type: 'setStatus', key: 'en::statusword', status: 'known' },
    { type: 'setNote', key: 'en::noteword', note: 'Old local edit' },
    { type: 'deleteEntry', key: 'en::deleteword' },
    { type: 'removeForm', key: 'en::formword', form: 'inflected' },
  ]) {
    const response = await send({ ...message, vaultId: null });
    assert.ok(!response.ok || response.removed === false, 'an unconnected local card must not write to a connected library');
  }
  assert.deepEqual(await send({ type: 'listEntries' }), before);

  await selectLibrary('A');
  await panel.evaluate(() => {
    chrome.runtime.sendMessage = function(message, callback) {
      return originalSend.call(this, message, value => { callback(value); if (message.type === 'listEntries') globalThis.freshListRead = true; });
    };
    document.querySelector('#search').dispatchEvent(new Event('input'));
  });
  await panel.waitForFunction(() => globalThis.freshListRead);
  await panel.evaluate(async vaultB => {
    for (const { callback, value } of heldLists) if (value.vaultId === vaultB) callback(value);
    await new Promise(requestAnimationFrame);
    chrome.runtime.sendMessage = originalSend;
  }, vaultB);
  await row('noteword').getByRole('button',{name:'编辑笔记',exact:true}).click();
  assert.equal(await row('noteword').locator('textarea').inputValue(), 'A note', 'a late B response must not replace the freshly loaded A cards');
  await row('statusword').locator('select.status').selectOption('known');
  await control.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'getEntry', key: 'en::statusword' })).entry?.status === 'known');
  await row('noteword').locator('textarea').fill('Fresh A edit');
  await row('noteword').getByRole('button', { name: '保存笔记', exact: true }).click();
  await control.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'getEntry', key: 'en::noteword' })).entry?.note === 'Fresh A edit');
  await row('formword').locator('.form-chip button').click();
  await control.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'getEntry', key: 'en::formword' })).entry?.forms.length === 0);
  await row('deleteword').getByRole('button',{name:'删除',exact:true}).click();
  await control.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'getEntry', key: 'en::deleteword' })).entry === null);
  assert.equal((await send({ type: 'vaultFlush' })).ok, true);
  const fresh = await send({ type: 'listEntries' });
  assert.equal(fresh.entries.find(e => e.key === 'en::statusword').status, 'known');
  assert.equal(fresh.entries.find(e => e.key === 'en::noteword').note, 'Fresh A edit');
  assert.deepEqual(fresh.entries.find(e => e.key === 'en::formword').forms, [], 'sync must not restore the removed form');
  await selectLibrary('B'); assert.deepEqual(await send({ type: 'listEntries' }), before);
  console.log('PASS stale global status/note/delete/form actions are rejected across libraries; null ownership is checked; late list replies are ignored and fresh A actions still work');
} finally {
  await context?.close();
  assert.ok(resolve(profile).startsWith(temporaryRoot + sep));
  await rm(profile, { recursive: true, force: true });
}
