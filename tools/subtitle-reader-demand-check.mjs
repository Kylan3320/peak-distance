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
        postMessage:({text})=>{sentences.push(text); queueMicrotask(()=>receive({ok:true,source:'browser-native',text:text.replace(/^Sentence number (\d+)\.$/,(_,n)=>'第'+n+'句').replace('Bonjour tout le monde.','大家好。')}));}};
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
  await row(0).locator('.zh').filter({hasText:'第0句'}).waitFor();
  const cc=page.locator('.ytp-subtitles-button');
  assert.equal(await cc.getAttribute('aria-pressed'),'false');
  assert.equal(await toggle.getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#blc-subs').count(),0);
  await toggle.click();
  await page.locator('#blc-subs .zh').filter({hasText:'第0句'}).waitFor();
  await toggle.click();
  await page.locator('#blc-subs').waitFor({state:'detached'});
  assert.equal(await cc.getAttribute('aria-pressed'),'false');
  assert.equal((await command({type:'blc-sub-get'})).cues[45].zh,null);
  await reader.locator('.body').hover();
  await page.mouse.wheel(0,2600);
  await row(45).evaluate(el=>el.scrollIntoView({block:'center'}));
  await row(45).locator('.zh').filter({hasText:'第45句'}).waitFor();
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
  await row(22).locator('.zh').filter({hasText:'第22句'}).waitFor();
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
  await row(0).locator('.zh').filter({hasText:'大家好。'}).waitFor();
  assert.equal(await cc.getAttribute('aria-pressed'),'false');
  assert.equal((await command({type:'blc-sub-get'})).trackLang,'fr');
  console.log('PASS cold reader acquires subtitles, restores native CC, shares results, translates visible rows while paused, and releases demand on close');

  const frame=page.frameLocator('#pd-floating-panel iframe');
  await row(0).locator('.w').filter({hasText:'Bonjour'}).click();
  await frame.getByRole('button',{name:'带原句提问'}).click();
  await frame.locator('#chat-attachment-summary').filter({hasText:'Bonjour'}).waitFor();
  assert.equal(await frame.locator('#chat-attachment-summary').innerText(),'Bonjour');
  await frame.locator('#chat-input').evaluate(node=>{
    if(document.activeElement!==node) throw new Error('Input did not receive focus');
  });
  await frame.locator('#chat-attachment-chip').click();
  const detail=frame.locator('#chat-attachment-detail');
  assert.ok((await detail.innerText()).includes('Bonjour tout le monde.'));
  console.log('PASS subtitle word card attaches the word as focus and only its original sentence as context');

  let finishBrazilian;
  const brazilianResponse = new Promise(resolve => { finishBrazilian = resolve; });
  await context.route(/\/api\/timedtext\?v=tracks01&/, async route => {
    const url = new URL(route.request().url());
    const text = url.searchParams.get('name');
    if (url.searchParams.get('lang') === 'pt-BR' && !url.searchParams.has('tlang')) {
      await brazilianResponse;
    }
    const events = url.searchParams.has('tlang') ? [] : [{tStartMs:0,dDurationMs:2000,segs:[{utf8:text+'.'}]}];
    await route.fulfill({json:{events}});
  });
  await context.route('https://www.youtube.com/watch?v=tracks01', route => route.fulfill({contentType:'text/html',body:`
    <!doctype html><title>Subtitle track selection</title><ytd-watch-flexy><div id="player-container-outer">
    <div id="movie_player"><video></video><div class="ytp-chrome-bottom"><div class="ytp-right-controls">
    <button class="ytp-subtitles-button" aria-pressed="false" aria-disabled="false">CC</button></div></div></div></div></ytd-watch-flexy>
    <script>
      const player = document.querySelector('#movie_player');
      const cc = document.querySelector('.ytp-subtitles-button');
      const tracks = [['ar','Arabic'],['en','Automatic English','asr'],['en','Manual English'],
                      ['pt-BR','Brazilian Portuguese'],['pt-PT','European Portuguese']].map(([languageCode,name,kind]) => ({
        languageCode, name, kind, baseUrl:'https://www.youtube.com/api/timedtext?v=tracks01&lang='+languageCode+
          '&name='+encodeURIComponent(name)+(kind ? '&kind='+kind : '')
      }));
      window.ytInitialPlayerResponse = {videoDetails:{videoId:'tracks01'},captions:{playerCaptionsTracklistRenderer:{
        captionTracks:tracks, defaultAudioTrackIndex:1, audioTracks:[{defaultCaptionTrackIndex:0},{defaultCaptionTrackIndex:1}]
      }}};
      let selected;
      cc.onclick = () => cc.setAttribute('aria-pressed', String(cc.getAttribute('aria-pressed') !== 'true'));
      player.loadModule = () => {};
      player.getOption = (_, key) => key === 'tracklist' ? tracks : selected;
      player.setOption = (_, key, value) => {
        selected = tracks.find(track => track.languageCode === value.languageCode && track.name === value.name);
        if (selected) {
          const {baseUrl, languageCode} = selected;
          fetch(baseUrl).then(response => response.json()).then(() => {
            if (languageCode === 'pt-BR') window.brazilianResponseDelivered = true;
          });
        }
      };
    </script>`}));

  await page.goto('https://www.youtube.com/watch?v=tracks01');
  await toggle.click();
  await page.locator('#blc-subs .en').filter({hasText:'Manual English.'}).waitFor();
  const settings = await command({type:'pd-video-settings-get'});
  assert.deepEqual(settings.tracks.map(track => track.lang), ['ar','en','en','pt-br','pt-pt']);
  assert.equal(settings.trackId, settings.tracks.find(track => track.name === 'Manual English').id);

  const selectTrack = async lang => {
    const current = await command({type:'pd-video-settings-get'});
    const trackId = current.tracks.find(track => track.lang === lang).id;
    const result = await command({type:'pd-video-settings-set', videoId:current.videoId, generation:current.generation, change:{trackId}});
    assert.equal(result.ok, true);
    return trackId;
  };
  await Promise.all([
    page.waitForRequest(request => request.url().includes('v=tracks01&lang=pt-BR')),
    selectTrack('pt-br'),
  ]);
  const europeanTrackId = await selectTrack('pt-pt');
  await page.locator('#blc-subs .en').filter({hasText:'European Portuguese.'}).waitFor();
  finishBrazilian();
  await page.waitForFunction(() => window.brazilianResponseDelivered);
  const settled = await command({type:'blc-sub-get'});
  assert.equal((await command({type:'pd-video-settings-get'})).trackId, europeanTrackId);
  assert.equal(settled.trackLang, 'pt-pt');
  assert.equal(settled.cues[0].text, 'European Portuguese.');
  console.log('PASS the default audio track prefers matching manual captions, and late captions cannot replace a selected regional variant');
} finally { await context.close(); }
