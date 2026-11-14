// Real built player + current word-card source; isolated Chrome/Edge profiles.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {build} from 'esbuild';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {extensionPath} from './extension-path.mjs';
const code=(await build({stdin:{contents:"export {createLookupPopup} from './shared/lookupPopup'; export {setDisplayLanguage} from './shared/i18n';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'LookupTest',plugins:[{name:'inline-css',setup(b){b.onResolve({filter:/\.css\?inline$/},a=>({path:resolve(a.resolveDir,a.path.replace('?inline','')),namespace:'inline-css'}));b.onLoad({filter:/.*/,namespace:'inline-css'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}}]})).outputFiles[0].text;
const wav=Buffer.alloc(44+8000*2*5);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(const [name,executablePath] of Object.entries({chrome:'C:/Program Files/Google/Chrome/Application/chrome.exe',edge:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'})){
 const profile=await mkdtemp(join(tmpdir(),'pd-audio-check-'));let context;
 try{
  context=await chromium.launchPersistentContext(profile,{executablePath,headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging'],proxy:process.argv.includes('--live')?{server:'http://127.0.0.1:7890'}:undefined});
  context.setDefaultTimeout(12000);
  const cdp=await context.browser().newBrowserCDPSession();const {id}=await cdp.send('Extensions.loadUnpacked',{path:extensionPath});const base='chrome-extension://'+id;
  const worker=context.serviceWorkers().find(w=>w.url().startsWith(base))||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>chrome.storage.local.set({displayLanguage:'zh-Hans'}));
  const settingsPage=await context.newPage();await settingsPage.goto(base+'/options.html');const defaults=await settingsPage.evaluate(()=>chrome.runtime.sendMessage({type:'getSettings'}));assert.equal(defaults.settings.primaryDictionary,'cambridge');assert.equal(defaults.settings.backupDictionary,'youdao');await settingsPage.close();
  let failed=false,requests=0;
  await context.route('https://dictionary.cambridge.org/media/test*.mp3',r=>{requests++;return r.fulfill({status:failed?503:200,contentType:'audio/wav',body:failed?Buffer.from('unavailable'):wav});});
  await context.route('https://example.com/audio-check',r=>r.fulfill({headers:{'content-type':'text/html','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; media-src 'self' https://cdn.sanity.io https://assets.claude.com"},body:'<!doctype html><html lang="en"><p>Say it explicitly.</p></html>'}));
  const page=await context.newPage();await page.goto('https://example.com/audio-check');
  await page.evaluate(base=>{window.browser={runtime:{id:'test',getURL:p=>base+p,onMessage:{addListener(){}},sendMessage:async()=>({ok:true,settings:{appearanceTheme:'classic'}})}}},base);
  await page.addScriptTag({content:code});
  await page.evaluate(()=>{window.lookup=LookupTest.createLookupPopup({send:async m=>{
   if(m.type==='getEntry')return new Promise(r=>window.finishEntry=()=>r({ok:true,entry:{key:'en::explicitly',contexts:[]},vaultId:null}));
   if(m.type==='lookup')return {ok:true,result:{kind:'dictionary',entry:{source:'cambridge',expression:m.snapshot.expression,headword:m.snapshot.expression,url:'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/explicitly',audioUrl:'https://dictionary.cambridge.org/media/'+(m.source==='youdao'?'test2':'test')+'.mp3',senses:[{definition:'明确地'}]}}};
   if(m.type==='save')return {ok:true,contextId:1};
   if(m.type==='explainContext')return {ok:false,error:'no-key'};
   return {ok:true};
  }});window.openWord=(word,anchor)=>lookup.open({anchor,snapshot:{source:'web',expression:word,sentence:'Say it explicitly.',url:location.href,title:'Audio check',lang:'en'}});openWord('explicitly');});
  async function disposes(frame,action){const done=page.waitForEvent('framedetached',{predicate:f=>f===frame,timeout:12000});await action();await done;assert.equal(frame.isDetached(),true);}
  async function fitsPlayer(frame){const height=await frame.evaluate(()=>Math.ceil(document.body.getBoundingClientRect().height));await page.waitForFunction(height=>document.getElementById('blc-lookup-popup').shadowRoot.querySelector('iframe').getBoundingClientRect().height===height,height);return height;}
  const card=page.locator('#blc-lookup-popup .card');const iframe=card.locator('.lookup-media iframe');
  await iframe.waitFor();let frame=await (await iframe.elementHandle()).contentFrame();await frame.waitForLoadState('load');await frame.locator('audio').waitFor();
  assert.equal(await fitsPlayer(frame),54);await page.setViewportSize({width:420,height:850});await fitsPlayer(frame);await card.screenshot({path:join(tmpdir(),'pd-audio-'+name+'-compact.png')});
  await frame.locator('audio').press('Space');await frame.waitForFunction(()=>!document.querySelector('audio').paused).catch(async e=>{console.log('PLAY FAILURE',await frame.locator('audio').evaluate(a=>({src:a.src,paused:a.paused,error:a.error?.message,time:a.currentTime,ready:a.readyState})),requests);await page.screenshot({path:join(tmpdir(),'pd-audio-fail.png')});throw e;});
  const token=await frame.evaluate(()=>window.token=crypto.randomUUID());
  await page.evaluate(()=>finishEntry());await card.locator('.save').click();await card.locator('.save.is-saved').waitFor();
  await card.getByRole('button',{name:'解释原句',exact:true}).click();await card.locator('[data-i18n="打开设置填写 API key"]').waitFor();
  assert.equal(await frame.evaluate(()=>window.token),token);assert.equal(await frame.locator('audio').evaluate(a=>a.paused),false);
  console.log('PASS',name,'strict CSP playback, late entry/save/AI preserve the playing document');
  await page.evaluate(()=>window.postMessage({type:'pd-audio-close'},'*'));assert.equal(await iframe.count(),1);const originalHeight=await iframe.evaluate(f=>f.offsetHeight);await page.evaluate(()=>window.postMessage({type:'pd-audio-size',height:999},'*'));assert.equal(await iframe.evaluate(f=>f.offsetHeight),originalHeight);
  await frame.locator('audio').focus();await disposes(frame,()=>page.keyboard.press('Escape'));await card.waitFor({state:'detached'});
  console.log('PASS',name,'focused Escape closes; untrusted close message ignored');
  await page.evaluate(()=>openWord('explicitly'));await iframe.waitFor();frame=await (await iframe.elementHandle()).contentFrame();await frame.waitForLoadState('load');await frame.locator('audio').waitFor();
  await disposes(frame,()=>card.locator('select').selectOption('youdao'));await page.waitForFunction(()=>document.getElementById('blc-lookup-popup').shadowRoot.querySelector('iframe').dataset.audioUrl.includes('test2'));assert.equal(frame.isDetached(),true);
  frame=await (await iframe.elementHandle()).contentFrame();await frame.waitForLoadState('load');await frame.locator('audio').waitFor();await disposes(frame,()=>page.evaluate(()=>{const anchor=document.createElement('button');anchor.textContent='clearly';anchor.style.cssText='position:fixed;bottom:4px;left:16px';document.body.append(anchor);openWord('clearly',anchor);}));
  await iframe.waitFor();frame=await (await iframe.elementHandle()).contentFrame();await frame.waitForLoadState('load');await frame.locator('audio').waitFor();failed=true;
  await frame.locator('audio').press('Space');await frame.locator('#failure').waitFor({state:'visible'});assert.ok(await fitsPlayer(frame)>54);const errorToken=await frame.evaluate(()=>window.errorToken=crypto.randomUUID());await page.setViewportSize({width:320,height:850});
  for(const language of ['fr','de','en','zh-Hant','zh-Hans']){await frame.evaluate(value=>chrome.runtime.sendMessage({type:'setSetting',name:'displayLanguage',value}),language);await frame.getByRole('button',{name:{fr:'Réessayer',de:'Erneut versuchen',en:'Retry','zh-Hant':'重試','zh-Hans':'重试'}[language],exact:true}).waitFor();await page.evaluate(language=>LookupTest.setDisplayLanguage(language,language),language);await fitsPlayer(frame);assert.ok(await frame.evaluate(()=>document.body.scrollWidth<=document.documentElement.clientWidth));await page.waitForFunction(()=>{const r=document.getElementById('blc-lookup-popup').shadowRoot.querySelector('.card').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}).catch(async e=>{console.log('POSITION',await card.evaluate(el=>({rect:el.getBoundingClientRect().toJSON(),style:el.getAttribute('style'),viewport:innerHeight,anchors:[...document.querySelectorAll('button')].map(a=>a.getBoundingClientRect().toJSON())})));throw e;});if(language==='fr')await frame.locator('button').focus();if(language==='fr')await card.screenshot({path:join(tmpdir(),'pd-audio-'+name+'-error.png')});}
  assert.equal(await frame.evaluate(()=>window.errorToken),errorToken);const before=requests;await page.waitForTimeout(150);assert.equal(requests,before);
  failed=false;await frame.getByRole('button',{name:'重试',exact:true}).click();await frame.waitForFunction(()=>!document.querySelector('audio').paused);assert.equal(await frame.locator('#failure').isHidden(),true);assert.equal(await fitsPlayer(frame),54);
  await disposes(frame,()=>card.locator('.close').click());
  console.log('PASS',name,'source/word/close dispose player; error waits for manual retry; normal/error/retry fit actual content at 320/420px in five languages');
  const invalid=await context.newPage();let invalidRequests=0;await context.route('https://untrusted.example/**',r=>{invalidRequests++;return r.abort()});await invalid.goto(base+'/dictionary-audio.html?src='+encodeURIComponent('https://untrusted.example/media/test.mp3'));await invalid.locator('#failure').waitFor({state:'visible'});assert.equal(invalidRequests,0);await invalid.close();
  if(process.argv.includes('--live')){
   await page.goto('https://www.anthropic.com/research/components-of-agent-memory',{waitUntil:'domcontentloaded'});
   // Exercise the installed extension's real selection/lookup path after page hydration.
   await page.locator('html[data-blc-web]').waitFor();
   await page.evaluate(()=>{const p=document.createElement('p');p.id='audio-live-sentence';p.textContent='Fable 5 used memory explicitly.';document.body.prepend(p);const r=document.createRange();r.setStart(p.firstChild,20);r.setEnd(p.firstChild,30);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'))});
   await page.getByRole('button',{name:'查词',exact:true}).click();await iframe.waitFor({timeout:25000});frame=await (await iframe.elementHandle()).contentFrame();await frame.waitForLoadState('load');await frame.locator('audio').waitFor();await frame.locator('audio').press('Space');await frame.waitForFunction(()=>document.querySelector('audio').readyState>=2);console.log('PASS',name,'live Anthropic + Cambridge',await frame.locator('audio').evaluate(a=>({url:a.src,duration:a.duration,error:a.error?.message})));
  }
 }finally{if(context)await context.close();await rm(profile,{recursive:true,force:true,maxRetries:3});}
}
