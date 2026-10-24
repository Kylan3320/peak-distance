// Real installed Chrome/Edge + built extension. Only article HTML is controlled; translation uses real models.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
const root=resolve('.upstream/native-translation-probe'), require=createRequire(import.meta.url);
const src=await readFile(join(dirname(require.resolve('playwright-core/package.json')),'lib/coreBundle.js'),'utf8');
const list=src.match(/disabledFeatures = \[([\s\S]*?)\]\.filter\(Boolean\)/)?.[1];
assert.ok(list,'Playwright feature defaults must be identifiable');
const features=[...list.matchAll(/^\s*"([^"]+)"/gm)].map(m=>m[1]);
const results=[];
const only=process.argv.find(a=>a.startsWith('--browser='))?.split('=')[1];
for(const [name,executablePath] of Object.entries({chrome:'C:/Program Files/Google/Chrome/Application/chrome.exe',edge:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'})){
 if(only&&name!==only)continue;
 let context;
 const result={browser:name,checks:[]};results.push(result);
 try {
  context=await chromium.launchPersistentContext(join(root,name+(name==='chrome'?'-integration-profile':'-profile')),{executablePath,headless:false,chromiumSandbox:true,
   ignoreDefaultArgs:['--disable-extensions','--disable-component-update','--disable-background-networking','--disable-field-trial-config','--disable-features='+features.join(',')],
   args:['--enable-unsafe-extension-debugging','--disable-features='+features.filter(x=>!['Translate','OptimizationHints'].includes(x)).join(',')]});
  result.version=context.browser().version();
  const cdp=await context.browser().newBrowserCDPSession();
  const previous=await cdp.send('Extensions.loadUnpacked',{path:resolve('.output/chrome-mv3')});
  const oldWorkers=new Set(context.serviceWorkers());
  await cdp.send('Extensions.uninstall',{id:previous.id});
  const {id}=await cdp.send('Extensions.loadUnpacked',{path:resolve('.output/chrome-mv3')});
  const base='chrome-extension://'+id, control=await context.newPage();await control.goto(base+'/options.html');
  context.setDefaultTimeout(10000);
  const worker=context.serviceWorkers().find(w=>w.url().startsWith(base)&&!oldWorkers.has(w))??await context.waitForEvent('serviceworker',w=>w.url().startsWith(base)&&!oldWorkers.has(w));
  await worker.evaluate(async()=>{await chrome.storage.local.remove('regularTranslation');await chrome.storage.local.set({displayLanguage:'zh-Hans'});globalThis.externalCalls=0;const original=fetch;globalThis.fetch=(input,...args)=>{const url=String(input);if(/translate.googleapis.com|api.deepseek.com/.test(url)){externalCalls++;throw Error('Native route must not send cloud translation');}return original(input,...args);};});
  const send=m=>control.evaluate(m=>chrome.runtime.sendMessage(m),m);
  assert.equal((await send({type:'getSettings'})).settings.regularTranslation,'browser-native');result.checks.push('built-in translation is the default');const prep=await context.newPage();await prep.goto(base+'/native-translator.html?source=en&target=zh-Hans');
  const consoleErrors=[];prep.on('console',m=>{if(m.type()==='warning'||m.type()==='error')consoleErrors.push(m.text());});
  await prep.locator('#prepare').click();
  await prep.waitForFunction(()=>!document.querySelector('#prepare').disabled,null,{timeout:90000});
  result.preparation=await prep.locator('#state').innerText();result.console=consoleErrors;await prep.screenshot({path:join(root,name+'-preparation.png')});await prep.close();
  const runId=Date.now().toString(36);const longText='Verification '+runId+'\n'+Array.from({length:40},(_,i)=>`Sentence ${i+1}: Keep the original sentence and its source for later language review.`).join('\n');
  const request=(requestId,text)=>({type:'translateSelection',requestId,text,snapshot:{text,url:'https://example.com/native',title:'Native translation'},sourceLang:'en',targetLang:'zh-Hans',fresh:true});
  const first=await send(request('native-first','The next translation should work after the panel closes.\n\nKeep the original source.'));
  result.first=first;
  await control.evaluate(m=>{window.pending=chrome.runtime.sendMessage(m);},request('native-cancel',longText));
  await send({type:'cancelOnline',requestId:'native-cancel'});
  const cancelled=await control.evaluate(()=>window.pending);
  assert.equal(cancelled.ok,false);assert.equal(cancelled.error,'aborted');result.checks.push('cancel returns aborted');
  await context.route('https://example.com/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><meta charset="utf-8"><title>Reading</title><body><button id="outside">Page action</button><p id="source" style="white-space:pre-wrap">A new sentence should remain readable after reopening the translation card.</p></body></html>'}));
  const page=await context.newPage();await page.goto('https://example.com/native');await page.locator('html[data-blc-web="1"]').waitFor();
  async function open(text){await page.evaluate(text=>{const p=document.getElementById('source');p.textContent=text;const r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));},text);await page.locator('#blc-lookup-pill #translate').click();await page.locator('#pd-translation .card').waitFor();}
  if(first.ok){
   assert.equal(first.source,'browser-native');assert.match(first.text,/[\u3400-\u9fff]/u);assert.ok(first.text.includes('\n\n'));result.checks.push('real translation preserves paragraphs');
   await open(longText);assert.equal(await page.locator('#pd-translation #copy').isDisabled(),true);await page.locator('#pd-translation #close').click();assert.equal(await page.locator('#pd-translation').count(),0);
   const reopened='A new sentence should remain readable after reopening the translation card.';
   await open(reopened);await page.locator('#pd-translation #copy:not([disabled])').waitFor();assert.equal(await page.locator('#pd-translation #original').innerText(),reopened);assert.match(await page.locator('#pd-translation #result').innerText(),/[\u3400-\u9fff]/u);assert.equal(await page.locator('#pd-translation #result').evaluate(n=>getComputedStyle(n).fontSize),'14px');
   await page.locator('#pd-translation .card').screenshot({path:join(root,name+'-reopened.png')});result.checks.push('close in-flight card and reopen with new text');await page.locator('#pd-translation #close').click();
   // Actual model takes multiple line translations; save while its result is still pending, then close.
   const savedText=longText+'\nA saved translation keeps running after closing the card.';await open(savedText);
   await page.locator('#pd-translation #save').click();await page.locator('#pd-translation #view:not([hidden])').waitFor();
   result.savedWhilePending=await page.locator('#pd-translation #copy').isDisabled();assert.equal(result.savedWhilePending,true);
   await page.locator('#pd-translation #close').click();
   const deadline=Date.now()+30000;
   let saved;
   while(!saved?.origin.translation){
    saved=(await send({type:'listKnowledge'})).records.find(k=>k.origin.text===savedText);
    assert.ok(Date.now()<deadline,'Saved native translation did not complete');
    if(!saved?.origin.translation)await new Promise(done=>setTimeout(done,25));
   }
   assert.equal(saved.origin.service,'browser-native');result.checks.push('saved in-flight task completes after closing card');
   const cues=await send({type:'translateCues',mode:'regular',requestId:'native-cues',videoId:'native',trackId:'en',sourceLang:'en',targetLang:'zh-Hans',items:[{id:7,text:'Read the original sentence.'},{id:19,text:'Save its source for later.'}]});
   assert.equal(cues.ok,true);assert.deepEqual(cues.translations.map(t=>t.id),[7,19]);result.checks.push('subtitle IDs preserved');
   await page.close();await worker.evaluate(()=>chrome.offscreen.closeDocument());
   await context.setOffline(true);const after=await send(request('native-recreated','A reopened translation service should translate this new sentence '+runId+'.'));await context.setOffline(false);
   assert.equal(after.ok,true);result.checks.push('closing page and recreating hidden host offline');
  }else{
   assert.equal(first.source,'browser-native');assert.ok(['native-unavailable','native-needs-setup'].includes(first.error));
   await open('The original text must remain visible when native translation is unavailable.');await page.locator('#pd-translation #retry-inline:visible').waitFor();assert.ok(await page.locator('#pd-translation #original').innerText());
   await page.locator('#pd-translation #close').click();await open('A reopened card should report the current failure clearly.');await page.locator('#pd-translation #retry-inline:visible').waitFor();await page.locator('#pd-translation .card').screenshot({path:join(root,name+'-unavailable.png')});result.checks.push('native failure preserves original; close and reopen recover UI');
  }
  assert.equal(await worker.evaluate(()=>externalCalls),0);result.checks.push('no silent Google or AI fallback');result.ok=first.ok;
 }catch(error){result.ok=false;result.error=String(error);}
 finally{await context?.close();await mkdir(root,{recursive:true});await writeFile(join(root,'integration-results.json'),JSON.stringify(results,null,2));await writeFile(join(root,'integration-'+name+'-'+Date.now()+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
}
if(results.some(r=>!r.ok))process.exitCode=1;
