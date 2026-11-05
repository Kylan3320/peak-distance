// Exercise the real lookup component with a legacy entry and controlled dictionary response.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
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
  await page.evaluate(()=>{window.browser={runtime:{getURL:()=>''}};});
  await page.addScriptTag({content:code});
  await page.evaluate(()=>{
    window.statusWrites=[];
    const lookup=LookupTest.createLookupPopup({send:async m=>{
      if(m.type==='getEntry')return {ok:true,entry:{key:'en::pragmatic',status:'learning',contexts:[]}};
      if(m.type==='lookup')return {ok:true,result:{kind:'dictionary',entry:{source:'youdao',expression:'pragmatic',headword:'pragmatic',phonetic:'præɡˈmætɪk',url:'https://example.com',senses:[{partOfSpeech:'adj.',definition:'讲求实际的，务实的',example:'Robin took a pragmatic look at her situation.',exampleTranslation:'罗宾从务实的角度看待她的状况。'},{definition:'实际的'}]}}};
      if(m.type==='setStatus')window.statusWrites.push(m.status);
      return {ok:true};
    }});
    lookup.open({snapshot:{source:'web',expression:'pragmatic',sentence:"Uh they’re so they’re quite pragmatic",url:'https://example.com',title:'Example',lang:'en'},subLine:'YouTube · 28:00 · en',onContinueAsk:()=>{}});
  });
  const card=page.locator('#blc-lookup-popup .card');
  await card.locator('.status').waitFor();
  await card.locator('.example').waitFor();
  assert.equal(await card.locator('.chip').innerText(),'已收藏');
  assert.deepEqual(await card.locator('.status option').evaluateAll(options=>options.map(option=>option.value)),['saved','known']);
  assert.equal(await card.locator('.status').inputValue(),'saved');
  for(const width of [800,320]) {
    await page.setViewportSize({width,height:800});
    const geometry=await card.evaluate(el=>{const row=el.querySelector('.actions').getBoundingClientRect(),close=el.querySelector('.close').getBoundingClientRect();return {rightGap:row.right-close.right,overflow:el.scrollWidth>el.clientWidth};});
    assert.ok(Math.abs(geometry.rightGap)<1 && !geometry.overflow,JSON.stringify(geometry));
    if(width===800) await card.screenshot({path:join(tmpdir(),'pd-lookup-status.png')});
  }
  await card.locator('.status').selectOption('known');
  await page.waitForFunction(()=>window.statusWrites.includes('known'));
  await card.locator('.chip.known').waitFor();
  await card.locator('.status').selectOption('saved');
  await page.waitForFunction(()=>window.statusWrites.includes('saved'));
  await card.locator('.close').click();
  await page.locator('#blc-lookup-popup').waitFor({state:'detached'});
  console.log('PASS legacy status, saved/known transitions, close alignment and 320px lookup layout');
} finally {await browser.close();}
