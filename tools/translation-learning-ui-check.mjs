// Production MV3 UI + IDB. Translation traffic is controlled; no real-service claim.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
const profile=await mkdtemp(join(tmpdir(),'pd-translation-ui-'));
const extension=resolve('.output/chrome-mv3');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1050,height:850},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
context.setDefaultTimeout(10000);
async function until(test){const deadline=Date.now()+8000;while(!await test()){assert.ok(Date.now()<deadline,'Timed out waiting for expected translation state');await new Promise(done=>setTimeout(done,25));}}
const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
try {
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const base=`chrome-extension://${new URL(worker.url()).host}`;
 const control=await context.newPage();await control.goto(`${base}/options.html`);
 const send=message=>control.evaluate(message=>chrome.runtime.sendMessage(message),message);
 await control.evaluate(()=>chrome.storage.local.set({displayLanguage:'zh-Hans',panelMode:'floating',regularTranslation:'google-gtx'}));
 await worker.evaluate(()=>{
  globalThis.originalFetch=fetch;
  globalThis.queries=[];
  globalThis.fetch=(url,init={})=>new Promise((resolve,reject)=>{
   const u=new URL(url);if(u.hostname!=='translate.googleapis.com'){reject(Error('Unexpected network'));return;}
   const query={text:u.searchParams.get('q'),source:u.searchParams.get('sl'),target:u.searchParams.get('tl'),signal:init.signal,
    reply:(text)=>resolve(new Response(JSON.stringify([[[text]],null,'en']))),fail:()=>reject(Error('Controlled network failure'))};
   queries.push(query);init.signal?.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
  });
 });
 const article='https://example.com/translation';
 await context.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><meta charset="utf-8"><title>Translation source with a long readable title</title><body><button id="outside">Page action</button><article><p id="a" style="white-space:pre-wrap">US policy\nCafé!</p><p id="b">Another distinct selection for reading.</p></article><script>document.getElementById("outside").onclick=()=>document.body.dataset.clicked="yes"</script></body></html>'}));
 const web=await context.newPage();await web.goto(article);await web.locator('html[data-blc-web="1"]').waitFor();
 async function select(id){await web.locator('#outside').click();await web.evaluate(()=>getSelection().removeAllRanges());await web.waitForTimeout(300);await web.evaluate(id=>{const n=document.getElementById(id),range=document.createRange();range.selectNodeContents(n);const s=getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new Event('selectionchange'));},id);await web.locator('#blc-lookup-pill #translate').click();await web.locator('#pd-translation .card').waitFor();}
 const popup=()=>web.locator('#pd-translation');
 await select('a');
 assert.equal(await popup().locator('#original').textContent(),'US policy\nCafé!');
 await until(()=>worker.evaluate(()=>queries.length===1));
 assert.deepEqual(await worker.evaluate(()=>queries.map(q=>[q.text,q.source,q.target])),[['US policy\nCafé!','en','zh-CN']]);
 const header=popup().locator('header');await header.focus();const originalBox=await popup().locator('.card').boundingBox();await header.press('ArrowRight');const moved=await popup().locator('.card').boundingBox();assert.equal(Math.round(moved.x-originalBox.x),16);
 // Pointer drag from the title, leaving body selection enabled.
 const title=await header.locator('strong').boundingBox();await web.mouse.move(title.x+20,title.y+10);await web.mouse.down();await web.mouse.move(title.x+60,title.y+55);await web.mouse.up();
 assert.equal(await popup().locator('main').evaluate(n=>getComputedStyle(n).userSelect),'auto');
 const draggedBox=await popup().locator('.card').boundingBox();
 await popup().locator('#pin').click();await web.locator('#outside').click();assert.equal(await popup().count(),1);assert.equal(await web.locator('body').getAttribute('data-clicked'),'yes');
 await popup().locator('#save').click();await popup().locator('#view:not([hidden])').waitFor();
 const saved=(await send({type:'listKnowledge'})).records[0];assert.equal(saved.origin.type,'translation');assert.equal(saved.body,'US policy\nCafé!');
 await popup().locator('#close').click();assert.equal(await popup().count(),0);assert.equal(await worker.evaluate(()=>queries[0].signal.aborted),false);
 await worker.evaluate(()=>queries[0].reply('美国政策\n咖啡！'));
 await until(async()=>(await send({type:'listKnowledge'})).records[0]?.body.includes('美国政策'));
 assert.equal((await send({type:'listKnowledge'})).records.length,1);
 await select('a');await popup().locator('#copy:not([disabled])').waitFor();assert.equal(await worker.evaluate(()=>queries.length),1);
 const reused=await popup().locator('.card').boundingBox();assert.equal(Math.round(reused.x),Math.round(draggedBox.x));
 await popup().locator('#view').click();
 const frame=web.frameLocator('#pd-floating-panel iframe');await frame.locator('#view-knowledge:not([hidden])').waitFor();await frame.locator(`.knowledge-row[data-id="${saved.id}"][open]`).waitFor();
 assert.ok((await frame.locator('.knowledge-body').innerText()).includes('美国政策'));
 assert.equal(await frame.locator('#review-library').isVisible(),false);
 // Close outer card through Escape, then outside click must remain a real page click.
 await popup().locator('header').focus();await popup().locator('header').press('Escape');assert.equal(await popup().count(),0);
 await web.locator('#pd-floating-panel #close').click().catch(()=>{});
 await send({type:'panelClose'});
 await select('b');await until(()=>worker.evaluate(()=>queries.length===2));await web.locator('#outside').click();assert.equal(await popup().count(),0);assert.equal(await worker.evaluate(()=>queries[1].signal.aborted),true);
 console.log('PASS production selection → immediate card/original → pointer/keyboard movement → keep open → save in-flight → close → background fill → reopen/cache → view exact expanded knowledge record');

 // An inherited whole-page language equal to the target must not bypass real translation.
 const zhPage=await context.newPage();await zhPage.goto('https://example.com/zh-page');await zhPage.locator('html[data-blc-web="1"]').waitFor();
 await zhPage.evaluate(()=>{
  document.documentElement.lang='zh-CN';document.title='A small guide to doing thoughtful work';
  const paragraph=document.getElementById('b');paragraph.textContent='The quality of our work lies in the details.';
  const range=document.createRange();range.selectNodeContents(paragraph);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
 });
 await zhPage.locator('#blc-lookup-pill #translate').click();
 await until(()=>worker.evaluate(()=>queries.some(q=>q.text==='The quality of our work lies in the details.')));
 const request=await worker.evaluate(()=>{const q=queries.find(q=>q.text==='The quality of our work lies in the details.');return {source:q.source,target:q.target};});assert.deepEqual(request,{source:'auto',target:'zh-CN'});
 await worker.evaluate(()=>queries.find(q=>q.text==='The quality of our work lies in the details.').reply('工作的品质，往往体现在细节之中。'));
 const refined=zhPage.locator('#pd-translation');await refined.locator('#copy:not([disabled])').waitFor();
 assert.equal(await refined.locator('#languages').isVisible(),false);assert.equal(await refined.locator('#more-panel').isVisible(),false);
 assert.equal(await refined.locator('footer button:visible').count(),2);assert.ok(!(await refined.locator('footer').innerText()).includes('知识点.md'));
 await refined.locator('.card').screenshot({path:'/tmp/peak-distance-translation-refined.png'});
 const cardBeforeMore=await refined.locator('.card').boundingBox();const queryCount=await worker.evaluate(()=>queries.length);
 await refined.locator('#more').click();await refined.locator('#more-panel').waitFor();assert.equal(await refined.locator('#retry').evaluate(n=>n.getRootNode().activeElement===n),true);
 assert.equal((await refined.locator('.card').boundingBox()).x,cardBeforeMore.x);assert.equal(await worker.evaluate(()=>queries.length),queryCount);
 await refined.locator('#retry').press('Escape');assert.equal(await refined.locator('#more-panel').isVisible(),false);assert.equal(await refined.count(),1);assert.equal(await refined.locator('#more').evaluate(n=>n.getRootNode().activeElement===n),true);
 await refined.locator('#more').click();await refined.locator('#retry').click();await until(()=>worker.evaluate(()=>queries.filter(q=>q.text==='The quality of our work lies in the details.').length===2));
 assert.equal(await refined.locator('#result').innerText(),'工作的品质，往往体现在细节之中。');
 await worker.evaluate(()=>queries.filter(q=>q.text==='The quality of our work lies in the details.')[1].reply('品质，藏在认真对待的每一处细节里。'));
 await refined.locator('#result').filter({hasText:'认真对待'}).waitFor();
 await refined.locator('#language-toggle').click();assert.equal(await refined.locator('#languages').isVisible(),true);
 await refined.locator('#from').press('Escape');assert.equal(await refined.locator('#languages').isVisible(),false);assert.equal(await refined.count(),1);
 await refined.locator('#close').click();await zhPage.close();
 console.log('PASS refined card: two footer actions, collapsed secondary controls, accessible more/language disclosure, explicit retry, and auto-detection for English on a zh-CN page');

 // Real background + IDB race protections through the narrow save messages.
 const begin=async(text,id)=>{void control.evaluate(({text,id})=>chrome.runtime.sendMessage({type:'translateSelection',text,requestId:id,snapshot:{text,url:'https://example.com/races',title:'Races'},sourceLang:'en',targetLang:'zh-Hans'}),{text,id});await until(()=>worker.evaluate(text=>queries.some(q=>q.text===text),text));};
 const finish=async(text)=>worker.evaluate(text=>queries.find(q=>q.text===text).reply(`translated ${text}`),text);
 await begin('edited original','edit');const edit=await send({type:'saveSelectionKnowledge',requestId:'edit',vaultId:null});assert.equal(edit.ok,true);
 await send({type:'updateKnowledge',id:edit.id,title:'My title',body:'My edited body',vaultId:null});await finish('edited original');await new Promise(done=>setTimeout(done,60));assert.equal((await send({type:'listKnowledge'})).records.find(k=>k.id===edit.id).body,'My edited body');
 await begin('deleted original','delete');const deleted=await send({type:'saveSelectionKnowledge',requestId:'delete',vaultId:null});await send({type:'deleteKnowledge',id:deleted.id,vaultId:null});
 const restored=await send({type:'saveSelectionKnowledge',requestId:'delete',vaultId:null});assert.notEqual(restored.id,deleted.id);await finish('deleted original');await new Promise(done=>setTimeout(done,60));assert.ok(!(await send({type:'listKnowledge'})).records.some(k=>k.id===deleted.id));assert.equal((await send({type:'listKnowledge'})).records.find(k=>k.id===restored.id).body,'deleted original');
 await begin('duplicate original','duplicate');const dup1=await send({type:'saveSelectionKnowledge',requestId:'duplicate',vaultId:null}),dup2=await send({type:'saveSelectionKnowledge',requestId:'duplicate',vaultId:null});assert.equal(dup1.id,dup2.id);await finish('duplicate original');
 await begin('retry original','retry');const retrySave=await send({type:'saveSelectionKnowledge',requestId:'retry',vaultId:null});await worker.evaluate(()=>queries.find(q=>q.text==='retry original').fail());await new Promise(done=>setTimeout(done,30));assert.equal((await send({type:'listKnowledge'})).records.find(k=>k.id===retrySave.id).body,'retry original');
 void control.evaluate(()=>chrome.runtime.sendMessage({type:'translateSelection',text:'retry original',snapshot:{text:'retry original',url:'https://example.com/races',title:'Races'},requestId:'retry-new',sourceLang:'en',targetLang:'zh-Hans',fresh:true,replaceRequestId:'retry'}));await until(()=>worker.evaluate(()=>queries.filter(q=>q.text==='retry original').length===2));await worker.evaluate(()=>queries.filter(q=>q.text==='retry original')[1].reply('Recovered translation'));await until(async()=>(await send({type:'listKnowledge'})).records.find(k=>k.id===retrySave.id)?.body.includes('Recovered'));
 const closedPage=await context.newPage();await closedPage.goto(`${base}/options.html`);
 void closedPage.evaluate(()=>chrome.runtime.sendMessage({type:'translateSelection',text:'Page closed original',snapshot:{text:'Page closed original',url:'https://example.com/page-close',title:'Close'},requestId:'page-close',sourceLang:'en',targetLang:'zh-Hans'})).catch(()=>{});
 await until(()=>worker.evaluate(()=>queries.some(q=>q.text==='Page closed original')));
 const pageSaved=await closedPage.evaluate(()=>chrome.runtime.sendMessage({type:'saveSelectionKnowledge',requestId:'page-close',vaultId:null}));assert.equal(pageSaved.ok,true);
 await closedPage.close();await finish('Page closed original');await until(async()=>(await send({type:'listKnowledge'})).records.find(k=>k.id===pageSaved.id)?.body.includes('translated'));
 const beforeClear=(await send({type:'listKnowledge'})).records;await send({type:'clearQueryCache'});assert.deepEqual((await send({type:'listKnowledge'})).records,beforeClear);
 console.log('PASS background/IDB duplicate saves, edit protection, deletion without resurrection, original retained on network failure, explicit retry fills the same record, cache clearing preserves favorites');

 // Use the real IDB transaction functions to exercise owner switching and failed queue commits.
 const dbBundle=(await build({stdin:{contents:"export * as db from './lib/db'; export * from './shared/knowledge';",resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',globalName:'TestDb'})).outputFiles[0].text;
 await control.evaluate(dbBundle+';globalThis.TestDb=TestDb');
 await begin('old library','owner');const owned=await send({type:'saveSelectionKnowledge',requestId:'owner',vaultId:null});
 await control.evaluate(()=>TestDb.db.setVaultIdentity({vaultId:'new-library',formatVersion:4,createdAt:1}));await finish('old library');await new Promise(done=>setTimeout(done,50));assert.ok(!(await send({type:'listKnowledge'})).records.find(k=>k.id===owned.id)?.body.includes('translated'));
 assert.equal((await send({type:'saveSelectionKnowledge',requestId:'duplicate',vaultId:null})).error,'conflict');
 const txResult=await control.evaluate(async()=>{
  const originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='vaultQueue')throw Error('Controlled queue failure');return originalPut.apply(this,args);};
  try {await TestDb.db.saveTranslationKnowledge({text:'Must roll back',url:'https://example.com/rollback',title:'Rollback'},'en','de','new-library');return false;}catch{return !(await TestDb.db.listKnowledge()).some(k=>k.body==='Must roll back');}finally{IDBObjectStore.prototype.put=originalPut;}
 });assert.equal(txResult,true);
 console.log('PASS owner switch blocks old-card saves/backfill; a pending-write failure rolls back the whole local save transaction');

 // Source popup implementation with deliberately reordered settings, to exercise UI identity before network startup.
 const popupBundle=(await build({stdin:{contents:"export { createTranslationPopup } from './shared/translationPopup'; export {setDisplayLanguage} from './shared/i18n';",resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'text'},globalName:'PopupTest'})).outputFiles[0].text;
 const lifecycle=await context.newPage();await lifecycle.goto('https://example.com/lifecycle');await lifecycle.addScriptTag({content:popupBundle});
 await lifecycle.evaluate(()=>{
  globalThis.pendingSettings=[];globalThis.popupCalls=[];
  globalThis.testPopup=PopupTest.createTranslationPopup(message=>{
   popupCalls.push(message);
   if(message.type==='getSettings')return new Promise(resolve=>pendingSettings.push(resolve));
   if(message.type==='selectionKnowledgeState')return Promise.resolve({ok:true,vaultId:null});
   if(message.type==='translateSelection')return Promise.resolve({ok:true,text:'Late-safe translation',detectedLang:'en'});
   return Promise.resolve({ok:true});
  });
  testPopup.open({text:'A delayed selection',url:location.href,title:'A'});
 });assert.equal(await lifecycle.locator('#pd-translation #original').textContent(),'A delayed selection');
 await lifecycle.evaluate(()=>testPopup.open({text:'B current selection',url:location.href,title:'B'}));
 await lifecycle.evaluate(()=>pendingSettings[1]({ok:true,settings:{comprehensionOverrides:{en:'de'}}}));await lifecycle.locator('#pd-translation #result').filter({hasText:'Late-safe'}).waitFor();
 await lifecycle.evaluate(()=>pendingSettings[0]({ok:true}));assert.equal(await lifecycle.locator('#pd-translation #original').textContent(),'B current selection');assert.deepEqual(await lifecycle.evaluate(()=>popupCalls.filter(m=>m.type==='translateSelection').map(m=>m.text)),['B current selection']);
 assert.equal(await lifecycle.locator('#pd-translation #from').inputValue(),'auto');assert.equal(await lifecycle.locator('#pd-translation #to').inputValue(),'zh-Hans');
 await lifecycle.locator('#pd-translation #language-toggle').click();
 await lifecycle.locator('#pd-translation #from').selectOption('en');assert.equal(await lifecycle.locator('#pd-translation #to').inputValue(),'de');
 await lifecycle.locator('#pd-translation #to').selectOption('fr');await lifecycle.locator('#pd-translation #from').selectOption('ja');assert.equal(await lifecycle.locator('#pd-translation #to').inputValue(),'fr');
 await lifecycle.locator('#pd-translation #language-toggle').click();
 const callsBeforeLocale=await lifecycle.evaluate(()=>popupCalls.filter(m=>m.type==='translateSelection').length);await lifecycle.evaluate(()=>PopupTest.setDisplayLanguage('de','de'));assert.equal(await lifecycle.evaluate(()=>popupCalls.filter(m=>m.type==='translateSelection').length),callsBeforeLocale);
 await lifecycle.setViewportSize({width:360,height:620});await lifecycle.evaluate(()=>{document.querySelector('#pd-translation').shadowRoot.getElementById('result').textContent='Long translated text. '.repeat(600);});
 await lifecycle.waitForFunction(()=>{const r=document.querySelector('#pd-translation')?.shadowRoot.querySelector('.card')?.getBoundingClientRect();return r&&r.x>=12&&r.y>=12&&r.right<=innerWidth-12&&r.bottom<=innerHeight-12;});
 const bounds=await lifecycle.locator('#pd-translation .card').boundingBox();assert.ok(bounds.x>=12&&bounds.y>=12&&bounds.x+bounds.width<=348&&bounds.y+bounds.height<=608);assert.equal(await lifecycle.locator('#pd-translation footer').isVisible(),true);
 await lifecycle.screenshot({path:'/tmp/pd-translation-narrow.png'});
 console.log('PASS delayed settings A/B cannot mount or query A after B; card is mounted before settings; long text stays inside narrow viewport with footer accessible');
 assert.deepEqual(errors,[]);
}catch(error){console.error('UI page errors',errors);throw error;}finally{await context.close();await rm(profile,{recursive:true,force:true});}
