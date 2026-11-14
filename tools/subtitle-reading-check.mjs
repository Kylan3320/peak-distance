// Focused runtime checks of the changed acquisition and reading paths. No user profile or vault.
import { extensionPath as extension } from './extension-path.mjs';
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
const output=resolve('.upstream/subtitle-reading');await mkdir(output,{recursive:true});

if(!process.argv.includes('--packaged-only')) {
// Run the real MAIN entrypoint, with a native request first returning empty and then valid data.
const inject = await compile("import './entrypoints/youtube-inject.content';");
const messages=[], requests=[], listeners=[];let now=0;
const scope={crypto,TextEncoder,URL,AbortController,AbortSignal,Response,Map,Set,console,location:{href:'https://www.youtube.com/watch?v=reading01'},performance:{now:()=>++now,getEntriesByType:()=>[]},document:{getElementById:()=>null},setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,XMLHttpRequest:class{open(){}send(){}},defineContentScript:c=>c.main(),__listeners:listeners};
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
check('MAIN preserves normalized short fragments and explicit group mapping',produced.fragments.length===3&&produced.fragments[0].text==='This is'&&JSON.stringify(produced.cues.map(c=>[c.firstFragment,c.lastFragment]))==='[[0,1],[2,2]]');
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
  await page.evaluate(()=>{window.browser={runtime:{getURL:()=>'',onMessage:{addListener(){}},sendMessage:async()=>({ok:true,settings:{appearanceTheme:'minimal'}})}};});
  await page.addScriptTag({content:componentCode});
  await page.evaluate(()=>{
    const cues=Array.from({length:35},(_,i)=>({start:i*3000,dur:3000,lastOff:i*3000,text:`This is learning sentence number ${i}.`})).map((cue,i)=>({...cue,from:i*50,to:i*50+cue.text.length}));
    window.readingState={generation:'fixture',videoId:'reading01',videoRef:{videoId:'reading01',trackId:'https://www.youtube.com/api/timedtext?v=reading01&lang=en',trackKind:'manual',trackLang:'en',startMs:0},cues,current:1,translations:new Map(cues.map((_,i)=>[i,'完整译文用于检查收藏后的阅读位置，译文占据多行时也应该保持稳定。'.repeat(3)])),statuses:new Map(),sentences:[],entries:[],notice:'',chinese:true};
    window.saveCalls=0;window.failSave=false;
    window.workspace=ReadingTest.createYoutubeWorkspace({bindWords:()=>()=>{},words:(el,text)=>el.textContent=text,seek:()=>{},lookup:()=>{},ask:()=>{},open:()=>{},status:()=>{},remove:async()=>({ok:true}),save:async ({index})=>{
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
      if(m.type==='getEntry')return {ok:true,entry:null,vaultId:null};
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
  await card.locator('.save.is-saved').waitFor();
  check('lookup repeated click commits once and success enables unsaving',await page.evaluate(()=>window.lookupCalls===2)&&await card.locator('.save.is-saved').getAttribute('aria-label')==='取消收藏');
  check('lookup has no green save-success line',!(await card.locator('#blc-feedback').textContent()).trim());
  await page.screenshot({path:resolve(output,'lookup-saved.png')});
  console.log(`${results.length} focused runtime checks passed.`);
} finally {await browser.close();}
}

// Packaged MV3 integration: real MAIN/content scripts, messages, IndexedDB and AP.
const profile=await mkdtemp(join(tmpdir(),'pd-reading-'));
const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.BLC_CHROME||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width:1280,height:850},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--autoplay-policy=no-user-gesture-required']});
context.setDefaultTimeout(10000);
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  await worker.evaluate(()=>chrome.storage.local.set({regularTranslation:'google-gtx',displayLanguage:'zh-Hans',panelMode:'floating'}));
  const control=await context.newPage();await control.goto(`chrome-extension://${id}/options.html`);
  const sentences = [
    'But I I sometimes think our society gets too binary.',
    "Everything's either black or white.",
    'Everything gets polarized because of that.',
  ];
  const playerLine = sentences.slice(0,2).join(' ');
  const combinedTranslation = '但我我有时觉得我们的社会太二元了。什么事都非黑即白。';
  const eight = [...sentences, 'It shows up everywhere.', 'People take sides.', 'That can shut down a conversation.',
    'Sometimes the answer is somewhere in between.', 'We should make room for that.'];
  const nextShared = Array.from({length:14},(_,i)=>'Reading example number '+(i+1)+' is ready.');
  const denseLines = [eight.join(' '), nextShared.join(' '), 'No. No.'];
  const event = (tStartMs,dDurationMs,utf8) => ({tStartMs,dDurationMs,segs:[{utf8}]});
  const trailing = Array.from({length:13},(_,i)=>event(4500+i*750,750,'Additional practice sentence number '+(i+1)+'.'));
  const pendingText = trailing[8].segs[0].utf8;
  const sourceJson = anchored => ({events:[
    {...event(0,2000,playerLine),segs:[{utf8:sentences[0]},{utf8:' '+sentences[1],...(anchored&&{tOffsetMs:850})}]},
    event(2000,700,'Everything gets polarized'),
    event(3000,1000,'because of that.'),
    ...trailing,
  ]});
  const translationsFor = anchored => ({events:[
    event(0,2000,combinedTranslation),
    event(2000,700,'一切变得两极化'),
    event(3000,1000,'就是因为这个。'),
    ...trailing.flatMap((e,i)=>i===8&&!anchored?[]:[event(e.tStartMs,e.dDurationMs,'练习句 '+(i+1))]),
  ]});
  const fixture = `<!doctype html><title>Subtitle reading fixture</title><ytd-watch-flexy><div id="player-container-outer"><div id="movie_player" style="height:240px;position:relative"><video style="width:100%;height:200px"></video><div class="ytp-chrome-bottom"><div class="ytp-right-controls"><button class="ytp-subtitles-button" aria-pressed="true" aria-disabled="false">CC</button></div></div></div></div></ytd-watch-flexy><script>
    const vid=new URL(location.href).searchParams.get('v'),p=document.getElementById('movie_player'),v=document.querySelector('video');
    const track=(name,phase)=>({languageCode:'en',kind:'asr',name,baseUrl:'https://www.youtube.com/api/timedtext?v='+vid+'&lang=en&kind=asr&name='+name+'&phase='+phase});
    const plain=track('Plain','empty'),anchored=track('Anchored','valid');
    const independent={languageCode:'zh-Hans',name:'Independent',baseUrl:'https://www.youtube.com/api/timedtext?v='+vid+'&lang=zh-Hans'};
    let current=plain;p.getOption=(module,key)=>key==='tracklist'?[plain,anchored,independent]:current;
    p.setOption=(module,key,t)=>{current=t.languageCode?t:null;if(current?.name==='Anchored')fetch(anchored.baseUrl);};
    p.loadModule=()=>{};
    document.querySelector('.ytp-subtitles-button').onclick=e=>e.currentTarget.setAttribute('aria-pressed',e.currentTarget.getAttribute('aria-pressed')!=='true');
    const bytes=new Uint8Array(44+8000*2*(vid==='dense01'?65:16)),d=new DataView(bytes.buffer),str=(at,s)=>[...s].forEach((c,i)=>bytes[at+i]=c.charCodeAt(0));str(0,'RIFF');d.setUint32(4,bytes.length-8,true);str(8,'WAVE');str(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,8000,true);d.setUint32(28,16000,true);d.setUint16(32,2,true);d.setUint16(34,16,true);str(36,'data');d.setUint32(40,bytes.length-44,true);v.src=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
    window.addEventListener('message',e=>{if(e.data?.source==='blc-content'&&e.data.type==='config'){fetch(plain.baseUrl);if(vid!=='emptyonly')setTimeout(()=>fetch(plain.baseUrl.replace('empty','valid')),100);}});
  </script>`;
  await context.route('https://www.youtube.com/watch?*',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await context.route('https://www.youtube.com/api/timedtext?*',r=>{
    const u=new URL(r.request().url()), anchored=u.searchParams.get('name')==='Anchored';
    if(u.searchParams.get('v')==='dense01'){
      const events=u.searchParams.has('tlang')||u.searchParams.get('lang')!=='en'?[]:
        [event(0,30000,denseLines[0]),event(30000,30000,denseLines[1]),event(60000,2000,denseLines[2])];
      return r.fulfill({contentType:'application/json',body:u.searchParams.get('phase')==='empty'?'':JSON.stringify({events})});
    }
    return r.fulfill({contentType:'application/json',body:u.searchParams.get('phase')==='empty'?'':JSON.stringify(
      u.searchParams.has('tlang')?translationsFor(anchored):
        u.searchParams.get('lang')==='zh-Hans'?{events:[event(3000,1000,'正是因为这个。')]}:sourceJson(anchored))});
  });
  const learnedTranslations = ['但我我有时觉得我们的社会太二元了。','什么事都非黑即白。'];
  const denseTranslations = [...learnedTranslations,'一切因此两极化。','这种事到处都有。','人们各选一边。',
    '这会让对话进行不下去。','有时答案在两者之间。','我们应该为此留出空间。'];
  const densePlayerTranslation = denseTranslations.join('');
  await worker.evaluate(({sentences,learnedTranslations,pendingText,eight,nextShared,denseLines,denseTranslations,densePlayerTranslation})=>{
    globalThis.fallbackBatches=[];
    globalThis.denseBatches=[];
    globalThis.gates={};
    const gate=(key)=>{
      const state=globalThis.gates[key]={};
      state.ready=new Promise(resolve=>{state.start=resolve;});
      state.aborted=new Promise(resolve=>{state.abort=resolve;});
      state.response=new Promise(resolve=>{state.release=resolve;});
      return state;
    };
    gate('first');gate('old');gate('denseLast');gate('crossing');
    chrome.runtime.onMessage.addListener(m=>{
      if(m.type==='translateCues'&&m.videoId==='reading01')globalThis.fallbackBatches.push(m.items);
      if(m.type==='translateCues'&&m.videoId==='dense01')globalThis.denseBatches.push(m.items);
    });
    const byText=new Map([
      ...sentences.slice(0,2).map((text,i)=>[text,learnedTranslations[i]]),
      ...eight.map((text,i)=>[text,denseTranslations[i]]),
      ...nextShared.map((text,i)=>[text,'阅读示例 '+(i+1)+' 已就绪。']),
      [denseLines[0],densePlayerTranslation],[denseLines[1],'阅读示例已就绪。'],
      ['No. No.','不。不。'],['No.','不。'],[pendingText,'OLD EPOCH'],
    ]);
    const blockedTexts=new Map([[pendingText,'old'],[sentences[0],'first'],[eight[7],'denseLast'],[nextShared[4],'crossing']]);
    const originalFetch=globalThis.fetch;
    globalThis.fetch=async(input,options)=>{
      const url=new URL(String(input));
      if(url.hostname!=='translate.googleapis.com')return originalFetch(input,options);
      const text=url.searchParams.get('q');
      const blocked=globalThis.gates[blockedTexts.get(text)];
      if(blocked){
        options.signal.addEventListener('abort',blocked.abort,{once:true});
        blocked.start();await blocked.response;
      }
      const translated=byText.get(text);
      if(!translated)throw new Error('Unexpected fallback text: '+text);
      return new Response(JSON.stringify([[[translated,text]],null,'en']));
    };
  },{sentences,learnedTranslations,pendingText,eight,nextShared,denseLines,denseTranslations,densePlayerTranslation});
  const gate = (key,stage)=>worker.evaluate(({key,stage})=>Promise.race([
    globalThis.gates[key][stage],new Promise((_,reject)=>setTimeout(()=>reject(new Error(key+' did not reach '+stage)),8000)),
  ]),{key,stage});
  const release = key=>worker.evaluate(key=>globalThis.gates[key].release(),key);
  const page=await context.newPage();await page.goto('https://www.youtube.com/watch?v=reading01');
  const playerEn=page.locator('#blc-subs .en'), playerZh=page.locator('#blc-subs .zh');
  await playerEn.waitFor();
  const tabId=await control.evaluate(async()=> (await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0].id);
  const action=m=>control.evaluate(({tabId,m})=>chrome.tabs.sendMessage(tabId,m),{tabId,m});
  const getState=()=>action({type:'blc-sub-get'});
  const rowRef=(state,index)=>({type:'pd-video-action',videoId:state.videoId,trackId:state.trackId,generation:state.generation,index,text:state.cues[index].text});
  const expectIndex=index=>control.waitForFunction(async({tabId,index})=>
    (await chrome.tabs.sendMessage(tabId,{type:'blc-sub-get'})).currentIndex===index,{tabId,index});
  await gate('first','ready');
  const state=await getState();
  assert.deepEqual(state.cues.slice(0,3).map(c=>[c.text,c.startMs,c.endMs]),[
    [sentences[0],0,2000],[sentences[1],0,2000],[sentences[2],2000,4000],
  ]);
  check('packaged acquisition recovers into split and cross-fragment sentences',true);
  check('player keeps the original short unit and its platform translation',
    await playerEn.textContent()===playerLine&&await playerZh.textContent()===combinedTranslation);
  const playerWord = playerEn.locator('.w').filter({hasText:/^society$/});
  const playerCard = page.locator('#blc-lookup-popup');
  await playerWord.evaluate(el=>el.click());
  await playerCard.locator('.save:not(.is-saved):enabled').click();
  await playerCard.locator('.save.is-saved:enabled').waitFor();
  await playerCard.locator('.close').click();
  await playerWord.evaluate(el=>{
    const range=document.createRange();range.selectNodeContents(el);
    const selection=el.getRootNode().getSelection();
    selection.removeAllRanges();selection.addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,composed:true}));
  });
  await page.locator('#pd-phrase-actions #lookup').click();
  await playerCard.locator('.save.is-saved:enabled').click();
  await playerCard.locator('.save:not(.is-saved):enabled').waitFor();
  await playerCard.locator('.close').click();
  await playerWord.evaluate(el=>el.getRootNode().getSelection().removeAllRanges());
  await page.waitForTimeout(501);
  await playerWord.evaluate(el=>el.click());
  await playerCard.locator('.save:not(.is-saved):enabled').waitFor();
  const wordEntry=await control.evaluate(()=>chrome.runtime.sendMessage({type:'getEntry',key:'en::society'}));
  check('player word and subtitle selection share a bookmark that stays unsaved on reopen',wordEntry.entry.contexts.length===0);
  await playerCard.locator('.close').click();
  await control.evaluate(id=>chrome.tabs.sendMessage(id,{type:'pd-panel-show',view:'subs'},{frameId:0}),tabId);
  await page.frameLocator('#pd-floating-panel iframe').locator('#blc-learning-panel .en').first().waitFor();
  const frame=page.frames().find(f=>f.url().includes('/sidepanel.html'));
  const workspace=frame.locator('#blc-learning-panel'), body=workspace.locator('.body');
  const row=i=>workspace.locator('[data-cue="'+i+'"]');
  const button=name=>workspace.getByRole('button',{name,exact:true});
  const runtime=message=>control.evaluate(message=>chrome.runtime.sendMessage(message),message);
  const videoRef={videoId:state.videoId,trackId:state.trackId,trackKind:state.trackKind,trackLang:state.trackLang,startMs:0};
  const storedWord='binary';
  for(const [startMs,sentence] of [[0,sentences[0]],[3000,'The binary choice comes up again.']]){
    assert.ok((await runtime({type:'save',snapshot:{source:'video',expression:storedWord,sentence,title:state.title,lang:'en',video:{...videoRef,startMs}},definition:'二元的'})).ok);
  }
  const excerpt=sentences[2],requestId='video-saved-excerpt';
  const translated=await runtime({type:'translateSelection',requestId,text:excerpt,sourceLang:'en',targetLang:'en',snapshot:{
    text:excerpt,url:'https://www.youtube.com/watch?v='+videoRef.videoId+'&t=2s',title:state.title,position:{...videoRef,startMs:2000,endMs:4000}}});
  assert.ok(translated.ok,JSON.stringify(translated));
  assert.ok((await runtime({type:'saveSelectionKnowledge',requestId,vaultId:null})).ok);
  const total=workspace.locator('[data-tab="saved"] .word-count');
  const collection=workspace.locator('.video-saved');
  const savedTab=workspace.locator('[data-tab="saved"]');
  const expectTotal=count=>total.filter({hasText:new RegExp('^'+count+'$')}).waitFor();
  assert.equal(await workspace.locator('[data-tab].active').getAttribute('data-tab'),'subs');
  await expectTotal(2);
  await savedTab.click();
  await collection.locator('.entry-expand').click();
  assert.equal(await collection.locator('.entry').count(),1);
  assert.equal(await collection.locator('.context:visible').count(),2);
  await collection.locator('a.source').filter({hasText:'0:03'}).click();
  await page.waitForFunction(()=>Math.abs(document.querySelector('video').currentTime-3)<0.5);
  await collection.locator('.context').filter({hasText:'comes up again'}).getByRole('button',{name:'取消收藏'}).click();
  await collection.getByText('The binary choice comes up again.',{exact:true}).waitFor({state:'detached'});
  await expectTotal(2);
  await collection.getByRole('button',{name:'取消收藏'}).click();
  await expectTotal(1);
  await collection.locator('[data-category="knowledge"]').click();
  await collection.locator('.knowledge-row summary').click();
  await collection.locator('a.source').filter({hasText:'0:02'}).click();
  await page.waitForFunction(()=>Math.abs(document.querySelector('video').currentTime-2)<0.5);
  assert.ok((await runtime({type:'save',snapshot:{source:'video',expression:storedWord,sentence:sentences[0],title:state.title,lang:'en',video:videoRef},definition:'二元的'})).ok);
  await workspace.locator('[data-tab="subs"]').click();
  await page.evaluate(()=>{document.querySelector('video').currentTime=0;});
  await expectIndex(0);
  check('video collection counts distinct words, scopes per-context unsave and jumps to stored times',true);
  check('sidebar shows the fixed sample as three distinct rows',
    JSON.stringify(await workspace.locator('.en').allTextContents().then(a=>a.slice(0,3)))===JSON.stringify(sentences));
  check('cross-fragment complete sentence uses the two exact platform translations',
    await row(2).locator('.zh').textContent()==='一切变得两极化 就是因为这个。');

  await body.hover();await page.mouse.wheel(0,24);
  await workspace.locator('.controls button').last().waitFor();
  await body.evaluate(el=>{
    window.readingBody=el;
    window.readingRows=[...el.children];
    window.readingTop=el.scrollTop;
    const first=el.querySelector('[data-cue="0"] .w:last-of-type').firstChild;
    const last=el.querySelector('[data-cue="1"] .w').firstChild;
    const range=document.createRange();
    range.setStart(first,0);range.setEnd(last,last.length);
    getSelection().removeAllRanges();getSelection().addRange(range);
    first.parentElement.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,composed:true}));
  });
  await frame.locator('#panel-selection-actions').waitFor();
  await control.waitForFunction(async tabId=>(await chrome.runtime.sendMessage({type:'selectionCandidateGet',tabId}))?.candidate?.text==="binary. Everything's",tabId);
  const floatingTheme=async theme=>{
    await frame.waitForFunction(theme=>document.documentElement.dataset.pdTheme===theme&&document.querySelector('#blc-learning-panel').dataset.pdTheme===theme,theme);
    await page.waitForFunction(theme=>document.querySelector('#pd-floating-panel').dataset.pdTheme===theme&&document.querySelector('#blc-subs').dataset.pdTheme===theme,theme);
  };
  const readingPreserved=()=>frame.evaluate(()=>{
    const range=window.readingBody.getRootNode().getSelection().getRangeAt(0);
    return window.readingRows.every((row,i)=>row===window.readingBody.children[i])&&
      window.readingTop>0&&Math.abs(window.readingTop-window.readingBody.scrollTop)<2&&
      range.startContainer.textContent==='binary'&&range.endContainer.textContent==="Everything's";
  });
  await release('first');
  await row(1).locator('.zh').filter({hasText:learnedTranslations[1]}).waitFor();
  check('split rows receive separate full-text fallback translations and retain reading state',
    await row(0).locator('.zh').textContent()===learnedTranslations[0]&&await readingPreserved()&&
    await worker.evaluate(sentences=>globalThis.fallbackBatches.some(items=>sentences.slice(0,2).every((text,id)=>items.some(i=>i.id===id&&i.text===text))),sentences));
  const save=row(1).getByRole('button',{name:'收藏句子',exact:true});
  await save.evaluate(el=>{el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,composed:true}));el.click();});
  await row(1).getByRole('button',{name:'取消收藏',exact:true}).waitFor();
  const records=()=>control.evaluate(()=>chrome.runtime.sendMessage({type:'listSentences'}));
  const saved=(await records()).sentences;
  await expectTotal(3);
  check('saving the second row persists only its visible text, track and interval and keeps reading state',
    saved.length===1&&saved[0].text===sentences[1]&&saved[0].video.trackId===state.trackId&&
    saved[0].video.startMs===0&&saved[0].endMs===2000&&await readingPreserved());
  await page.evaluate(async()=>{
    const onMessage=e=>{
      if(e.data?.source!=='blc-inject'||e.data?.type!=='cues')return;
      removeEventListener('message',onMessage);window.readingRecaptured=true;
    };
    addEventListener('message',onMessage);
    await fetch('/api/timedtext?v=reading01&lang=en&kind=asr&name=Plain&phase=repeat');
  });
  await page.waitForFunction(()=>window.readingRecaptured);
  check('same-content acquisition keeps the list generation and reading state',
    (await getState()).generation===state.generation&&await readingPreserved());
  await control.evaluate(()=>chrome.storage.local.set({appearanceTheme:'classic'}));
  await floatingTheme('classic');
  check('changing appearance preserves subtitle selection, row identity and reading position',await readingPreserved());
  await frame.locator('#workspace-title').click();
  await frame.locator('#panel-selection-actions').waitFor({state:'detached'});
  await frame.evaluate(()=>getSelection().removeAllRanges());
  await body.evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:resolve(output,'packaged-sidebar.png')});
  check('sidebar adds no mechanism guidance',!/共用区间|句内时间|定位精度|可定位边界/.test(await workspace.innerText()));
  const floating=page.locator('#pd-floating-panel');
  const originalWidth=await floating.evaluate(el=>{const width=el.style.width;el.style.width='320px';return width;});
  check('narrow sidebar keeps content within viewport',await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await floating.evaluate((el,width)=>el.style.width=width,originalWidth);

  await button('下一句').click();await expectIndex(1);
  await button('下一句').click();await expectIndex(2);
  await button('上一句').click();await expectIndex(1);
  check('shared interval is reached item by item and preserves the explicitly selected second row',
    await page.evaluate(()=>document.querySelector('video').currentTime<.1));
  await page.evaluate(()=>{document.querySelector('video').currentTime=1.25;});
  await expectIndex(0);
  check('automatic following picks the first row when a shared interval is entered',true);

  const videoTime=()=>page.evaluate(()=>document.querySelector('video').currentTime);
  const play=()=>page.evaluate(()=>document.querySelector('video').play());
  const waitPause=min=>page.waitForFunction(min=>{const v=document.querySelector('video');return v.paused&&v.currentTime>=min;},min);
  await frame.locator('#open-settings').click();
  await frame.locator('#video-settings:not([hidden])').waitFor();
  assert.equal(await frame.locator('#video-auto-pause').isChecked(),false);
  const settingsBefore=await action({type:'pd-video-settings-get'});
  assert.equal((await action({type:'pd-video-settings-set',videoId:'stale-video',generation:settingsBefore.generation,change:{autoPause:true}})).ok,false);
  assert.equal((await action({type:'pd-video-settings-set',videoId:settingsBefore.videoId,generation:'stale-generation',change:{autoPause:true}})).ok,false);
  assert.equal((await action({type:'pd-video-settings-get'})).autoPause,false);
  for(const [width,theme,locale] of [[320,'classic','zh-Hans'],[400,'minimal','de'],[540,'classic','zh-Hans']]) {
    await control.evaluate(({theme,locale})=>chrome.storage.local.set({appearanceTheme:theme,displayLanguage:locale}),{theme,locale});
    await page.locator('#pd-floating-panel').evaluate((el,width)=>el.style.width=width+'px',width);
    await frame.waitForFunction(locale=>document.documentElement.lang===locale,locale);
    await frame.locator('#video-settings').scrollIntoViewIfNeeded();
    assert.ok(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await frame.locator('#view-settings').screenshot({path:resolve(output,`video-settings-${width}-${theme}.png`)});
  }
  await page.locator('#pd-floating-panel').evaluate(el=>el.style.width='400px');
  await frame.locator('#video-auto-pause').check();
  await control.waitForFunction(async tabId=>(await chrome.tabs.sendMessage(tabId,{type:'pd-video-settings-get'})).autoPause,tabId);
  check('video settings use the sidebar layout, survive theme/language changes, and reject stale targets',true);
  await frame.locator('#views [data-view="subs"]').click();
  await control.evaluate(id=>chrome.tabs.sendMessage(id,{type:'pd-panel-show',view:'subs'},{frameId:0}),tabId);
  await button('下一句').click();await expectIndex(1);
  await button('重播').click();await waitPause(2);
  check('AP pauses once at the shared interval end and holds its explicitly selected row and player fragment',
    await videoTime()<2.4&&await playerEn.textContent()===playerLine&&(await getState()).currentIndex===1);
  await play();await page.waitForFunction(()=>!document.querySelector('video').paused&&document.querySelector('video').currentTime>2.3);
  const beforeTheme=await getState();
  await control.evaluate(()=>chrome.storage.local.set({appearanceTheme:'minimal'}));
  await floatingTheme('minimal');
  check('changing appearance leaves playback active and retains the subtitle generation',
    !await page.evaluate(()=>document.querySelector('video').paused)&&(await getState()).generation===beforeTheme.generation);
  await waitPause(4);
  check('AP continues into the cross-fragment sentence and holds its final short fragment',
    await videoTime()<4.4&&await playerEn.textContent()==='because of that.'&&
    await playerZh.textContent()==='正是因为这个。'&&(await getState()).currentIndex===2);
  await page.screenshot({path:resolve(output,'packaged-ap-held.png')});
  await playerEn.evaluate(el=>{
    const range=document.createRange();range.selectNodeContents(el);
    getSelection().removeAllRanges();getSelection().addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,composed:true}));
  });
  await page.locator('#pd-phrase-actions').waitFor();
  await control.waitForFunction(async tabId=>{
    const cue=(await chrome.runtime.sendMessage({type:'selectionCandidateGet',tabId}))?.candidate?.cue;
    return cue?.text==='because of that.'&&cue.startMs===3000&&cue.endMs===4000;
  },tabId);
  await page.evaluate(()=>getSelection().removeAllRanges());
  await page.locator('#pd-phrase-actions').waitFor({state:'detached'});
  check('player selection uses the visible fragment and its original time range',true);

  await action({type:'blc-sub-control',videoId:state.videoId,action:'seek',timeMs:trailing[8].tStartMs});
  await gate('old','ready');
  await frame.locator('#open-settings').click();
  const trackSelect=frame.locator('#video-track');
  await trackSelect.waitFor();
  const anchoredValue=await trackSelect.locator('option').filter({hasText:'Anchored'}).getAttribute('value');
  await trackSelect.selectOption(anchoredValue);
  await frame.locator('#views [data-view="subs"]').click();
  await gate('old','aborted');
  await control.waitForFunction(async({tabId,generation})=>(await chrome.tabs.sendMessage(tabId,{type:'blc-sub-get'})).generation!==generation,{tabId,generation:state.generation});
  const anchored=await getState();
  await release('old');
  await savedTab.click();
  await expectTotal(3);
  await collection.locator('[data-category="sentences"]').click();
  await collection.getByText(sentences[1],{exact:true}).waitFor();
  await runtime({type:'setSetting',name:'bilingualEnabled',value:false});
  await page.locator('#blc-subs').waitFor({state:'hidden'});
  await expectTotal(3);
  await collection.getByText(sentences[1],{exact:true}).waitFor();
  await collection.locator('[data-category="knowledge"]').click();
  await collection.locator('.knowledge-row').waitFor();
  await collection.locator('[data-category="vocab"]').click();
  await collection.locator('.entry-expand').click();
  await collection.getByText(sentences[0],{exact:true}).waitFor();
  await collection.locator('[data-category="sentences"]').click();
  await collection.getByRole('button',{name:'取消收藏'}).click();
  await expectTotal(2);
  await collection.getByText(sentences[1],{exact:true}).waitFor({state:'detached'});
  await runtime({type:'setSetting',name:'bilingualEnabled',value:true});
  await page.locator('#blc-subs .en').waitFor();
  await workspace.locator('[data-tab="subs"]').click();
  check('all three saved categories remain available across track change and subtitles off; removing a sentence updates the total',true);
  check('late old-row save is rejected after a track change',!(await action({...rowRef(state,0),action:'save'})).ok&&
    (await records()).sentences.length===0);
  check('anchored track has the same text with two separately playable intervals',
    anchored.trackId!==state.trackId&&anchored.cues[0].endMs===850&&anchored.cues[1].startMs===850&&anchored.cues[1].endMs===2000);
  await action({...rowRef(anchored,0),action:'seek',play:true});await waitPause(.85);
  check('AP honors the next word anchor while holding the original short fragment',
    await videoTime()<1.1&&(await getState()).currentIndex===0&&await playerEn.textContent()===playerLine);
  await play();await waitPause(2);
  check('AP advances to the next anchored sentence and rejects the old translation result',
    await videoTime()<2.4&&(await getState()).currentIndex===1&&
    !(await getState()).cues.some(c=>c.zh==='OLD EPOCH'));

  const dense=await context.newPage();
  await dense.goto('https://www.youtube.com/watch?v=dense01');
  const densePlayer=dense.locator('#blc-subs .en');
  await densePlayer.waitFor();
  const denseTab=await control.evaluate(async()=> (await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0].id);
  const denseState=()=>control.evaluate(tabId=>chrome.tabs.sendMessage(tabId,{type:'blc-sub-get'}),denseTab);
  const waitDense=async (condition,arg)=>{
    const limit=Date.now()+10000;
    do {
      const state=await denseState();
      if(condition(state,arg))return state;
      await new Promise(resolve=>setTimeout(resolve,50));
    } while(Date.now()<limit);
    assert.fail('Timed out waiting for dense subtitle state');
  };
  await gate('denseLast','ready');
  await dense.locator('#blc-subs .zh').filter({hasText:densePlayerTranslation}).waitFor();
  check('current player fragment is first in the initial batch and displays before the final row translation',
    await worker.evaluate(text=>globalThis.denseBatches[0]?.[0].text===text&&globalThis.denseBatches[0].length===8,denseLines[0])&&
    (await denseState()).cues[7].zh===null);
  await release('denseLast');
  const denseInitial=await waitDense(state=>state.cues.slice(0,12).every(cue=>cue.zh));
  check('eight learning rows receive their own translations without a row action or playhead change',
    denseInitial.currentIndex===0&&denseInitial.cues.slice(0,8).every((cue,i)=>
      cue.text===eight[i]&&cue.zh===denseTranslations[i]&&cue.startMs===0&&cue.endMs===30000));
  await dense.evaluate(()=>{document.querySelector('video').currentTime=30;});
  await gate('crossing','ready');
  const lastPair=8+nextShared.length, deferred=lastPair-2;
  check('later candidate is still pending while the batch for its interval is in flight',
    (await denseState()).cues[deferred].zh===null&&
    await worker.evaluate(text=>globalThis.denseBatches.every(items=>items.every(item=>item.text!==text)),nextShared.at(-2)));
  await dense.evaluate(()=>{document.querySelector('video').currentTime=60;});
  await waitDense((state,index)=>state.currentIndex===index,lastPair);
  await release('crossing');
  const afterCrossing=await waitDense(state=>state.cues.every(cue=>cue.zh));
  check('unsubmitted rows complete after leaving their interval',
    afterCrossing.currentIndex===lastPair&&afterCrossing.cues[deferred].zh==='阅读示例 13 已就绪。');

  const denseRecords=async()=> (await records()).sentences.filter(s=>s.video.videoId==='dense01');
  const saveDirect=(cue,withRange=false)=>control.evaluate(({cue,withRange,state})=>chrome.runtime.sendMessage({
    type:'saveSentence',...(withRange&&{range:{from:cue.from,to:cue.to}}),
    sentence:{video:{videoId:state.videoId,trackId:state.trackId,trackKind:state.trackKind,trackLang:state.trackLang,startMs:cue.startMs},
      text:cue.text,endMs:cue.endMs,title:'Subtitle reading fixture'},
  }),{cue,withRange,state:afterCrossing});
  assert.ok((await saveDirect(afterCrossing.cues[lastPair])).ok);
  assert.ok((await saveDirect(afterCrossing.cues[0])).ok);
  const legacy=(await denseRecords()).find(s=>s.text==='No.');
  const openDensePanel=async()=>{
    await control.evaluate(id=>chrome.tabs.sendMessage(id,{type:'pd-panel-show',view:'subs'},{frameId:0}),denseTab);
    const frame=dense.frameLocator('#pd-floating-panel iframe');
    const list=frame.locator('#blc-learning-panel');
    await list.locator('.en').first().waitFor();
    return list;
  };
  let denseList=await openDensePanel();
  const denseRow=i=>denseList.locator('[data-cue="'+i+'"]');
  const bookmark=(i,saved)=>denseRow(i).getByRole('button',{name:saved?'取消收藏':'收藏句子',exact:true});
  await bookmark(0,true).waitFor();
  for(const i of [lastPair,lastPair+1]){
    await bookmark(i,false).click();
    await bookmark(i,true).waitFor();
  }
  const beforeReload=(await denseRecords()).filter(s=>s.text==='No.');
  const storedId=i=>beforeReload.find(s=>JSON.stringify(JSON.parse(s.id).at(-1))===
    JSON.stringify([afterCrossing.cues[i].from,afterCrossing.cues[i].to]))?.id;
  const firstId=storedId(lastPair), secondId=storedId(lastPair+1);
  check('identical rows save two distinct range IDs and leave the ambiguous old record intact',
    beforeReload.length===3&&!!firstId&&!!secondId&&firstId!==secondId&&beforeReload.some(s=>s.id===legacy.id));
  assert.ok((await saveDirect(afterCrossing.cues[lastPair+1],true)).ok);
  check('repeated saving of the same range is idempotent',(await denseRecords()).length===4);
  await dense.reload();
  await densePlayer.waitFor();
  denseList=await openDensePanel();
  await bookmark(lastPair,true).waitFor();
  await bookmark(lastPair+1,true).click();
  await bookmark(lastPair+1,false).waitFor();
  check('reload restores both bookmarks and cancelling the second removes only its ID',
    await bookmark(lastPair,true).isVisible()&&
    JSON.stringify((await denseRecords()).filter(s=>s.text==='No.').map(s=>s.id).sort())===
    JSON.stringify([firstId,legacy.id].sort()));
  await bookmark(0,true).click();
  await bookmark(0,false).waitFor();
  check('a uniquely matching legacy bookmark can still be cancelled by its persisted ID',
    (await denseRecords()).every(s=>s.text==='No.'));

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





