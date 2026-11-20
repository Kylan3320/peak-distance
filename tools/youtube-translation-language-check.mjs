// Production MV3 content script; controlled captions and delayed platform replies.
import { extensionPath as extension } from './extension-path.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

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
            trackLang: 'en', trackKind: 'manual', seen: 1, revision: 'fixture',
            cues: [{ start: 0, dur: 3000, lastOff: 0, text: 'An English subtitle.', from: 0, to: 20,
              firstFragment: 0, lastFragment: 0, firstOffset: 0, lastOffset: 20 },
              { start: 3000, dur: 3000, lastOff: 0, text: 'The next subtitle.', from: 21, to: 39,
                firstFragment: 1, lastFragment: 1, firstOffset: 0, lastOffset: 18 }],
            fragments: [{ start: 0, dur: 3000, lastOff: 0, text: 'An English subtitle.', firstEvent: 0, lastEvent: 0 },
              { start: 3000, dur: 3000, lastOff: 0, text: 'The next subtitle.', firstEvent: 1, lastEvent: 1 }],
            blocks: [{ start: 0, dur: 3000, lastOff: 0, text: 'An English subtitle.' },
              { start: 3000, dur: 3000, lastOff: 3000, text: 'The next subtitle.' }],
            blockRanges: [{ from: 0, to: 20 }, { from: 21, to: 39 }] }, '*');
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
    .filter(([key]) => key.startsWith('captions:'))
    .map(([key, entry]) => ({ target: JSON.parse(key.slice(9))[3], cues: entry.value })));
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
        cues: [{ start: 0, dur: 3000, lastOff: 0, text: 'An English subtitle.', from: 0, to: 20, zh: translation }] }, '*');
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
  await waitForState(state => state.translationLang === 'de', 'The global target should take priority over legacy data');
  assert.equal((await readState()).cues[0].zh, null, 'The previous target translation should clear');
  await video.waitForFunction(() => window.translationRequests.length === 3);
  assert.equal((await requests())[2].targetLang, 'de');
  await reply(2, 'Ein deutscher Untertitel.');
  await waitForCache('de', 'Ein deutscher Untertitel.');
  await changeSettings({ comprehensionOverrides: { en: 'it' }, displayLanguage: 'fr' });
  await video.waitForFunction(() => document.getElementById('blc-subs')?.lang === 'fr');
  assert.equal((await readState()).translationLang,'de');
  await changeSettings({ defaultComprehensionLang:'fr' });
  await waitForState(state => state.translationLang === 'fr' && state.cues[0].zh === 'Un sous-titre français.', 'Returning to a target should restore its cache');
  assert.equal((await requests()).length, 3, 'A completed target cache should avoid another platform request');
  await reply(0, '迟到的旧译文。');
  assert.equal((await readState()).cues[0].zh, 'Un sous-titre français.');
  assert.deepEqual((await captionCache()).map(entry => [entry.target, entry.cues[0].zh]).sort(), [
    ['de', 'Ein deutscher Untertitel.'], ['fr', 'Un sous-titre français.'],
  ]);
  console.log('PASS legacy source rules are ignored, changing the shared target restores its own cache, and late replies stay rejected');
  const control = await context.newPage();
  await control.goto(new URL('options.html',worker.url()).href);
  await worker.evaluate(() => {
    chrome.runtime.getContexts = async () => [{}];
    chrome.runtime.connect = () => {
      let receive;
      return {onMessage:{addListener:fn=>{receive=fn;}},onDisconnect:{addListener(){},removeListener(){}},
        disconnect(){},postMessage:({text,langs})=>queueMicrotask(()=>receive(
          langs.target==='es' && text.startsWith('An English')
            ? {ok:true,source:'browser-native',text:'内置字幕译文'}
            : {ok:false,source:'browser-native',error:'native-unavailable'}
        ))};
    };
    globalThis.fetch = async url => {
      if (!String(url).includes('translate.googleapis.com')) throw Error('Unexpected subtitle test request');
      return Response.json([[['Google 字幕译文']],null,'en']);
    };
  });
  const count=(await requests()).length;
  await changeSettings({defaultComprehensionLang:'es',displayLanguage:'zh-Hans'});
  await video.waitForFunction(n=>window.translationRequests.length>n,count);
  await reply(count,'');
  const mixed=await waitForState(s=>s.cues[0].zh==='内置字幕译文' && s.cues[1].zh==='Google 字幕译文','Regular fallback should translate both cues');
  for (const [index,label] of [[0,'浏览器内置翻译'],[1,'Google 翻译']]) {
    const ack=await worker.evaluate(({tabId,state,index})=>chrome.tabs.sendMessage(tabId,{
      type:'pd-video-action',action:'save',index,text:state.cues[index].text,
      vaultId:null,removeId:null,
      videoId:state.videoId,trackId:state.trackId,generation:state.generation,
    }),{tabId,state:mixed,index});
    assert.equal(ack.ok,true);
    const saved=await control.evaluate(()=>chrome.runtime.sendMessage({type:'listSentences'}));
    assert.equal(saved.sentences.length,1);
    assert.equal(saved.sentences[0].translationSource,label);
    assert.equal(saved.sentences[0].zh,mixed.cues[index].zh);
    assert.equal((await control.evaluate(id=>chrome.runtime.sendMessage({type:'deleteSentence',id}),saved.sentences[0].id)).ok,true);
  }
  console.log('PASS captions in a mixed native/Google batch keep each actual source after bookmarking');

  await worker.evaluate(()=>{
    globalThis.attemptedFallback=[];
    globalThis.rejectFallback=true;
    globalThis.fetch=async url=>{
      const text=new URL(String(url)).searchParams.get('q');
      globalThis.attemptedFallback.push(text);
      if(globalThis.rejectFallback)return new Response('',{status:503});
      return Response.json([[[`Recovered ${text}`]],null,'en']);
    };
  });
  const recoveryIndex=(await requests()).length;
  await changeSettings({defaultComprehensionLang:'pl'});
  await video.waitForFunction(n=>window.translationRequests.length>n,recoveryIndex);
  await reply(recoveryIndex,'');
  await video.locator('#blc-subs .notice').filter({hasText:'翻译暂不可用'}).waitFor();
  assert.equal(await worker.evaluate(()=>globalThis.attemptedFallback.length),1);
  await worker.evaluate(()=>{globalThis.rejectFallback=false;});
  const recovered=await waitForState(s=>s.cues.every(c=>c.zh===`Recovered ${c.text}`),'Transient failure must keep every eligible subtitle pending');
  assert.equal(recovered.cues.length,2);

  await worker.evaluate(()=>{
    globalThis.delayedGoogle=false;
    globalThis.fetch=async url=>{
      if(new URL(url).searchParams.get('tl')!=='pt') return Response.json([[['New Google direction']],null,'en']);
      globalThis.delayedGoogle=true;
      return await new Promise(resolve=>globalThis.finishGoogle=()=>resolve(Response.json([[['Late Google']],null,'en'])));
    };
  });
  const switchIndex=(await requests()).length;
  await changeSettings({defaultComprehensionLang:'pt'});
  await video.waitForFunction(n=>window.translationRequests.length>n,switchIndex);
  await reply(switchIndex,'Existing platform translation');
  const waitUntilGoogle=Date.now()+10000;
  while(!await worker.evaluate(()=>globalThis.delayedGoogle)){
    assert.ok(Date.now()<waitUntilGoogle,'expected an in-flight Google fallback');
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  await changeSettings({defaultComprehensionLang:'it'});
  await video.waitForFunction(n=>window.translationRequests.length>n,switchIndex+1);
  await reply(switchIndex+1,'New platform direction');
  await worker.evaluate(()=>globalThis.finishGoogle());
  await waitForState(s=>s.cues[0].zh==='New platform direction'&&s.cues[1].zh==='New Google direction','Direction change preserves the new platform result and routes remaining rows');
  assert.equal((await requests()).length,switchIndex+2);
  console.log('PASS early batch failure preserves unattempted work and late Google replies cannot overwrite the new direction');

} finally {
  await context?.close();
  if (resolve(profile).startsWith(temporaryRoot + sep)) await rm(profile, { recursive: true, force: true });
}
