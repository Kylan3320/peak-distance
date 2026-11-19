import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { extensionPath } from './extension-path.mjs';

// A real MV3 floating reader, with a paused video, native CC initially off,
// and a track that is only published by the player after CC is enabled.
const context = await chromium.launchPersistentContext('', {
  executablePath: process.env.BLC_CHROME || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, viewport: {width:1280,height:800},
  args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`],
});
try {
  context.setDefaultTimeout(10000);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    await chrome.storage.local.set({displayLanguage:'zh-Hans',panelMode:'floating',bilingualEnabled:false,chineseVisible:true});
    globalThis.sentences = [];
    chrome.runtime.getContexts = async () => [{}];
    chrome.runtime.connect = () => {
      let receive;
      return {onMessage:{addListener:f=>{receive=f;}},onDisconnect:{addListener(){}},disconnect(){},
        postMessage:({text})=>{sentences.push(text); queueMicrotask(()=>receive({ok:true,source:'browser-native',text:'T '+text}));}};
    };
  });
  const source = Array.from({length:70},(_,i)=>({
    tStartMs:i*1000,dDurationMs:1000,segs:[{utf8:`Sentence number ${i}.`}]
  }));
  let releaseNewTrack;
  const newTrackGate = new Promise(resolve => { releaseNewTrack = resolve; });
  await context.route('https://www.youtube.com/api/timedtext?*',async route=>{
    const url = new URL(route.request().url());
    const french = url.searchParams.get('lang') === 'fr';
    if (french) await newTrackGate;
    await route.fulfill({json:{events:url.searchParams.has('tlang') ? [] : french ?
      [{tStartMs:0,dDurationMs:2000,segs:[{utf8:'Bonjour tout le monde.'}]}] : source}});
  });
  await context.route('https://www.youtube.com/watch?*',route=>route.fulfill({contentType:'text/html',body:`
    <!doctype html><title>Reader demand</title><ytd-watch-flexy><div id="player-container-outer">
    <div id="movie_player"><video></video><div class="ytp-chrome-bottom"><div class="ytp-right-controls">
    <button class="ytp-subtitles-button" aria-pressed="false" aria-disabled="false">CC</button></div></div></div></div></ytd-watch-flexy>
    <script>
      const player=document.querySelector('#movie_player'), cc=document.querySelector('.ytp-subtitles-button');
      const track={languageCode:'en',name:'English',baseUrl:'https://www.youtube.com/api/timedtext?v=demand01&lang=en'};
      const french={languageCode:'fr',baseUrl:'https://www.youtube.com/api/timedtext?v=demand01&lang=fr'};
      let selected=track; window.selectWhileClosed=()=>{selected=french};
      const events=window.bridge=[];window.ccClicks=0;
      addEventListener('message',e=>{if(e.data?.source==='blc-content')events.push(e.data.type)});
      cc.onclick=()=>{window.ccClicks++;const on=cc.getAttribute('aria-pressed')!=='true';cc.setAttribute('aria-pressed',String(on));if(on)fetch(selected.baseUrl)};
      player.getOption=(_,key)=>{if(key==='tracklist')return [track,french];if(selected===french){window.observedFrench=true;return french;}return cc.getAttribute('aria-pressed')==='true'?track:null;};
      player.loadModule=()=>{};player.setOption=()=>{};
    </script>`}));
  const page=await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=demand01');
  const toggle=page.locator('#blc-subs-switch #learning');
  await page.locator('#blc-subs-switch #learning:enabled').waitFor();
  assert.equal(await toggle.getAttribute('aria-pressed'),'false');
  assert.deepEqual(await page.evaluate(()=>bridge.filter(t=>t==='config')),[]);
  const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({active:true,currentWindow:true}))[0].id);
  const command=m=>worker.evaluate(({tabId,m})=>chrome.tabs.sendMessage(tabId,m,{frameId:0}),{tabId,m});
  await command({type:'pd-panel-show',view:'subs'});
  const reader=page.frameLocator('#pd-floating-panel iframe').locator('#blc-learning-panel');
  const row=n=>reader.locator(`[data-cue="${n}"]`);
  await row(0).locator('.zh').filter({hasText:'T Sentence number 0.'}).waitFor();
  const cc=page.locator('.ytp-subtitles-button');
  assert.equal(await cc.getAttribute('aria-pressed'),'false');
  assert.equal(await toggle.getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#blc-subs').count(),0);
  await toggle.click();
  await page.locator('#blc-subs .zh').filter({hasText:'T Sentence number 0.'}).waitFor();
  await toggle.click();
  await page.locator('#blc-subs').waitFor({state:'detached'});
  assert.equal(await cc.getAttribute('aria-pressed'),'false');
  assert.equal((await command({type:'blc-sub-get'})).cues[45].zh,null);
  await reader.locator('.body').hover();
  await page.mouse.wheel(0,2600);
  await row(45).evaluate(el=>el.scrollIntoView({block:'center'}));
  await row(45).locator('.zh').filter({hasText:'T Sentence number 45.'}).waitFor();
  assert.equal(await page.locator('video').evaluate(v=>v.paused&&v.currentTime===0),true);
  const cancellations=await page.evaluate(()=>bridge.filter(t=>t==='source-cancel').length);
  await command({type:'pd-panel-hide'});
  await page.waitForFunction(before=>bridge.filter(t=>t==='source-cancel').length>before,cancellations);
  assert.equal(await cc.getAttribute('aria-pressed'),'false');
  const clicks=await page.evaluate(()=>ccClicks);
  await command({type:'pd-panel-show',view:'subs'});
  await reader.locator('.body').hover();
  await page.mouse.wheel(0,-600);
  await row(22).evaluate(el=>el.scrollIntoView({block:'center'}));
  await row(22).locator('.zh').filter({hasText:'T Sentence number 22.'}).waitFor();
  assert.equal(await page.evaluate(()=>ccClicks),clicks);
  const received=await worker.evaluate(()=>sentences);
  assert.equal(received.filter(s=>s==='Sentence number 0.').length,1);
  assert.ok(received.length < source.length);
  const beforeChange=await page.evaluate(()=>bridge.filter(t=>t==='source-cancel').length);
  await command({type:'pd-panel-hide'});
  await page.waitForFunction(before=>bridge.filter(t=>t==='source-cancel').length>before,beforeChange);
  await page.evaluate(()=>selectWhileClosed());
  await page.waitForFunction(()=>window.observedFrench);
  assert.equal(await cc.getAttribute('aria-pressed'),'false');
  await command({type:'pd-panel-show',view:'subs'});
  await page.waitForFunction(()=>document.querySelector('.ytp-subtitles-button').getAttribute('aria-pressed')==='true');
  assert.deepEqual((await command({type:'blc-sub-get'})).cues,[]);
  releaseNewTrack();
  await row(0).locator('.zh').filter({hasText:'T Bonjour tout le monde.'}).waitFor();
  assert.equal(await cc.getAttribute('aria-pressed'),'false');
  assert.equal((await command({type:'blc-sub-get'})).trackLang,'fr');
  console.log('PASS cold reader acquires subtitles, restores native CC, shares results, translates visible rows while paused, and releases demand on close');
} finally { await context.close(); }
