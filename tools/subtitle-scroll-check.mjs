// Focused long-transcript update/scroll checks. Disposable browsers; no user storage or network.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';

const code=(await build({stdin:{contents:"export {createYoutubeWorkspace} from './shared/youtubeWorkspace'; export {segmentWords} from './shared/tokenize'; export {sentenceId} from './shared/vocab';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'ScrollTest',plugins:[{
  name:'inline-css',setup(b){b.onResolve({filter:/\.css\?inline$/},a=>({path:resolve(a.resolveDir,a.path.replace('?inline','')),namespace:'inline-css'}));b.onLoad({filter:/.*/,namespace:'inline-css'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}
}]})).outputFiles[0].text;
const browsers={chrome:'C:/Program Files/Google/Chrome/Application/chrome.exe',edge:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'};
const only=process.argv.find(a=>a.startsWith('--browser='))?.split('=')[1];
for(const [name,executablePath] of Object.entries(browsers)){
 if(only&&name!==only)continue;
 const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:528,height:1226}});page.setDefaultTimeout(10000);
  await page.setContent('<div id="mount" style="width:470px;height:1050px"></div>');
  await page.evaluate(()=>{window.browser={runtime:{getURL:()=>'',onMessage:{addListener(){}},sendMessage:async()=>({ok:true,settings:{appearanceTheme:'classic'}})}};});
  await page.addScriptTag({content:code});
  await page.evaluate(()=>{
   const cues=Array.from({length:1200},(_,i)=>({start:i*6000,dur:6000,lastOff:0,from:i*180,to:(i+1)*180,text:`Musk has written about this, a sort of more specific conception of what he calls woke mind virus, sentence number ${i}.`}));
   window.state={generation:'scroll-fixture',videoId:'scroll01',videoRef:{videoId:'scroll01',trackId:'en',trackKind:'manual',trackLang:'en',startMs:0},cues,current:3,translations:new Map(cues.map((_,i)=>[i,'这是用于长字幕阅读检查的完整译文。'])),statuses:new Map(),sentences:[],entries:[],notice:'',chinese:true,trackLang:'en'};
   window.saveCalls=0;
   window.workspace=ScrollTest.createYoutubeWorkspace({bindWords:()=>()=>{},words:(el,text)=>{let last=0;for(const word of ScrollTest.segmentWords(text,'en')){if(word.start>last)el.append(document.createTextNode(text.slice(last,word.start)));const span=document.createElement('span');span.className='w';span.tabIndex=0;span.textContent=word.text;el.append(span);last=word.end;}if(last<text.length)el.append(document.createTextNode(text.slice(last)));},seek(){},lookup(){},ask(){},open(){},status:async()=>true,remove:async()=>({ok:true}),save:()=>{window.saveCalls++;return new Promise(resolve=>window.finishSave=resolve);}},document.getElementById('mount'));
   window.patch=value=>{window.state={...window.state,...value};workspace.update(state);};workspace.update(state);workspace.restore({follow:false,top:1500});
   window.root=document.getElementById('blc-learning-panel').shadowRoot;window.body=root.querySelector('.body');window.firstRow=root.querySelector('[data-cue="0"]');window.mutations=[];
   new MutationObserver(records=>mutations.push(...records)).observe(root,{subtree:true,attributes:true,childList:true,characterData:true});
  });
  await page.waitForTimeout(30);
  const noChange=await page.evaluate(async()=>{mutations.length=0;const start=performance.now();patch({statuses:new Map(state.statuses),translations:new Map(state.translations)});const elapsed=performance.now()-start;await new Promise(resolve=>setTimeout(resolve,0));return {elapsed,mutations:mutations.length,sameRow:firstRow===root.querySelector('[data-cue="0"]')};});
  assert.equal(noChange.mutations,0,'Equivalent snapshots must not mutate the list');assert.equal(noChange.sameRow,true);
  console.log('PASS',name,'1200-row equivalent snapshot: zero mutations, stable rows;',noChange.elapsed.toFixed(2)+'ms');
  const currentOnly=await page.evaluate(async()=>{mutations.length=0;patch({current:4});await new Promise(resolve=>setTimeout(resolve,0));return {unexpected:mutations.filter(m=>!(m.type==='attributes'&&m.attributeName==='class'&&m.target.matches('[data-cue="3"],[data-cue="4"]'))).map(m=>({type:m.type,attribute:m.attributeName,class:m.target.className})),current:root.querySelector('.current')?.dataset.cue};});
  assert.deepEqual(currentOnly.unexpected,[]);assert.equal(currentOnly.current,'4');
  await page.evaluate(()=>patch({statuses:new Map([['written','saved']])}));
  const written=page.locator('#blc-learning-panel [data-cue="0"] .w').filter({hasText:/^written$/});
  assert.equal(await written.evaluate(el=>el.classList.contains('saved')),true);
  await page.evaluate(()=>patch({statuses:new Map([['written','known']])}));assert.equal(await written.evaluate(el=>el.classList.contains('known')&&!el.classList.contains('saved')),true);
  await page.evaluate(()=>patch({statuses:new Map()}));assert.equal(await written.evaluate(el=>!el.classList.contains('known')&&!el.classList.contains('saved')),true);
  await page.evaluate(()=>{const translations=new Map(state.translations);translations.set(0,'一条真正更新的译文。');patch({translations});});
  const zh=page.locator('#blc-learning-panel [data-cue="0"] .zh');assert.equal(await zh.textContent(),'一条真正更新的译文。');
  await page.evaluate(()=>{const translations=new Map(state.translations);translations.delete(0);patch({translations});});assert.equal(await zh.isHidden(),true);
  await page.evaluate(()=>patch({chinese:false}));
  assert.equal(await page.evaluate(async()=>{mutations.length=0;patch({});await new Promise(r=>setTimeout(r,0));return mutations.length;}),0,'An unchanged hidden-translation state must not rewrite hidden attributes');
  await page.evaluate(()=>patch({chinese:true}));
  console.log('PASS',name,'current-only update is local; status add/change/remove and translation update/remove remain live');

  const save=page.locator('#blc-learning-panel [data-cue="0"] .meta .reading-icon').first();
  await save.evaluate(el=>el.click());assert.equal(await save.isDisabled(),true);assert.equal(await save.getAttribute('aria-busy'),'true');
  await page.evaluate(()=>finishSave({ok:false}));await save.waitFor({state:'attached'});await page.waitForFunction(()=>!root.querySelector('[data-cue="0"] .meta .reading-icon').disabled);
  assert.equal(await page.locator('#blc-learning-panel [data-cue="0"] .save-error').isVisible(),true);
  await save.evaluate(el=>el.click());await page.evaluate(()=>finishSave({ok:true}));await page.waitForFunction(()=>root.querySelector('[data-cue="0"] .meta .reading-icon').getAttribute('aria-pressed')==='true');
  await page.evaluate(()=>patch({}));assert.equal(await save.getAttribute('aria-pressed'),'true','A stale library poll must preserve confirmed save');
  await page.evaluate(()=>{const cue=state.cues[0],video={...state.videoRef,startMs:cue.start};patch({sentences:[{id:ScrollTest.sentenceId(video,cue.text,cue),video,text:cue.text}]});});
  await page.evaluate(()=>patch({sentences:[]}));assert.equal(await save.getAttribute('aria-pressed'),'false','A real later removal must update the button');
  assert.equal(await page.evaluate(()=>saveCalls),2);
  console.log('PASS',name,'save busy/failure/success, stale snapshot confirmation and real removal');

  await page.evaluate(()=>workspace.restore({follow:true,top:1000}));await page.waitForTimeout(30);
  await page.evaluate(()=>{body.dispatchEvent(new WheelEvent('wheel',{deltaY:300}));body.scrollTop+=300;patch({});});
  await page.waitForFunction(()=>!workspace.snapshot().follow);
  await page.evaluate(()=>workspace.restore({follow:true,top:1000}));await page.waitForTimeout(30);await page.evaluate(()=>{body.dispatchEvent(new WheelEvent('wheel',{deltaY:300}));body.scrollTop+=300;patch({current:state.current+1});});await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>workspace.snapshot().follow),false,'A current-index change must not swallow simultaneous manual scrolling');
  await page.evaluate(()=>workspace.restore({follow:false,top:0}));await page.waitForTimeout(30);
  await page.evaluate(()=>body.scrollTo({top:5000,behavior:'smooth'}));await page.waitForTimeout(130);await page.evaluate(()=>patch({}));
  await page.waitForFunction(()=>Math.abs(body.scrollTop-5000)<2);
  assert.equal(await page.evaluate(()=>workspace.snapshot().follow),false);
  const tabs=page.locator('#blc-learning-panel .head button');await tabs.nth(2).click();await tabs.nth(0).click();
  await page.waitForFunction(()=>Math.abs(body.scrollTop-5000)<2);
  await page.locator('#blc-learning-panel .controls button').nth(3).click();await page.waitForFunction(()=>workspace.snapshot().follow);
  assert.ok(Math.abs(await page.evaluate(()=>body.scrollTop)-5000)>100);
  console.log('PASS',name,'user-scroll/update ordering, uninterrupted smooth scroll, tab position restore and explicit locate');
 }finally{await browser.close();}
}
