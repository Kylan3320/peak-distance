// Production extension + real IndexedDB/content scripts. Controlled pages and pre-existing answers.
// --bbc probes the actual BBC page separately; it never substitutes fixture HTML for that URL.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root=resolve(import.meta.dirname,'..'),profile=await mkdtemp(join(tmpdir(),'pd-content-ui-'));
const output=resolve('.upstream/current-content');await mkdir(output,{recursive:true});
const extension=resolve('.output/chrome-mv3');
const context=await chromium.launchPersistentContext(profile,{...(process.platform==='win32'?{executablePath:process.env.BLC_CHROME||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'}:{channel:'chromium'}),headless:true,viewport:{width:1000,height:850},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
context.setDefaultTimeout(12000);
const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
try {
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  const base=`chrome-extension://${new URL(worker.url()).host}`;
  await worker.evaluate(()=>{globalThis.originalFetch=globalThis.fetch.bind(globalThis);globalThis.unexpectedRequests=[];globalThis.fetch=async url=>{unexpectedRequests.push(String(url));throw Error('Unexpected network request');};});
  const control=await context.newPage();await control.goto(`${base}/options.html`);
  await control.evaluate(()=>chrome.storage.local.set({displayLanguage:'zh-Hans'}));
  const send=message=>control.evaluate(message=>chrome.runtime.sendMessage(message),message);
  const a='https://example.com/current-a',b='https://example.com/current-b';
  await context.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><title>${route.request().url()===a?'Article A':'Article B'}</title><article><h1>Reading source</h1><p>A bank by the river.</p><p>Another bank in A.</p><p>${'This article explains language and everyday learning. '.repeat(10)}</p></article></html>`}));
  const web=await context.newPage();await web.goto(a);await web.locator('html[data-blc-web="1"]').waitFor();
  const save=(expression,sentence,url,lang='en',definition)=>send({type:'save',snapshot:{source:'web',expression,sentence,url,title:url===a?'Article A':'Article B',lang},...(definition?{definition}: {})});
  assert.equal((await save('bank','A bank by the river.',a,'en','A meaning')).ok,true);
  assert.equal((await save('bank','B latest banking sentence.',b,'en','B meaning')).ok,true);
  await save('known','Known in A.',a);await send({type:'setStatus',key:'en::known',status:'known'});
  await save('bank','Banque française.',a,'fr','French meaning');
  const panel=await context.newPage();await panel.goto(`${base}/sidepanel.html#subs`);await panel.waitForFunction(()=>!document.body.inert);
  await web.bringToFront();
  await panel.getByRole('heading',{name:'Article A',exact:true}).waitFor();
  assert.equal(await panel.locator('#web-selection .entry').count(),3);
  assert.ok(!(await panel.locator('#web-selection').innerText()).includes('B latest'));
  await panel.getByRole('button',{name:'复习本篇',exact:true}).click();
  await panel.getByText('请选择一种语言开始复习',{exact:true}).waitFor();
  await panel.locator('#review-body button').filter({hasText:'英语'}).click();
  await panel.getByRole('button',{name:'显示单词',exact:true}).click();
  assert.ok(!(await panel.locator('#review-body').innerText()).includes('A meaning'));
  await panel.reload();await panel.waitForFunction(()=>!document.body.inert);
  assert.equal(await panel.locator('.review-reveal .word').innerText(),'bank');
  assert.equal(await panel.locator('.review-annotation .definition').count(),0);
  await panel.getByRole('button',{name:'显示释义',exact:true}).click();
  assert.ok((await panel.locator('#review-body').innerText()).includes('A meaning'));
  assert.ok(!(await panel.locator('#review-body').innerText()).includes('B meaning'));
  const other=await context.newPage();await other.goto(b);await other.locator('html[data-blc-web="1"]').waitFor();await other.bringToFront();
  await save('bank','Another bank in A.',a);
  await panel.waitForFunction(()=>document.querySelector('#review-body .sentence')?.textContent.includes('Another'));
  await panel.getByRole('button',{name:'显示单词',exact:true}).click();
  assert.equal(await panel.locator('.review-annotation .no-def').count(),0);
  await panel.getByRole('button',{name:'显示释义',exact:true}).click();
  await panel.locator('#review-body').getByText('尚无解释',{exact:true}).waitFor();
  await panel.reload();await panel.waitForFunction(()=>!document.body.inert);
  await panel.locator('#review-body').getByText('尚无解释',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'退出复习',exact:true}).click();
  await panel.getByRole('heading',{name:'Article A',exact:true}).waitFor();
  await panel.getByRole('button',{name:'定位原句',exact:true}).first().click();
  await panel.getByText('已找到原文。',{exact:true}).first().waitFor();
  await panel.getByText('已找到原文。',{exact:true}).first().waitFor({state:'hidden'});
  await panel.locator('#views [data-view="list"]').click();
  await other.bringToFront();await panel.locator('#views [data-view="subs"]').click();
  await panel.getByRole('heading',{name:'Article B',exact:true}).waitFor();
  console.log('PASS production UI: A contexts/definitions and known rows; explicit single language; refresh/reveal/reload; fixed source after tab change and return, then normal active-page following');

  const results=[
    ['episode',{kind:'dictionary',selectedSense:1,entry:{source:'youdao',expression:'episode',headword:'episode',url:'https://dict.youdao.com/result?word=episode',senses:[{definition:'Wrong first sense'},{definition:'Saved episode meaning'}]}}],
    ['quantify',{kind:'translation',source:'google-gtx',text:'Saved quantify translation'}],
    ['ultimate',{kind:'ai-definition',source:'ai',text:'Saved ultimate AI meaning',lang:{source:'en',target:'zh-Hans'}}],
  ];
  for(const [expression,result] of results)assert.equal((await send({type:'save',snapshot:{source:'web',expression,sentence:`A sentence with ${expression}.`,url:a,title:'Article A',lang:'en'},result})).ok,true);
  await web.bringToFront();
  await panel.getByRole('heading',{name:'Article A',exact:true}).waitFor();
  for(const [expression,result] of results){
    const row=panel.locator(`.entry[data-key="en::${expression}"]`);
    assert.equal(await row.locator('.entry-preview').innerText(),result.kind==='dictionary'?result.entry.senses[1].definition:result.text);
    assert.ok((await row.innerText()).includes('一般释义参考'));
  }
  await panel.locator('.article-tools select').selectOption('en');
  await panel.getByRole('button',{name:'复习本篇',exact:true}).click();
  const jump=panel.getByRole('combobox',{name:'跳转题目',exact:true});
  await jump.selectOption('1');
  await panel.getByRole('button',{name:'显示单词',exact:true}).click();
  const currentExpression=await panel.locator('.review-reveal .word').innerText();
  assert.equal(await panel.locator('.review-annotation .definition').count(),0);
  await panel.getByRole('button',{name:'显示释义',exact:true}).click();
  assert.ok((await panel.locator('.review-annotation').innerText()).includes('一般释义参考'));
  await panel.reload();await panel.waitForFunction(()=>!document.body.inert);
  assert.equal(await panel.locator('.review-reveal .word').innerText(),currentExpression);
  assert.equal(await panel.locator('.review-annotation .definition').count(),1);
  await panel.setViewportSize({width:390,height:844});
  assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
  await panel.screenshot({path:join(output,'vocab-review-390.png'),fullPage:true});
  await panel.setViewportSize({width:1000,height:850});
  await panel.locator('#review-body button[data-i18n="返回来源"]').click();
  await panel.locator('#panel-feedback').waitFor({state:'visible'});
  await panel.locator('#panel-feedback').waitFor({state:'hidden'});
  await panel.locator('#review-body button[data-i18n="返回来源"]').click();
  await panel.locator('#panel-feedback').waitFor({state:'visible'});
  await panel.getByRole('button',{name:'下一条',exact:true}).click();
  assert.equal(await panel.locator('.review-reveal .word').count(),0);
  assert.equal(await panel.locator('.review-annotation .definition').count(),0);
  await panel.getByRole('button',{name:'上一条',exact:true}).click();
  assert.equal(await jump.inputValue(),'1');
  await panel.getByRole('button',{name:'打乱顺序',exact:true}).click();
  assert.equal(await jump.inputValue(),'0');
  await panel.getByRole('button',{name:'显示释义',exact:true}).click();
  assert.equal(await panel.locator('.review-reveal .word').count(),0);
  const order=await panel.evaluate(async()=>{const {windowId}=await chrome.runtime.sendMessage({type:'panelContext'});return (await chrome.storage.session.get(`panel-state:${windowId}`))[`panel-state:${windowId}`];});
  await panel.reload();await panel.waitForFunction(()=>!document.body.inert);
  assert.equal(await jump.inputValue(),'0');
  assert.equal(await panel.locator('.review-reveal .word').count(),0);
  const restoredOrder=await panel.evaluate(async()=>{const {windowId}=await chrome.runtime.sendMessage({type:'panelContext'});return (await chrome.storage.session.get(`panel-state:${windowId}`))[`panel-state:${windowId}`];});
  assert.deepEqual(restoredOrder.reviewQueue.map(item=>item.key),order.reviewQueue.map(item=>item.key));
  await panel.getByRole('button',{name:'退出复习',exact:true}).click();
  assert.equal(await panel.locator('#panel-feedback').isVisible(),false);
  await panel.locator('.article-tools select').selectOption('all');
  console.log('PASS result-only dictionary/translation/AI references, independent reveal/reload, previous/jump/shuffle navigation and temporary location feedback');

  await worker.evaluate(()=>{
    globalThis.savedLookupStarted=new Promise(done=>{globalThis.markSavedLookupStarted=done;});
    globalThis.fetch=async(url,options)=>{
      if(!String(url).includes('dict.youdao.com/jsonapi?q=river'))throw Error(`Unexpected lookup request: ${url}`);
      markSavedLookupStarted();
      return new Promise((done,reject)=>{
        globalThis.finishSavedLookup=()=>done(Response.json({ec:{word:[{'return-phrase':{l:{i:'river'}},trs:[{tr:[{l:{i:['n. 河流']}}]}]}]}}));
        options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
      });
    };
  });
  await web.bringToFront();
  await web.evaluate(()=>{
    const walker=document.createTreeWalker(document.querySelector('article'),NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode())&&!node.textContent.includes('river')){}
    if(!node)throw Error('River expression not found');
    const start=node.textContent.indexOf('river'),range=document.createRange();range.setStart(node,start);range.setEnd(node,start+5);
    getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  });
  await web.locator('#blc-lookup-pill #lookup').click();
  await worker.evaluate(()=>savedLookupStarted);
  await web.locator('#blc-lookup-popup .act.save').click();
  await web.locator('#blc-lookup-popup [data-i18n="关闭"]').click();
  await worker.evaluate(()=>finishSavedLookup());
  await panel.waitForFunction(()=>document.querySelector('.entry[data-key="en::river"] .entry-preview')?.textContent==='河流');
  await send({type:'deleteEntry',key:'en::river'});
  await worker.evaluate(()=>{globalThis.fetch=async url=>{unexpectedRequests.push(String(url));throw Error('Unexpected network request');};});
  console.log('PASS save while lookup is pending, close immediately, then backfill the saved context without reopening the popup');

  const fixture=await control.evaluate(async({a,b})=>{
    const source={sourceType:'article',sourceKey:`web:${a}`,url:a,title:'Article A'};
    const chat={id:'ui-independent',title:'Saved conversation',sourceKey:`web:${b}`,activeSnapshotVersion:1,draft:'',pendingQuote:null,updatedAt:2,source:{...source,sourceKey:`web:${b}`,url:b,title:'Article B'},snapshots:[{source,version:1,createdAt:1,label:'Article A',blocks:[{id:'p1',text:'Saved citation from Article A.'}]}],messages:[{id:'q',role:'user',turnId:'t',text:'Explain the river bank',snapshotVersion:1,at:1},{id:'answer',role:'assistant',turnId:'t',text:'Existing answer from A [p1]',state:'done',at:2}]};
    await new Promise((done,reject)=>{const r=indexedDB.open('blc-learning');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('conversations','readwrite');tx.objectStore('conversations').put(chat);tx.oncomplete=()=>{db.close();done();};tx.onabort=()=>reject(tx.error);};});return chat;
  },{a,b});
  await send({type:'chatSelect',chatId:fixture.id});
  await panel.locator('#views [data-view="chat"]').click();
  await panel.locator('.knowledge-save > button').click();
  const editor=panel.locator('.knowledge-editor');
  await editor.locator('input').fill('Cancelled knowledge draft');await editor.locator('button[type="button"]').click();
  assert.equal((await send({type:'listKnowledge'})).records.length,0);
  await panel.locator('.knowledge-save > button').click();
  await editor.getByRole('textbox',{name:'知识点标题'}).fill('Edited knowledge title');
  await editor.getByRole('textbox',{name:'知识点正文'}).fill('Edited independent body [p1]');
  await control.evaluate(()=>chrome.storage.local.set({displayLanguage:'de'}));
  await panel.waitForFunction(()=>document.documentElement.lang==='de');
  assert.equal(await editor.locator('textarea').inputValue(),'Edited independent body [p1]');
  await control.evaluate(()=>chrome.storage.local.set({displayLanguage:'zh-Hans'}));await panel.waitForFunction(()=>document.documentElement.lang==='zh-Hans');
  // A retain toggle rebuilds messages; the open editor must keep its unsaved input.
  await panel.locator('[data-i18n="保留解释"]').click();
  assert.equal(await editor.getByRole('textbox',{name:'知识点正文'}).inputValue(),'Edited independent body [p1]');
  await panel.evaluate(()=>{globalThis.originalSend=chrome.runtime.sendMessage;chrome.runtime.sendMessage=function(...args){if(args[0]?.type==='saveKnowledge'){args[1]({ok:false,error:'io'});return;}return originalSend.apply(this,args);};});
  await editor.getByRole('button',{name:'保存知识点',exact:true}).click();
  await editor.locator('[data-i18n="保存失败，请重试"]').waitFor();
  assert.equal(await editor.locator('textarea').inputValue(),'Edited independent body [p1]');
  await panel.evaluate(()=>{chrome.runtime.sendMessage=originalSend;});
  await editor.getByRole('button',{name:'保存知识点',exact:true}).click();
  await panel.getByText('已保存在本机，待写入学习库',{exact:true}).waitFor();
  assert.equal((await send({type:'listKnowledge'})).records[0].source.url,a);
  await panel.locator('.knowledge-save > button').click();await editor.locator('textarea').fill('Do not replace edited knowledge');await editor.locator('button[type="submit"]').click();
  await panel.getByText('已保存此回答，保留现有修改',{exact:true}).waitFor();assert.equal((await send({type:'listKnowledge'})).records[0].body,'Edited independent body [p1]');
  await send({type:'chatDelete',chatId:fixture.id});
  await web.bringToFront();await panel.locator('#views [data-view="subs"]').click();
  await panel.getByRole('heading',{name:'Article A',exact:true}).waitFor();
  await panel.locator('.article-tools [data-category="knowledge"]').click();
  await panel.locator('.knowledge-row summary').click();
  assert.ok((await panel.locator('.knowledge-row').innerText()).includes('Saved citation from Article A.'));
  await panel.getByRole('button',{name:'编辑',exact:true}).click();
  await panel.locator('.knowledge-editor').getByRole('textbox',{name:'知识点正文'}).fill('Revised independent body');
  await panel.evaluate(()=>{
    globalThis.articleSend=chrome.runtime.sendMessage;globalThis.articlePolls=0;
    chrome.runtime.sendMessage=function(...args){if(args[0]?.type==='listKnowledge')articlePolls++;return articleSend.apply(this,args);};
  });
  await other.bringToFront();
  await panel.waitForFunction(()=>articlePolls>=2);
  await panel.evaluate(()=>{chrome.runtime.sendMessage=articleSend;});
  assert.equal(await panel.locator('#web-selection h1').innerText(),'Article A');
  await panel.getByRole('button',{name:'复习本篇',exact:true}).click();
  await panel.getByRole('button',{name:'显示答案',exact:true}).click();
  await panel.locator('#review-body').getByText('Edited independent body [p1]',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'返回当前内容',exact:true}).click();
  assert.equal(await panel.locator('.knowledge-editor textarea').inputValue(),'Revised independent body');
  await web.bringToFront();
  await panel.locator('.knowledge-editor').getByRole('button',{name:'保存知识点',exact:true}).click();
  await panel.waitForFunction(()=>document.querySelector('.knowledge-row .knowledge-body')?.textContent==='Revised independent body');
  await panel.setViewportSize({width:390,height:844});
  await panel.locator('.knowledge-row summary').click();
  assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
  await panel.screenshot({path:join(output,'article-knowledge-390.png'),fullPage:true});
  await panel.getByRole('button',{name:'复习本篇',exact:true}).click();
  await panel.getByRole('button',{name:'显示答案',exact:true}).click();
  await panel.locator('#review-body').getByText('Revised independent body',{exact:true}).waitFor();
  await panel.reload();await panel.waitForFunction(()=>!document.body.inert);await panel.locator('#review-body').getByText('Revised independent body',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'下一条',exact:true}).click();
  await panel.locator('[data-i18n="再来一轮"]').click();
  await panel.getByRole('button',{name:'显示答案',exact:true}).click();
  await panel.locator('#review-body').getByText('Revised independent body',{exact:true}).waitFor();
  await panel.screenshot({path:join(output,'knowledge-review-390.png'),fullPage:true});
  await web.bringToFront();
  const sourceTab=await control.evaluate(async()=>(await chrome.tabs.query({active:true,currentWindow:true}))[0].id);
  assert.equal((await control.evaluate(id=>chrome.tabs.sendMessage(id,{type:'pd-panel-show'},{frameId:0}),sourceTab)).ok,true);
  const floating=web.frames().find(f=>f.url().includes('/sidepanel.html'));
  await floating.waitForFunction(()=>!document.body.inert);
  await floating.locator('#review-body').getByText('Revised independent body',{exact:true}).waitFor();
  const cdp=await context.newCDPSession(web);
  const priorTargets=new Set((await cdp.send('Target.getTargets')).targetInfos.map(t=>t.targetId));
  let nativeTarget;
  const attemptNative=process.argv.includes('--native')||process.argv.includes('--require-native');
  if(attemptNative){
    await floating.locator('#panel-mode').click();
    for(let i=0;i<60&&!nativeTarget;i++) { nativeTarget=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='page'&&t.url.startsWith(`${base}/sidepanel.html`)&&!priorTargets.has(t.targetId));if(!nativeTarget)await new Promise(done=>setTimeout(done,100)); }
  }
  if(!nativeTarget) {
    const evidence={status:'unverified',reason:'Headless Edge produced no native sidebar target or SIDE_PANEL context after the real mode-button click.',contexts:await control.evaluate(()=>chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']}))};
    if(attemptNative)await writeFile(join(output,'native-sidebar.json'),JSON.stringify(evidence,null,2));
    console.log('UNVERIFIED native sidebar transfer:',attemptNative?evidence.reason:'Not repeated in this controlled run; use --require-native for a mandatory native check.');
    if(process.argv.includes('--require-native'))assert.fail(evidence.reason);
  } else {
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:nativeTarget.targetId,flatten:false});
  let commandId=0;const pending=new Map();
  cdp.on('Target.receivedMessageFromTarget',event=>{if(event.sessionId!==sessionId)return;const response=JSON.parse(event.message),finish=pending.get(response.id);if(finish){pending.delete(response.id);finish(response);}});
  const nativeCommand=(method,params={})=>new Promise((done,reject)=>{const id=++commandId;pending.set(id,result=>result.error?reject(Error(result.error.message)):done(result.result));void cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);});
  const nativeEval=async expression=>{const result=await nativeCommand('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;};
  let restored=false;
  for(let i=0;i<60&&!restored;i++){restored=await nativeEval('!document.body.inert && document.querySelector("#review-body")?.innerText.includes("Revised independent body")');if(!restored)await new Promise(done=>setTimeout(done,100));}
  assert.ok(restored,'Native sidebar restores revealed knowledge');
  const screenshot=await nativeCommand('Page.captureScreenshot',{format:'png'});await writeFile(join(output,'knowledge-review-native.png'),Buffer.from(screenshot.data,'base64'));
  await nativeEval('document.querySelector("#panel-mode").click()');
  await web.locator('#pd-floating-panel').waitFor({state:'visible'});
  await floating.locator('#review-body').getByText('Revised independent body',{exact:true}).waitFor();
  await writeFile(join(output,'native-sidebar.json'),JSON.stringify({status:'passed',source:'actual native sidebar target'},null,2));
  }
  await floating.getByRole('button',{name:'返回当前内容',exact:true}).focus();
  await floating.getByRole('button',{name:'返回当前内容',exact:true}).press('Enter');
  await floating.getByRole('heading',{name:'Article A',exact:true}).waitFor();
  assert.equal(await floating.locator('.article-tools button[aria-pressed="true"] [data-i18n]').innerText(),'知识点');
  // Resume the standalone fixed test surface through the same panel transfer event.
  const {windowId}=await floating.evaluate(()=>chrome.runtime.sendMessage({type:'panelContext'}));
  await control.evaluate(async windowId=>{await chrome.storage.session.remove(`panel-host:${windowId}`);await chrome.runtime.sendMessage({type:'pd-panel-view',windowId,mode:'fixed'});},windowId);
  await control.evaluate(id=>chrome.tabs.sendMessage(id,{type:'pd-panel-hide'},{frameId:0}),sourceTab);
  await panel.waitForFunction(()=>!document.body.inert);
  console.log(nativeTarget?'PASS real floating iframe → native sidebar → floating transfer preserves the review scope and return target':'PASS real floating iframe restores source, language, category and revealed card; return preserves article/category. Native transfer remains unverified.');
  await panel.getByRole('heading',{name:'Article A',exact:true}).waitFor();
  await panel.locator('.knowledge-row summary').click();
  await panel.getByRole('button',{name:'删除知识点',exact:true}).click();
  await panel.getByRole('button',{name:'确认删除知识点',exact:true}).click();
  await panel.waitForFunction(()=>document.querySelectorAll('.knowledge-row').length===0);
  assert.deepEqual(await worker.evaluate(()=>unexpectedRequests),[]);
  assert.deepEqual(errors,[]);
  console.log('PASS production UI: save/edit existing answer after navigation, retain semantics and editor preservation, delete original chat, independent body/citation, knowledge review/reload/repeat/return/delete, narrow layout and zero network requests');

  await send({type:'setSetting',name:'chineseVisible',value:false});
  await context.route('https://www.youtube.com/watch?v=abcdefghijk',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><title>Scoped video</title><div id="movie_player" style="width:640px;height:360px"><video></video><div class="ytp-chrome-bottom"><div class="ytp-right-controls"></div></div></div><script>
  addEventListener('message',e=>{const m=e.data;if(m?.source==='blc-content'&&m.type==='config')postMessage({source:'blc-inject',type:'cues',nonce:m.nonce,videoId:'abcdefghijk',trackId:'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en',trackLang:'en',trackKind:'manual',seen:1,cues:[{start:0,dur:3000,lastOff:0,text:'A video-word in this video.'},{start:3000,dur:3000,lastOff:0,text:'Next subtitle.'}]},'*');});
  </script></html>`}));
  const videoPage=await context.newPage();await videoPage.goto('https://www.youtube.com/watch?v=abcdefghijk');
  await videoPage.locator('#blc-subs .en').waitFor();
  const videoRef={videoId:'abcdefghijk',trackId:'en-track',trackKind:'manual',trackLang:'en',startMs:0};
  for(const [video,lang,sentence,definition] of [[videoRef,'en','A video-word in this video.','Video A meaning'],[{...videoRef,videoId:'other-video'},'en','B latest video-word sentence.','Video B meaning'],[{...videoRef,trackLang:'fr'},'fr','Un video-word français.','French video meaning']]) {
    assert.equal((await send({type:'save',snapshot:{source:'video',expression:'video-word',sentence,title:'Saved video',video,lang},definition})).ok,true);
  }
  await videoPage.bringToFront();await panel.locator('#views [data-view="list"]').click();await panel.locator('#views [data-view="subs"]').click();
  await panel.locator('#blc-learning-panel [data-tab="saved"]').click();
  await panel.locator('#blc-learning-panel [data-i18n="复习"]').click();
  await panel.locator('#review-body [data-i18n="显示单词"]').click();
  assert.ok(!(await panel.locator('#review-body').innerText()).includes('Video A meaning'));
  await panel.locator('#review-body [data-i18n="显示释义"]').click();
  assert.ok((await panel.locator('#review-body').innerText()).includes('Video A meaning'));
  assert.ok(!(await panel.locator('#review-body').innerText()).includes('Video B meaning'));
  await other.bringToFront();await panel.locator('#review-body [data-i18n="下一条"]').click();await panel.locator('[data-i18n="再来一轮"]').click();
  await panel.locator('#review-body [data-i18n="显示单词"]').click();
  await panel.locator('#review-body [data-i18n="显示释义"]').click();assert.ok((await panel.locator('#review-body').innerText()).includes('Video A meaning'));
  await panel.locator('#review-body [data-i18n="退出复习"]').click();
  await panel.locator('#blc-learning-panel [data-tab="saved"][class="active"]').waitFor();
  assert.ok((await panel.locator('#blc-learning-panel .body').innerText()).includes('A video-word in this video.'));
  await panel.screenshot({path:join(output,'video-review-return.png'),fullPage:true});
  console.log('PASS controlled video: saved vocabulary review fixes video/language; repeat after a tab switch keeps A context and returns to the saved tab');

  if(process.argv.includes('--bbc')) {
    const bbc=await context.newPage(),url='https://www.bbc.co.uk/learningenglish/english/features/office-english/260817';
    let pageLoaded=false;
    try {
      const response=await bbc.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
      const evidence={url:bbc.url(),status:response?.status(),title:await bbc.title(),text:(await bbc.locator('body').innerText()).slice(0,1000)};
      await bbc.screenshot({path:join(output,'bbc-live.png'),fullPage:true});
      await writeFile(join(output,'bbc-live.json'),JSON.stringify(evidence,null,2));console.log('BBC LIVE',JSON.stringify(evidence));
      assert.equal(response.status(),200);assert.ok(evidence.title.includes('Plans and strategies'));
      pageLoaded=true;
      await bbc.locator('html[data-blc-web="1"]').waitFor();
      await worker.evaluate(()=>{globalThis.bbcRequests=[];globalThis.fetch=async(input,init)=>{const url=String(input);bbcRequests.push(url);if(/deepseek|openai|anthropic/.test(url))throw Error('AI is forbidden in this check');return originalFetch(input,init);};});
      await bbc.evaluate(()=>{
        const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
        while(node=walker.nextNode()) {const i=node.textContent.indexOf('targets');if(i<0||node.parentElement.closest('script,style,[id^="blc"],[id^="pd-"]'))continue;node.parentElement.scrollIntoView();const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+7);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));return;}
        throw Error('Actual BBC expression not found');
      });
      await bbc.locator('#blc-lookup-pill #lookup').click();
      await bbc.locator('#blc-lookup-popup .act.save').click();
      await bbc.locator('#blc-lookup-popup [data-i18n="关闭"]').click();
      await bbc.bringToFront();await panel.locator('#views [data-view="list"]').click();await panel.locator('#views [data-view="subs"]').click();
      await panel.getByRole('heading',{name:evidence.title,exact:true}).waitFor();
      await panel.locator('.article-tools [data-category="vocab"]').click();
      const target=panel.locator('#web-selection .entry').filter({has:panel.getByRole('heading',{name:'targets',exact:true})});
      await target.waitFor();await target.locator('.entry-preview').waitFor();
      const savedMeaning=await target.locator('.entry-preview').innerText();
      assert.ok(savedMeaning.trim());assert.ok((await target.innerText()).includes('一般释义参考'));
      await target.getByRole('button',{name:'定位原句',exact:true}).first().click();
      await target.getByText('已找到原文。',{exact:true}).first().waitFor();
      const sentence=await target.locator(':scope > .sentence').innerText();
      await panel.locator('.article-tools select').selectOption('en');
      await panel.getByRole('button',{name:'复习本篇',exact:true}).click();await panel.getByRole('button',{name:'显示单词',exact:true}).click();
      assert.equal(await panel.locator('.review-annotation .definition').count(),0);
      await panel.getByRole('button',{name:'显示释义',exact:true}).click();
      assert.equal(await panel.locator('.review-annotation .definition').innerText(),savedMeaning);
      assert.ok((await panel.locator('#review-body').innerText()).includes('targets'));assert.ok(sentence.includes('targets'));
      await panel.screenshot({path:join(output,'bbc-vocab-review.png'),fullPage:true});
      await panel.getByRole('button',{name:'退出复习',exact:true}).click();
      const actual=await control.evaluate(async()=>{const tab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];return {info:await chrome.tabs.sendMessage(tab.id,{type:'blc-chat-source'}),material:(await chrome.tabs.sendMessage(tab.id,{type:'blc-chat-material'})).material};});
      assert.ok(actual.material?.blocks.length);
      const block=actual.material.blocks.find(b=>b.text.includes('targets'))??actual.material.blocks[0];
      await control.evaluate(async({actual,block})=>{
        const source=actual.info.source;
        const chat={id:'bbc-existing-answer',title:'BBC existing answer fixture',sourceKey:source.sourceKey,source,activeSnapshotVersion:1,draft:'',pendingQuote:null,updatedAt:2,snapshots:[{source,version:1,createdAt:1,label:actual.material.label,blocks:actual.material.blocks}],messages:[{id:'bbc-q',role:'user',turnId:'bbc-t',text:'What does targets mean here?',snapshotVersion:1,at:1},{id:'bbc-answer',role:'assistant',turnId:'bbc-t',text:`Existing answer fixture [${block.id}]`,state:'done',at:2}]};
        await new Promise((done,reject)=>{const r=indexedDB.open('blc-learning');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('conversations','readwrite');tx.objectStore('conversations').put(chat);tx.oncomplete=()=>{db.close();done();};tx.onabort=()=>reject(tx.error);};});
      },{actual,block});
      await send({type:'chatSelect',chatId:'bbc-existing-answer'});await panel.locator('#views [data-view="chat"]').click();
      await panel.locator('.knowledge-save > button').click();await panel.locator('.knowledge-editor button[type="submit"]').click();
      await panel.getByText('已保存在本机，待写入学习库',{exact:true}).waitFor();
      await send({type:'chatDelete',chatId:'bbc-existing-answer'});
      await panel.locator('#views [data-view="subs"]').click();await panel.locator('.article-tools [data-category="knowledge"]').click();
      // Knowledge keeps its own language scope; the vocabulary language is restored only for vocabulary.
      await panel.locator('.article-tools select').selectOption('all');
      await panel.locator('.knowledge-row summary').click();assert.equal(await panel.locator('.knowledge-row blockquote').innerText(),`[${block.id}] ${block.text}`);
      await panel.screenshot({path:join(output,'bbc-independent-knowledge.png'),fullPage:true});
      await panel.getByRole('button',{name:'复习本篇',exact:true}).click();await panel.getByRole('button',{name:'显示答案',exact:true}).click();
      await panel.locator('#review-body .knowledge-body').waitFor();
      const requests=await worker.evaluate(()=>bbcRequests);assert.ok(!requests.some(url=>/deepseek|openai|anthropic/.test(url)));
      await writeFile(join(output,'bbc-live.json'),JSON.stringify({...evidence,sentence,knowledgeQuote:block,steps:['real selection and save','source list','native text location','source vocabulary review','save pre-existing answer fixture bound to actual material','delete original chat','independent citation and review'],answer:'Pre-existing controlled answer; no new AI request',requests},null,2));
      console.log('PASS actual BBC content: select/save → source list → locate → vocabulary review; pre-existing controlled answer → independent knowledge → original chat deletion → citation/review, no AI request');
    } catch(error) {if(pageLoaded)throw error;const evidence={url,status:'blocked',error:String(error)};await writeFile(join(output,'bbc-live.json'),JSON.stringify(evidence,null,2));console.log('BBC LIVE BLOCKED',JSON.stringify(evidence));}
  }
} catch(error) {
  const panel=context.pages().find(p=>p.url().includes('/sidepanel.html'));
  if(panel){console.error('CURRENT CONTENT UI FAILURE',await panel.locator('body').innerText());await panel.screenshot({path:join(output,'failure.png'),fullPage:true});}
  throw error;
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
