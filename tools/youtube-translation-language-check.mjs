// Production MV3 content script; controlled captions and delayed platform replies.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const extension = resolve(process.env.PEAK_DISTANCE_UI_EXTENSION || '.output/chrome-mv3');
const temporaryRoot = resolve(tmpdir());
const profile = await mkdtemp(join(temporaryRoot, 'pd-translation-language-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.platform === 'win32'
      ? { executablePath: process.env.BLC_CHROME || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' }
      : { channel: 'chromium' }),
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(10000);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({
    defaultComprehensionLang: 'zh-Hans', comprehensionOverrides: {}, displayLanguage: 'zh-Hans',
    bilingualEnabled: true, chineseVisible: true,
  }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><title>Translation language check</title>
      <div id="movie_player"><video></video><div class="ytp-chrome-bottom"><div class="ytp-right-controls"></div></div>
      <button class="ytp-subtitles-button" aria-pressed="true"></button></div>
      <script>
      window.translationRequests = [];
      addEventListener('message', e => {
        const m = e.data;
        if (m?.source !== 'blc-content') return;
        if (m.type === 'config') {
          window.currentNonce = m.nonce;
          postMessage({ source: 'blc-inject', type: 'cues', nonce: m.nonce, videoId: 'abcdefghijk',
            trackId: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en',
            trackLang: 'en', trackKind: 'manual', seen: 1,
            cues: [{ start: 0, dur: 3000, lastOff: 0, text: 'An English subtitle.' }],
            fragments: [{ start: 0, dur: 3000, lastOff: 0, text: 'An English subtitle.' }], fragmentGroups: [0] }, '*');
        }
        if (m.type === 'translation-request') window.translationRequests.push(m);
      });
      </script></html>`,
  }));
  const video = await context.newPage();
  await video.goto('https://www.youtube.com/watch?v=abcdefghijk');
  await video.waitForFunction(() => window.translationRequests.length === 1);
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
  const readState = () => worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'blc-sub-get' }), tabId);
  const changeSettings = patch => worker.evaluate(patch => chrome.storage.local.set(patch), patch);
  const requests = () => video.evaluate(() => window.translationRequests);
  const captionCache = () => worker.evaluate(async () => Object.entries((await chrome.storage.session.get('online-cache-v1'))['online-cache-v1'] ?? {})
    .filter(([key]) => key.startsWith('captions:') && JSON.parse(key.slice(9))[1] === 'groups')
    .map(([key, entry]) => ({ target: JSON.parse(key.slice(9))[4], cues: entry.value })));
  async function waitForState(predicate, label) {
    const deadline = Date.now() + 10000;
    let state;
    do {
      state = await readState();
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    assert.fail(`${label}: ${JSON.stringify(state)}`);
  }
  async function reply(index, translation) {
    await video.evaluate(async ({ index, translation }) => {
      const request = window.translationRequests[index];
      postMessage({ source: 'blc-inject', type: 'translation', nonce: window.currentNonce,
        videoId: request.videoId, trackId: request.trackId, requestId: request.requestId,
        cues: [{ start: 0, dur: 3000, lastOff: 0, text: 'An English subtitle.', zh: translation }],
        fragments: [{ start: 0, dur: 3000, lastOff: 0, text: 'An English subtitle.', zh: translation }] }, '*');
      await new Promise(resolve => setTimeout(resolve, 0));
    }, { index, translation });
  }
  async function waitForCache(target, translation) {
    const deadline = Date.now() + 10000;
    do {
      if ((await captionCache()).some(entry => entry.target === target && entry.cues[0].zh === translation)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    assert.fail(`Missing ${target} caption cache`);
  }

  assert.equal((await requests())[0].targetLang, 'zh-Hans');
  await changeSettings({ defaultComprehensionLang: 'fr' });
  await waitForState(state => state.translationLang === 'fr', 'Target language should change');
  await reply(0, '一条中文译文。');
  assert.equal((await readState()).cues[0].zh, null, 'An old target response must not become visible');
  assert.equal((await captionCache()).length, 0, 'An old target response must not enter the new target cache');
  await video.waitForFunction(() => window.translationRequests.length === 2);
  assert.equal((await requests())[1].targetLang, 'fr');
  await reply(1, 'Un sous-titre français.');
  await waitForState(state => state.cues[0].zh === 'Un sous-titre français.', 'The new target should translate');
  await waitForCache('fr', 'Un sous-titre français.');
  assert.deepEqual((await captionCache()).map(entry => [entry.target, entry.cues[0].zh]), [['fr', 'Un sous-titre français.']]);
  console.log('PASS a target change rejects the old platform reply and cache write, then requests and stores the new target');

  await changeSettings({ defaultComprehensionLang: 'de', comprehensionOverrides: { en: 'fr' }, displayLanguage: 'en' });
  await video.waitForFunction(() => document.getElementById('blc-subs')?.lang === 'en');
  await waitForState(state => state.translationLang === 'fr' && state.cues[0].zh === 'Un sous-titre français.', 'An effective source override should retain the translation');
  assert.equal((await requests()).length, 2, 'An unchanged effective target should not refetch');
  await changeSettings({ comprehensionOverrides: { en: 'de' } });
  await waitForState(state => state.translationLang === 'de', 'A changed source override should apply');
  assert.equal((await readState()).cues[0].zh, null, 'The previous target translation should clear');
  await video.waitForFunction(() => window.translationRequests.length === 3);
  assert.equal((await requests())[2].targetLang, 'de');
  await reply(2, 'Ein deutscher Untertitel.');
  await waitForState(state => state.cues[0].zh === 'Ein deutscher Untertitel.', 'The overridden target should translate');
  await waitForCache('de', 'Ein deutscher Untertitel.');
  await changeSettings({ comprehensionOverrides: { en: 'fr' } });
  await waitForState(state => state.translationLang === 'fr' && state.cues[0].zh === 'Un sous-titre français.', 'Returning to a target should restore its cache');
  assert.equal((await requests()).length, 3, 'A completed target cache should avoid another platform request');
  await reply(0, '迟到的旧译文。');
  assert.equal((await readState()).cues[0].zh, 'Un sous-titre français.');
  assert.deepEqual((await captionCache()).map(entry => [entry.target, entry.cues[0].zh]).sort(), [
    ['de', 'Ein deutscher Untertitel.'], ['fr', 'Un sous-titre français.'],
  ]);
  console.log('PASS source language overrides clear only changed targets, cache hits restore the correct language, and stale responses stay rejected');
} finally {
  await context?.close();
  if (resolve(profile).startsWith(temporaryRoot + sep)) await rm(profile, { recursive: true, force: true });
}
