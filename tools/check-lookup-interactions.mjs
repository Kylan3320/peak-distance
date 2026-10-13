// Built MV3 extension and real word card; disposable profile, controlled services, no real AI calls.
// Run: npm run build && node tools/check-lookup-interactions.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const profile = await mkdtemp(join(tmpdir(), 'pd-lookup-interactions-'));
const extension = resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
context.setDefaultTimeout(8000);
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(worker.url()).host}`;
  const control = await context.newPage();
  await control.goto(`${base}/options.html`);
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ displayLanguage: 'zh-Hans', deepseekApiKey: 'disposable-test-key', aiLookupFallback: true });
    globalThis.lookupMode = 'ai';
    globalThis.aiCalls = 0;
    globalThis.fetch = async url => {
      const address = String(url);
      if (address.includes('youdao')) return new Response('{}', { status: lookupMode === 'dictionary-failure' ? 429 : 200 });
      if (address.includes('cambridge')) return new Response('<html></html>', { status: lookupMode === 'dictionary-failure' ? 429 : 200 });
      if (address.includes('translate.googleapis.com')) return Response.json([[['受控免费译文']]]);
      if (address.includes('/chat/completions')) {
        globalThis.aiCalls++;
        return lookupMode === 'ai-failed' ? new Response('{}', { status: 503 }) : Response.json({ choices: [{ message: { content: '释义：受控 AI 释义\n语境：保持健康的能力' }, finish_reason: 'stop' }] });
      }
      throw new Error(`Unexpected service: ${address}`);
    };
  });
  await context.route('https://example.com/lookup**', route => {
    const word = new URL(route.request().url()).searchParams.get('word');
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><body><p id="sentence">Being ${word} is a skill.</p></body></html>` });
  });
  const page = await context.newPage();
  async function openWord(word) {
    await page.goto(`https://example.com/lookup?word=${word}`);
    await page.locator('html[data-blc-web]').waitFor();
    await page.locator('#sentence').evaluate((element, word) => {
      const range = document.createRange(); range.setStart(element.firstChild, 6); range.setEnd(element.firstChild, 6 + word.length);
      getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event('selectionchange'));
    }, word);
    await page.getByRole('button', { name: '查词', exact: true }).click();
  }
  const card = page.locator('#blc-lookup-popup .card');
  await openWord('fit');
  await card.getByText('受控 AI 释义', { exact: false }).waitFor();
  assert.equal(await worker.evaluate(() => aiCalls), 1);
  await openWord('fit');
  await card.getByText('受控 AI 释义', { exact: false }).waitFor();
  assert.equal(await worker.evaluate(() => aiCalls), 1);
  assert.ok((await card.innerText()).includes('保持健康的能力'));
  assert.ok(!(await card.innerText()).includes('正在查词'));
  console.log('PASS first and cached AI definitions render the same answer with one AI fixture call');
  for (const [mode, word, notice] of [
    ['dictionary-failure', 'fitdictionary', '词典暂不可用，当前显示免费译文'],
    ['ai-failed', 'fitaifailed', 'AI 释义失败，当前显示免费译文'],
    ['ai-unconfigured', 'fitunconfigured', '尚未配置 AI，当前显示免费译文'],
  ]) {
    await worker.evaluate(async mode => { globalThis.lookupMode = mode; if (mode === 'ai-unconfigured') await chrome.storage.local.set({ deepseekApiKey: '' }); }, mode);
    const calls = await worker.evaluate(() => aiCalls);
    await openWord(word);
    await card.getByText(notice, { exact: true }).waitFor();
    assert.ok((await card.innerText()).includes('受控免费译文'));
    if (mode !== 'ai-failed') assert.equal(await worker.evaluate(() => aiCalls), calls);
    await openWord(word);
    await card.getByText(notice, { exact: true }).waitFor();
    console.log(`PASS ${mode}: free translation retains the failure reason and AI authorization boundary`);
  }
  await worker.evaluate(async () => { globalThis.lookupMode = 'ai'; await chrome.storage.local.set({ deepseekApiKey: 'disposable-test-key' }); });
  await openWord('fitunconfigured');
  await card.getByText('受控 AI 释义', { exact: false }).waitFor();
  console.log('PASS cached free translation does not bypass newly configured AI fallback');
  assert.deepEqual(errors, []);
  await control.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 0); });
  // Runtime reload invalidates an already-open card. Waiting for that boundary is intentional.
  await page.waitForTimeout(250);
  await card.locator('select').selectOption('cambridge');
  await card.getByText('扩展已更新，请刷新当前网页', { exact: true }).waitFor();
  assert.equal(await card.getByRole('button', { name: '重试', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS real extension reload: stale word card requests a page refresh instead of an ineffective retry');
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
