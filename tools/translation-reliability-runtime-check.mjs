// Production MV3 routing/storage with controlled Google and AI responses, isolated profile.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';

const temporaryRoot=resolve(tmpdir()), profile=await mkdtemp(join(temporaryRoot,'pd-translation-reliability-'));
const extension=resolve(process.env.PEAK_DISTANCE_UI_EXTENSION || '.output/chrome-mv3');
let context;
const launch=()=>chromium.launchPersistentContext(profile,{
  executablePath:process.env.BLC_CHROME || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,
  args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
});
const mockNetwork=worker=>worker.evaluate(()=>{
  globalThis.googleRequests=0;globalThis.aiRequests=0;globalThis.aiContent='["", "", null]';
  globalThis.fetch=async input=>{
    const url=String(input);
    if(url.includes('translate.googleapis.com')){
      globalThis.googleRequests++;
      return new Response('',{status:429,headers:{'retry-after':'120'}});
    }
    if(url.includes('api.deepseek.com')){
      globalThis.aiRequests++;
      return Response.json({choices:[{message:{content:globalThis.aiContent},finish_reason:'stop'}]});
    }
    throw Error('Unexpected test request: '+new URL(url).hostname);
  };
});
try {
  context=await launch();
  let worker=context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await mockNetwork(worker);
  const ordinary={type:'translateSelection',text:'Ordinary query',
    snapshot:{text:'Ordinary query',url:'https://example.com',title:'Fixture'},sourceLang:'en',targetLang:'en'};
  const ordinaryKey=JSON.stringify(['translation','google-gtx','v2','en','en',ordinary.text]);
  const legacyKey=JSON.stringify(['translation',JSON.stringify(['deepseek','openai','https://api.deepseek.com','deepseek-chat']),'en|zh-Hans','Legacy AI subtitle']);
  await worker.evaluate(async ({legacyKey,ordinaryKey,text})=>{
    const now=Date.now();
    const timestamps={writtenAt:now,usedAt:now,expiresAt:now+60000};
    await chrome.storage.local.set({
      deepseekApiKey:'offline-test-only',regularTranslation:'google-gtx',
      'query-cache-v2':{
        [legacyKey]:{value:'Legacy AI result',...timestamps},
        [ordinaryKey]:{value:{ok:true,source:'google-gtx',text},...timestamps},
      },
    });
  },{legacyKey,ordinaryKey,text:ordinary.text});
  const optionsUrl=new URL('options.html',worker.url()).href;
  let page=await context.newPage();await page.goto(optionsUrl);
  const send=message=>page.evaluate(message=>chrome.runtime.sendMessage(message),message);
  const request={type:'translateCues',mode:'regular',requestId:'429-batch',videoId:'diagnostic',trackId:'en',sourceLang:'en',targetLang:'zh-Hans',
    items:Array.from({length:6},(_,id)=>({id:10+id,text:'A runtime request '+id}))};
  const result=await send(request);
  assert.equal(result.ok,false);assert.equal(result.httpStatus,429);
  assert.equal(await worker.evaluate(()=>globalThis.googleRequests),1);
  const selection=await send({type:'translateSelection',requestId:'other-entry',text:'Another request',
    snapshot:{text:'Another request',url:'https://example.com/diagnosis',title:'Diagnosis'},sourceLang:'auto',targetLang:'zh-Hans',fresh:true});
  assert.equal(selection.error,'restricted');assert.equal(selection.retryAt,result.retryAt);
  assert.equal(await worker.evaluate(()=>globalThis.googleRequests),1);
  console.log('PASS MV3 six-cue 429 batch makes one request and returns failure; a fresh selection shares cooldown');
  const aiRequest={...request,mode:'ai',requestId:'ai-empty',items:request.items.slice(0,3)};
  const empty=await send(aiRequest);assert.equal(empty.ok,false);assert.equal(empty.error,'bad-response');
  await worker.evaluate(()=>{globalThis.aiContent='["一", "", "三"]';});
  const partial=await send({...aiRequest,requestId:'ai-partial'});
  assert.equal(partial.ok,true);assert.deepEqual(partial.translations.map(t=>t.id),[10,12]);
  assert.equal(await worker.evaluate(()=>globalThis.aiRequests),2);
  assert.equal(await worker.evaluate(()=>globalThis.googleRequests),1);
  console.log('PASS MV3 AI all-empty result fails without poisoning the next batch; partial IDs survive and no AI fallback is triggered');

  const readLocal=()=>page.evaluate(async()=>(await chrome.storage.local.get('query-cache-v2'))['query-cache-v2']??{});
  const readSession=()=>page.evaluate(async()=>(await chrome.storage.session.get('online-cache-v1'))['online-cache-v1']??{});
  const waitForOrdinary=()=>page.waitForFunction(async key=>!!(await chrome.storage.local.get('query-cache-v2'))['query-cache-v2']?.[key],ordinaryKey);
  const single={...aiRequest,items:aiRequest.items.slice(0,1)};
  await page.waitForFunction(async()=>Object.keys((await chrome.storage.session.get('online-cache-v1'))['online-cache-v1']??{})
    .filter(key=>key.startsWith('["ai-subtitle-translation",')).length===2);
  const session=await readSession();
  assert.deepEqual(Object.keys(await readLocal()),[ordinaryKey]);
  assert.ok(Object.entries(session).filter(([key])=>key.startsWith('["ai-subtitle-translation",'))
    .every(([,record])=>record.expiresAt===undefined));

  const cdp=await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  assert.equal((await send({type:'getSettings'})).ok,true);
  worker=context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker',{timeout:5000});
  assert.equal(await worker.evaluate(()=>globalThis.aiRequests),undefined);
  await mockNetwork(worker);
  assert.deepEqual((await send({...single,requestId:'after-worker-restart'})).translations,[{id:10,text:'一'}]);
  assert.equal(await worker.evaluate(()=>globalThis.aiRequests),0);

  assert.equal((await send({type:'clearQueryCache'})).ok,true);
  assert.deepEqual(await readLocal(),{});
  assert.deepEqual(Object.keys(await readSession()).sort(),Object.keys(session).sort());
  assert.deepEqual((await send({...single,requestId:'after-clear'})).translations,[{id:10,text:'一'}]);
  assert.equal(await worker.evaluate(()=>globalThis.aiRequests),0);
  assert.equal((await send({...ordinary,requestId:'ordinary-before-browser-restart'})).ok,true);
  await waitForOrdinary();

  await context.close();
  context=await launch();
  worker=context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await mockNetwork(worker);
  page=await context.newPage();await page.goto(optionsUrl);
  assert.deepEqual(await readSession(),{});
  assert.deepEqual(Object.keys(await readLocal()),[ordinaryKey]);
  await worker.evaluate(()=>{globalThis.aiContent='["New browser session"]';});
  assert.deepEqual((await send({...single,requestId:'after-browser-restart'})).translations,[{id:10,text:'New browser session'}]);
  assert.equal(await worker.evaluate(()=>globalThis.aiRequests),1);
  console.log('PASS legacy AI subtitle entries are removed, worker restart and query clear preserve AI cache, browser restart clears it');
} finally {
  await context?.close();
  if(dirname(profile)!==temporaryRoot || !basename(profile).startsWith('pd-translation-reliability-'))throw Error('Unexpected cleanup path');
  await rm(profile,{recursive:true,force:true});
}
