// Exercise the real lookup component with a legacy entry and controlled dictionary response.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const code = (await build({stdin:{contents:"export {createLookupPopup} from './shared/lookupPopup';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'LookupTest',plugins:[{
  name:'inline-css',setup(b){b.onResolve({filter:/\.css\?inline$/},a=>({path:resolve(a.resolveDir,a.path.replace('?inline','')),namespace:'inline-css'}));b.onLoad({filter:/.*/,namespace:'inline-css'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}
}]})).outputFiles[0].text;
const browser = await chromium.launch({executablePath:process.env.BLC_CHROME||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try {
  const page=await browser.newPage({viewport:{width:800,height:800}});
  await page.setContent('<!doctype html><html lang="zh-CN"><body></body></html>');
  await page.evaluate(()=>{window.browser={runtime:{getURL:()=>'',onMessage:{addListener(){}},sendMessage:async()=>({ok:true,settings:{appearanceTheme:'minimal'}})}};});
  await page.addScriptTag({content:code});
  await page.evaluate(()=>{
    window.statusWrites=[];
    window.lookupCalls=0;
    window.lookupEntry={key:'en::pragmatic',status:'learning',contexts:[{id:1,url:'https://example.com',sentence:'Uh they’re so they’re quite pragmatic'}]};
    const lookup=LookupTest.createLookupPopup({send:async m=>{
      if(m.type==='getEntry')return {ok:true,entry:window.lookupEntry};
      if(m.type==='lookup')return {ok:true,result:{kind:'dictionary',entry:{source:'youdao',expression:'pragmatic',headword:'pragmatic',phonetic:'præɡˈmætɪk',url:'https://example.com',senses:[{partOfSpeech:'adj.',definition:'讲求实际的，务实的',example:'Robin took a pragmatic look at her situation.',exampleTranslation:'罗宾从务实的角度看待她的状况。'},{definition:'实际的'}]}}};
      if(m.type==='setStatus'){window.statusWrites.push(m.status);window.lookupEntry.status=m.status;}
      if(m.type==='save'){
        window.lookupCalls++;
        await new Promise(resolve=>setTimeout(resolve,80));
        if(window.failSave)return {ok:false,error:'io'};
        const id=window.lookupEntry.contexts.length+1;
        window.lookupEntry.contexts.push({id,url:m.snapshot.url,sentence:m.snapshot.sentence});
        window.lookupEntry.status=m.status??'saved';
        return {ok:true,key:'en::pragmatic',contextId:id,status:window.lookupEntry.status,appended:true};
      }
      return {ok:true};
    }});
    window.lookup=lookup;
    lookup.open({snapshot:{source:'web',expression:'pragmatic',sentence:"Uh they’re so they’re quite pragmatic",url:'https://example.com',title:'Example',lang:'en'},subLine:'YouTube · 28:00 · en',onContinueAsk:()=>{}});
  });
  const card=page.locator('#blc-lookup-popup .card');
  const status=card.locator('.learning-status');
  await status.waitFor();
  await card.locator('.example').waitFor();
  assert.ok(await status.evaluate(el=>el.closest('.actions').querySelector('button')===el));
  assert.equal(await card.locator('.save-complete').count(),0);
  assert.equal(await status.getAttribute('aria-label'),'pragmatic · 已收藏');
  assert.deepEqual(await card.locator('.ui-action-menu button').evaluateAll(buttons=>buttons.map(button=>button.value)),['saved','known']);
  for(const width of [800,320]) {
    await page.setViewportSize({width,height:800});
    const geometry=await card.evaluate(el=>{const row=el.querySelector('.actions').getBoundingClientRect(),close=el.querySelector('.close').getBoundingClientRect();return {rightGap:row.right-close.right,overflow:el.scrollWidth>el.clientWidth};});
    assert.ok(Math.abs(geometry.rightGap)<1 && !geometry.overflow,JSON.stringify(geometry));
    if(width===800) await card.screenshot({path:join(tmpdir(),'pd-lookup-status.png')});
  }
  await status.click();await card.locator('button[value=known]').click();
  await page.waitForFunction(()=>window.statusWrites.includes('known'));
  await card.getByRole('button',{name:'pragmatic · 已掌握',exact:true}).waitFor();
  await status.click();await card.locator('button[value=saved]').click();
  await page.waitForFunction(()=>window.statusWrites.includes('saved'));
  await card.locator('.close').click();
  await page.locator('#blc-lookup-popup').waitFor({state:'detached'});

  const open=sentence=>page.evaluate(sentence=>window.lookup.open({snapshot:{source:'web',expression:'pragmatic',sentence,url:'https://example.com',title:'Example',lang:'en'},onContinueAsk:()=>{}}),sentence);
  await open('A new pragmatic approach.');
  await card.locator('.example').waitFor();
  assert.equal(await card.locator('.learning-status').count(),0);
  const save=card.locator('.save');
  const before=await save.boundingBox();
  await page.evaluate(()=>{window.failSave=true;});
  await save.click();
  await card.locator('.feedback.err').waitFor();
  assert.equal(await save.isEnabled(),true);
  assert.equal(await card.locator('.learning-status').count(),0);
  await page.evaluate(()=>{
    window.failSave=false;window.bookmarkAnimations=[];
    document.getElementById('blc-lookup-popup').shadowRoot.addEventListener('animationstart',event=>window.bookmarkAnimations.push(event.animationName));
  });
  await save.evaluate(el=>{el.click();el.click();});
  await status.waitFor();
  await page.waitForFunction(()=>window.bookmarkAnimations.includes('pd-bookmark-saved'));
  const after=await status.boundingBox();
  assert.ok(Math.abs(before.x-after.x)<1&&Math.abs(before.y-after.y)<1,'Saved bookmark stays in the first slot');
  assert.equal(await card.locator('.save').count(),1);
  assert.ok(await status.evaluate(el=>el.closest('.actions').querySelector('button')===el));
  assert.equal(await page.evaluate(()=>window.lookupCalls),2);
  await page.waitForFunction(()=>!document.getElementById('blc-lookup-popup').shadowRoot.querySelector('.save-complete'));
  await page.evaluate(()=>window.lookup.close());
  await open('A new pragmatic approach.');
  await status.waitFor();
  assert.equal(await card.locator('.act.save').count(),0);
  assert.equal(await card.locator('.save-complete').count(),0);
  const output=resolve('.upstream/lookup-bookmark');await mkdir(output,{recursive:true});
  await card.screenshot({path:join(output,'saved.png')});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>window.lookup.close());
  await open('Another pragmatic approach.');
  await card.locator('.act.save').click();await status.waitFor();
  assert.equal(await status.locator('svg').evaluate(el=>getComputedStyle(el).animationName),'none');
  console.log('PASS first-slot bookmark, saved/known transitions, failed save/retry, duplicate click, new-context save, reopen without replay, reduced motion and narrow layout');
} finally {await browser.close();}
