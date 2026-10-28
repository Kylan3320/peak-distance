// Focused runtime checks of the changed acquisition and reading paths. No user profile or vault.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const results = [];
const check = (name, condition) => { assert.ok(condition, name); results.push(name); console.log(`PASS ${name}`); };
const compile = async contents => (await build({stdin:{contents,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'ReadingTest',plugins:[{
  name:'inline-css',setup(b){b.onResolve({filter:/\.css\?inline$/},a=>({path:resolve(a.resolveDir,a.path.replace('?inline','')),namespace:'inline-css'}));b.onLoad({filter:/.*/,namespace:'inline-css'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}
}]})).outputFiles[0].text;

const json={events:[
  {tStartMs:0,dDurationMs:800,segs:[{utf8:'This'}]},
  {tStartMs:200,dDurationMs:800,segs:[{utf8:'This is'}]},
  {tStartMs:1000,dDurationMs:1000,segs:[{utf8:'one sentence.'}]},
  {tStartMs:2000,dDurationMs:1000,segs:[{utf8:'The next sentence.'}]},
]};
const translatedJson={events:[
  {tStartMs:0,dDurationMs:1000,segs:[{utf8:'这是'}]},
  {tStartMs:1000,dDurationMs:1000,segs:[{utf8:'一个句子。'}]},
  {tStartMs:2000,dDurationMs:1000,segs:[{utf8:'下一句。'}]},
]};
const output=resolve('.upstream/subtitle-reading');await mkdir(output,{recursive:true});

if(!process.argv.includes('--packaged-only')) {
// Run the real MAIN entrypoint, with a native request first returning empty and then valid data.
const inject = await compile("import './entrypoints/youtube-inject.content';");
const messages=[], requests=[], listeners=[];let now=0;
const scope={URL,AbortController,AbortSignal,Response,Map,Set,console,location:{href:'https://www.youtube.com/watch?v=reading01'},performance:{now:()=>++now,getEntriesByType:()=>[]},document:{getElementById:()=>null},setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,XMLHttpRequest:class{open(){}send(){}},defineContentScript:c=>c.main(),__listeners:listeners};
scope.window=scope;
scope.addEventListener=(type,fn)=>{if(type==='message')listeners.push(fn);};
scope.postMessage=data=>messages.push(data);
scope.fetch=async url=>{const u=new URL(String(url));requests.push(u.searchParams.get('phase'));return new Response(u.searchParams.get('phase')==='empty'?'':JSON.stringify(json));};
const sandbox=vm.createContext(scope);
vm.runInContext('globalThis.emit=data=>__listeners.forEach(fn=>fn({source:window,data}));',sandbox);
vm.runInContext(inject,sandbox);
const settle=()=>new Promise(r=>setTimeout(r,25));
scope.emit({source:'blc-content',type:'config',nonce:1});
const source=phase=>`https://www.youtube.com/api/timedtext?v=reading01&lang=en&kind=asr&phase=${phase}`;
await scope.fetch(source('empty'));await settle();
check('empty response is observed without producing cues',messages.some(x=>x.type==='nocues')&&!messages.some(x=>x.type==='cues'));
const before=requests.length;await scope.fetch(source('empty'));await settle();
check('repeated failed URL is not fetched again by extension',requests.length===before+1);
await scope.fetch(source('valid'));await settle();
const produced=messages.find(x=>x.type==='cues');
check('later valid native source recovers in the same acquisition',produced?.cues.length===2&&produced.cues[0].text==='This is one sentence.');
check('MAIN preserves normalized short fragments and explicit group mapping',produced.fragments.length===3&&produced.fragments[0].text==='This is'&&JSON.stringify(produced.fragmentGroups)==='[0,0,1]');
scope.emit({source:'blc-content',type:'config',nonce:2});
await settle();
scope.emit({source:'blc-content',type:'source-cancel',nonce:2});
const completed=messages.filter(x=>x.type==='cues').length;
await scope.fetch(source('another'));await settle();
check('explicit cancellation does not restart on a later captured source',messages.filter(x=>x.type==='cues').length===completed);

const componentCode=await compile("export {createYoutubeWorkspace} from './shared/youtubeWorkspace'; export {createLookupPopup} from './shared/lookupPopup';");
const browser=await chromium.launch({executablePath:process.env.BLC_CHROME||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try {
  const page=await browser.newPage({viewport:{width:800,height:700}});page.setDefaultTimeout(8000);
  await page.setContent('<div id="mount" style="height:500px;width:380px"></div>');
  await page.evaluate(()=>{window.browser={runtime:{getURL:()=>''}};});
  await page.addScriptTag({content:componentCode});
  await page.evaluate(()=>{
    const cues=Array.from({length:35},(_,i)=>({start:i*3000,dur:3000,lastOff:i*3000,text:`This is learning sentence number ${i}.`}));
    window.readingState={videoId:'reading01',videoRef:{videoId:'reading01',trackId:'https://www.youtube.com/api/timedtext?v=reading01&lang=en',trackKind:'manual',trackLang:'en',startMs:0},cues,current:1,translations:new Map(cues.map((_,i)=>[i,'完整译文用于检查收藏后的阅读位置，译文占据多行时也应该保持稳定。'.repeat(3)])),statuses:new Map(),sentences:[],entries:[],notice:'',chinese:true};
    window.saveCalls=0;window.failSave=false;
    window.workspace=ReadingTest.createYoutubeWorkspace({bindWords:()=>()=>{},words:(el,text)=>el.textContent=text,seek:()=>{},lookup:()=>{},ask:()=>{},open:()=>{},status:()=>{},remove:async()=>({ok:true}),save:async index=>{
      window.saveCalls++;await new Promise(r=>setTimeout(r,90));if(window.failSave)return {ok:false};
      const state=window.readingState,cue=state.cues[index];state.sentences=[{id:'fixture',video:{...state.videoRef,startMs:cue.start},text:cue.text}];window.workspace.update({...state});return {ok:true};
    }},document.getElementById('mount'));
    window.workspace.update(window.readingState);
  });
  const body=page.locator('#blc-learning-panel .body');
  await body.hover();await page.mouse.wheel(0,20000);await body.evaluate(el=>{window.savedRow=el.lastElementChild;});
  await page.waitForFunction(()=>window.workspace.snapshot().follow===false);
  const top=await body.evaluate(el=>el.scrollTop);
  const row=page.locator('#blc-learning-panel [data-cue="34"]');
  await row.getByRole('button',{name:'收藏句子',exact:true}).click();
  await row.getByRole('button',{name:'取消收藏',exact:true}).waitFor();
  check('saved update preserves row node and translated reading position',await body.evaluate((el,top)=>el.lastElementChild===window.savedRow&&Math.abs(el.scrollTop-top)<2,top));
  check('save is confirmed without switching manual follow intent',await page.evaluate(()=>window.saveCalls===1&&!window.workspace.snapshot().follow));
  await page.getByRole('button',{name:'当前字幕',exact:true}).click();
  await page.waitForFunction(()=>window.workspace.snapshot().follow);
  const selectCurrent=()=>page.evaluate(()=>{const root=document.getElementById('blc-learning-panel').shadowRoot,el=root.querySelector(`[data-cue="${window.readingState.current}"] .en`),r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);});
  await selectCurrent();await page.waitForTimeout(30);
  const selectedTop=await body.evaluate(el=>el.scrollTop);
  await page.evaluate(()=>{window.readingState.current=20;window.workspace.update({...window.readingState});});
  check('active selection temporarily holds automatic following',Math.abs(await body.evaluate(el=>el.scrollTop)-selectedTop)<2&&await page.evaluate(()=>window.workspace.snapshot().follow));
  await page.evaluate(()=>getSelection().removeAllRanges());
  await page.waitForFunction(top=>Math.abs(document.getElementById('blc-learning-panel').shadowRoot.querySelector('.body').scrollTop-top)>100,selectedTop);
  check('clearing selection resumes prior automatic intent',await page.evaluate(()=>window.workspace.snapshot().follow));
  await body.hover();await page.mouse.wheel(0,20000);await page.waitForFunction(()=>!window.workspace.snapshot().follow);
  await selectCurrent();await page.waitForTimeout(30);await page.evaluate(()=>getSelection().removeAllRanges());await page.waitForTimeout(30);
  check('clearing selection preserves prior manual intent',await page.evaluate(()=>!window.workspace.snapshot().follow));
  await page.evaluate(()=>{window.failSave=true;});
  const failureRow=page.locator('#blc-learning-panel [data-cue="33"]');
  await failureRow.getByRole('button',{name:'收藏句子',exact:true}).click();
  await failureRow.getByText('保存失败，请重试。',{exact:true}).waitFor();
  check('failed save restores an enabled retry button',await failureRow.getByRole('button',{name:'收藏句子',exact:true}).isEnabled());
  await page.screenshot({path:resolve(output,'subtitle-workspace.png')});

  await page.evaluate(()=>{
    window.lookupCalls=0;window.lookupFail=true;
    window.lookup=ReadingTest.createLookupPopup({send:async m=>{
      if(m.type==='save'){window.lookupCalls++;await new Promise(r=>setTimeout(r,90));return window.lookupFail?{ok:false,error:'io'}:{ok:true,key:'en::learning',contextId:1,status:'saved',appended:true};}
      if(m.type==='getEntry')return {ok:true,entry:null};
      if(m.type==='lookup')return {ok:false,error:'network'};
      return {ok:true};
    }});
    window.lookup.open({snapshot:{source:'web',expression:'learning',sentence:'Learning helps.',url:'https://example.com',title:'Example',lang:'en'}});
  });
  const card=page.locator('#blc-lookup-popup');
  await card.getByRole('button',{name:'收藏',exact:true}).click();
  await card.getByText('保存失败，请重试。',{exact:true}).waitFor();
  await page.evaluate(()=>{window.lookupFail=false;});
  await card.getByRole('button',{name:'收藏',exact:true}).evaluate(el=>{el.click();el.click();});
  await card.getByRole('button',{name:'已收藏',exact:true}).waitFor();
  check('lookup repeated click commits once and success uses bookmark state',await page.evaluate(()=>window.lookupCalls===2)&&await card.getByRole('button',{name:'已收藏',exact:true}).isDisabled());
  check('lookup has no green save-success line',!(await card.locator('#blc-feedback').textContent()).trim());
  await page.screenshot({path:resolve(output,'lookup-saved.png')});
  console.log(`${results.length} focused runtime checks passed.`);
} finally {await browser.close();}
}

// Packaged MV3 integration: real MAIN/content scripts, messages, IndexedDB and AP.
const profile=await mkdtemp(join(tmpdir(),'pd-reading-'));
const extension=resolve('.output/chrome-mv3');
const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.BLC_CHROME||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width:1280,height:850},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--autoplay-policy=no-user-gesture-required']});
context.setDefaultTimeout(10000);
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  await worker.evaluate(()=>chrome.storage.local.set({regularTranslation:'google-gtx',displayLanguage:'zh-Hans',panelMode:'floating'}));
  const control=await context.newPage();await control.goto(`chrome-extension://${id}/options.html`);
  const fixture=`<!doctype html><title>Subtitle reading fixture</title><ytd-watch-flexy><div id="player-container-outer"><div id="movie_player" style="height:240px;position:relative"><video style="width:100%;height:200px"></video><div class="ytp-chrome-bottom"><div class="ytp-right-controls"><button class="ytp-subtitles-button" aria-pressed="true" aria-disabled="false">CC</button></div></div></div></div></ytd-watch-flexy><script>
    const vid=new URL(location.href).searchParams.get('v'),p=document.getElementById('movie_player'),v=document.querySelector('video');
    const track={languageCode:'en',kind:'asr',name:'',baseUrl:'https://www.youtube.com/api/timedtext?v='+vid+'&lang=en&kind=asr&phase=empty'};
    let current=track;p.getOption=(module,key)=>key==='tracklist'?[track]:current;p.setOption=(module,key,t)=>{current=t.languageCode?track:null;};p.loadModule=()=>{};
    document.querySelector('.ytp-subtitles-button').onclick=e=>e.currentTarget.setAttribute('aria-pressed',e.currentTarget.getAttribute('aria-pressed')!=='true');
    const bytes=new Uint8Array(44+8000*2*10),d=new DataView(bytes.buffer),str=(at,s)=>[...s].forEach((c,i)=>bytes[at+i]=c.charCodeAt(0));str(0,'RIFF');d.setUint32(4,bytes.length-8,true);str(8,'WAVE');str(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,8000,true);d.setUint32(28,16000,true);d.setUint16(32,2,true);d.setUint16(34,16,true);str(36,'data');d.setUint32(40,bytes.length-44,true);v.src=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
    window.addEventListener('message',e=>{if(e.data?.source==='blc-content'&&e.data.type==='config'){fetch(track.baseUrl);if(vid!=='emptyonly')setTimeout(()=>fetch(track.baseUrl.replace('empty','valid')),100);}});
  </script>`;
  await context.route('https://www.youtube.com/watch?*',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await context.route('https://www.youtube.com/api/timedtext?*',r=>{const u=new URL(r.request().url());return r.fulfill({contentType:'application/json',body:u.searchParams.has('tlang')?(u.searchParams.get('v')==='fallback01'?'':JSON.stringify(translatedJson)):u.searchParams.get('phase')==='empty'?'':JSON.stringify(json)});});
  const page=await context.newPage();await page.goto('https://www.youtube.com/watch?v=reading01');
  await page.locator('#blc-subs .en').filter({hasText:/^This is$/}).waitFor();
  await page.locator('#blc-subs .zh').filter({hasText:/^这是$/}).waitFor();
  const tabId=await control.evaluate(async()=> (await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0].id);
  const action=m=>control.evaluate(({tabId,m})=>chrome.tabs.sendMessage(tabId,m),{tabId,m});
  const state=await action({type:'blc-sub-get'});
  check('packaged acquisition recovers into grouped sidebar sentences',state.cues.length===2&&state.cues[0].text==='This is one sentence.'&&state.cues[1].text==='The next sentence.');
  check('player starts with ASR-normalized short original and matching translation',await page.locator('#blc-subs .en').textContent()==='This is'&&await page.locator('#blc-subs .zh').textContent()==='这是');
  await page.locator('#blc-subs-switch #learning').click();await page.locator('#blc-subs-switch #panel').click();
  await page.frameLocator('#pd-floating-panel iframe').locator('#blc-learning-panel .en').first().waitFor();
  const frame=page.frames().find(f=>f.url().includes('/sidepanel.html'));
  const firstSidebarRow=frame.locator('#blc-learning-panel [data-cue="0"]');
  check('sidebar keeps the full grouped original and translation',await firstSidebarRow.locator('.en').textContent()==='This is one sentence.'&&await firstSidebarRow.locator('.zh').textContent()==='这是 一个句子。');
  await page.evaluate(()=>{document.querySelector('video').currentTime=1.2;});
  await page.locator('#blc-subs .en').filter({hasText:/^one sentence\.$/}).waitFor();
  await page.locator('#blc-subs .zh').filter({hasText:/^一个句子。$/}).waitFor();
  check('advancing inside a group changes both player lines while sidebar stays full',await firstSidebarRow.locator('.en').textContent()==='This is one sentence.'&&(await action({type:'blc-sub-get'})).currentIndex===0);
  await page.screenshot({path:resolve(output,'packaged-fragment-sidebar.png')});
  await page.locator('#blc-subs .en').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,composed:true}));});
  await page.locator('#pd-phrase-actions').waitFor();
  await control.waitForFunction(async tabId=>{const result=await chrome.runtime.sendMessage({type:'selectionCandidateGet',tabId});return result?.candidate?.text==='one sentence.';},tabId);
  const selected=await control.evaluate(tabId=>chrome.runtime.sendMessage({type:'selectionCandidateGet',tabId}),tabId);
  check('player selection source uses visible fragment text and times',selected.candidate.cue.text==='one sentence.'&&selected.candidate.cue.startMs===1000&&selected.candidate.cue.endMs===2000);
  await page.evaluate(()=>getSelection().removeAllRanges());await page.locator('#pd-phrase-actions').waitFor({state:'detached'});
  check('packaged player selection bubble closes with selection',true);
  await firstSidebarRow.getByRole('button',{name:'0:00',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('video').currentTime<.1);
  check('sidebar time action seeks to full grouped sentence start',await page.locator('#blc-subs .en').textContent()==='This is');
  await firstSidebarRow.getByRole('button',{name:'收藏句子',exact:true}).click();
  await firstSidebarRow.getByRole('button',{name:'取消收藏',exact:true}).waitFor();
  const records=await control.evaluate(()=>chrome.runtime.sendMessage({type:'listSentences'}));
  check('sidebar save confirms actual full-sentence persistence',records.sentences[0]?.text===state.cues[0].text&&records.sentences[0]?.video.startMs===0&&records.sentences[0]?.endMs===2000);
  await firstSidebarRow.locator('.en').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,composed:true}));});
  await frame.locator('#panel-selection-actions').waitFor();
  await frame.locator('.brand-name').click();await frame.locator('#panel-selection-actions').waitFor({state:'detached'});
  check('packaged sidepanel selection bubble closes on outside click',true);
  await page.locator('#pd-floating-panel').evaluate(el=>el.style.width='320px');
  check('narrow sidepanel keeps content within viewport',await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(output,'packaged-sidebar.png')});
  await page.locator('#blc-subs-switch #learning').click();await page.locator('#blc-subs-switch #ap').check();
  await page.locator('#blc-subs-switch #ap').waitFor({state:'attached'});
  await page.waitForFunction(()=>!document.getElementById('blc-subs-switch').shadowRoot.querySelector('#ap').disabled);
  await action({type:'pd-video-action',action:'seek',index:0,videoId:'reading01'});
  await page.evaluate(()=>document.querySelector('video').play());
  await page.waitForFunction(()=>document.querySelector('video').paused&&document.querySelector('video').currentTime>=2);
  check('AP pauses at merged sentence end rather than first fragment',await page.evaluate(()=>document.querySelector('video').currentTime<2.4));
  check('AP holds the grouped sentence final short fragment and its translation',await page.locator('#blc-subs .en').textContent()==='one sentence.'&&await page.locator('#blc-subs .zh').textContent()==='一个句子。'&&(await action({type:'blc-sub-get'})).currentIndex===0);
  await page.screenshot({path:resolve(output,'packaged-ap-held.png')});

  // One regular-service fallback batch covers both index domains and a cancelled
  // epoch. The first response is deliberately released after translation is off.
  await worker.evaluate(()=>{
    globalThis.fallbackBatches=[];globalThis.fallbackStarted=false;globalThis.releaseOldFallback=null;
    globalThis.fallbackReady=new Promise(resolve=>{globalThis.markFallbackReady=resolve;});
    globalThis.fallbackCancelled=new Promise(resolve=>{globalThis.markFallbackCancelled=resolve;});
    chrome.runtime.onMessage.addListener(m=>{if(m.type==='translateCues'&&m.videoId==='fallback01')globalThis.fallbackBatches.push(structuredClone(m.items));});
    const originalFetch=globalThis.fetch;
    globalThis.fetch=async(input,options)=>{
      const url=new URL(String(input));if(url.hostname!=='translate.googleapis.com')return originalFetch(input,options);
      const text=url.searchParams.get('q');
      if(!globalThis.fallbackStarted){globalThis.fallbackStarted=true;options.signal.addEventListener('abort',()=>globalThis.markFallbackCancelled(),{once:true});await new Promise(resolve=>{globalThis.releaseOldFallback=resolve;globalThis.markFallbackReady();});return new Response(JSON.stringify([[['OLD EPOCH',text]],null,'en']));}
      const translated={'This is one sentence.':'整句回退译文','This is':'片段甲','one sentence.':'片段乙','The next sentence.':'后句译文'}[text];
      if(!translated)throw new Error(`Unexpected fallback text: ${text}`);
      return new Response(JSON.stringify([[[translated,text]],null,'en']));
    };
  });
  const fallback=await context.newPage();await fallback.goto('https://www.youtube.com/watch?v=fallback01');
  await fallback.locator('#blc-subs .en').filter({hasText:/^This is$/}).waitFor();
  await worker.evaluate(()=>Promise.race([globalThis.fallbackReady,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Fallback request did not start')),8000))]));
  await fallback.locator('#blc-subs-switch #learning').click();await fallback.locator('#blc-subs-switch #chinese').uncheck();
  await worker.evaluate(()=>Promise.race([globalThis.fallbackCancelled,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Fallback request was not cancelled')),8000))]));
  await worker.evaluate(()=>globalThis.releaseOldFallback());
  await fallback.waitForTimeout(100);
  check('cancelled fallback epoch cannot reapply a late translation',await fallback.locator('#blc-subs .zh').count()===0&&!JSON.stringify(await control.evaluate(async()=>{const tab=(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0];return chrome.tabs.sendMessage(tab.id,{type:'blc-sub-get'});})).includes('OLD EPOCH'));
  await fallback.locator('#blc-subs-switch #chinese').check();
  await fallback.locator('#blc-subs .zh').filter({hasText:/^片段甲$/}).waitFor();
  const fallbackTab=await control.evaluate(async()=> (await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0].id);
  const fallbackState=()=>control.evaluate(tabId=>chrome.tabs.sendMessage(tabId,{type:'blc-sub-get'}),fallbackTab);
  const translatedState=await fallbackState();
  check('regular fallback keeps whole-sentence and fragment translation domains separate',translatedState.cues[0].zh==='整句回退译文'&&await fallback.locator('#blc-subs .zh').textContent()==='片段甲'&&await worker.evaluate(()=>globalThis.fallbackBatches.some(items=>items.some(i=>i.id===0&&i.text==='This is one sentence.')&&items.some(i=>i.id===2&&i.text==='This is')&&items.some(i=>i.id===3&&i.text==='one sentence.'))));
  await fallback.evaluate(()=>{document.querySelector('video').currentTime=1.2;});
  await fallback.locator('#blc-subs .zh').filter({hasText:/^片段乙$/}).waitFor();
  check('fallback fragment advance does not repeat full-group translation',await fallback.locator('#blc-subs .en').textContent()==='one sentence.'&&(await fallbackState()).cues[0].zh==='整句回退译文');

  const failed=await context.newPage();await failed.goto('https://www.youtube.com/watch?v=emptyonly');
  const started=Date.now();
  await failed.locator('#blc-subs .notice').filter({hasText:'字幕响应为空'}).waitFor({timeout:34000});
  check('empty source ends at overall deadline, not first empty response',Date.now()-started>=28000&&Date.now()-started<33500);
  console.log(`${results.length} focused checks passed (including packaged MV3).`);
} finally {
  await context.close();
  const target=resolve(profile);if(!target.startsWith(resolve(tmpdir())+sep)||!target.includes('pd-reading-'))throw new Error('Unexpected test profile path');
  await rm(target,{recursive:true,force:true,maxRetries:3});
}





