// Production MV3 routing/storage with controlled Google and AI responses, isolated profile.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';

const temporaryRoot=resolve(tmpdir()), profile=await mkdtemp(join(temporaryRoot,'pd-translation-reliability-'));
const extension=resolve(process.env.PEAK_DISTANCE_UI_EXTENSION || '.output/chrome-mv3');
let context;
try {
  context=await chromium.launchPersistentContext(profile,{
    executablePath:process.env.BLC_CHROME || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
  });
  const worker=context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{
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
    await chrome.storage.local.set({deepseekApiKey:'offline-test-only',regularTranslation:'google-gtx'});
  });
  const page=await context.newPage();await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
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
} finally {
  await context?.close();
  if(dirname(profile)!==temporaryRoot || !basename(profile).startsWith('pd-translation-reliability-'))throw Error('Unexpected cleanup path');
  await rm(profile,{recursive:true,force:true});
}
