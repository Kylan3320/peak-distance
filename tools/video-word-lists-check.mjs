// Exercise video word lists in isolation with real component rendering and interactions.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const code=(await build({stdin:{contents:"export {createYoutubeWorkspace} from './shared/youtubeWorkspace'; export {setDisplayLanguage} from './shared/i18n';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'VideoWordsTest',plugins:[{
  name:'inline-css',setup(b){b.onResolve({filter:/\.css\?inline$/},a=>({path:resolve(a.resolveDir,a.path.replace('?inline','')),namespace:'inline-css'}));b.onLoad({filter:/.*/,namespace:'inline-css'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}
}]})).outputFiles[0].text;
const browser=await chromium.launch({executablePath:process.env.BLC_CHROME||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try {
  const page=await browser.newPage({viewport:{width:520,height:780}});
  await page.setContent('<div id="mount" style="width:100%;height:740px"></div>');
  await page.evaluate(()=>{window.browser={runtime:{getURL:()=>'',onMessage:{addListener(){}},sendMessage:async()=>({ok:true,settings:{appearanceTheme:'minimal'}})}};});
  await page.addScriptTag({content:code});
  await page.evaluate(()=>{
    window.calls=[];
    const video={videoId:'fixture',trackId:'en',trackKind:'manual',trackLang:'en',startMs:28000};
    const cues=[{start:28000,dur:2000,lastOff:30000,text:'A pragmatic approach is pragmatic.'},{start:42000,dur:2000,lastOff:44000,text:'A second pragmatic example.'},{start:60000,dur:2000,lastOff:62000,text:'Extraordinarilylongunbrokenterm appears here.'}].map((cue,i)=>({...cue,from:i*60,to:i*60+cue.text.length}));
    const entries=[{key:'en::pragmatic',expression:'pragmatic',status:'saved',contexts:[{video,sentence:cues[0].text,url:'https://example.com'}]},{key:'en::long',expression:'Extraordinarilylongunbrokenterm',status:'known',contexts:[{video:{...video,startMs:60000},sentence:cues[2].text,url:'https://example.com'}]}];
    const actions={bindWords:()=>()=>{},words:(el,text)=>{el.textContent=text;},seek:({index})=>calls.push(['seek',index]),lookup:(word,{index})=>calls.push(['lookup',word,index]),save:async()=>({ok:true}),remove:async()=>({ok:true}),ask:()=>{},open:view=>calls.push(['open',view]),status:(key,value)=>calls.push(['status',key,value])};
    window.workspace=VideoWordsTest.createYoutubeWorkspace(actions,document.getElementById('mount'));
    workspace.update({generation:'fixture',videoId:'fixture',videoRef:video,cues,current:0,translations:new Map(),statuses:new Map([['pragmatic','saved']]),sentences:[],entries,notice:'',chinese:true,trackLang:'en'});
  });
  const panel=page.locator('#blc-learning-panel');
  await panel.locator('[data-tab="words"]').click();
  const word=panel.locator('.word-heading').filter({has:page.locator('[data-word="pragmatic"]')});
  assert.equal(await word.locator('.word-count').innerText(),'3 次');
  const row=word.locator('..');
  assert.equal(await word.locator('button').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
  await row.locator('summary').click();
  assert.equal(await row.locator('.occurrence').count(),2);
  await row.locator('.meta button[data-playback]').last().click();
  await row.locator('.occurrence').last().click();
  assert.deepEqual(await page.evaluate(()=>window.calls.slice(-2)),[['seek',1],['lookup','pragmatic',1]]);
  await word.locator('button').click();
  assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),['lookup','pragmatic',0]);
  await row.locator('summary').click();
  await panel.screenshot({path:join(tmpdir(),'pd-video-words.png')});
  await panel.locator('[data-tab="saved"]').click();
  const saved=panel.locator('.saved-heading').first();
  const status=saved.locator('.learning-status');
  assert.equal(await status.getAttribute('aria-label'),'pragmatic · 已收藏');
  assert.equal(await status.evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
  await status.click();
  await saved.locator('button[value="known"]').click();
  assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),['status','en::pragmatic','known']);
  await saved.locator('.word-action').click();
  assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),['lookup','pragmatic',0]);
  await saved.locator('..').locator('.saved-time').click();
  assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),['seek',0]);
  await panel.screenshot({path:join(tmpdir(),'pd-video-saved.png')});
  await page.evaluate(()=>VideoWordsTest.setDisplayLanguage('de','de'));
  await page.setViewportSize({width:260,height:780});
  for(const tab of ['saved','words']) {
    await panel.locator(`[data-tab="${tab}"]`).click();
    assert.equal(await panel.locator('.body').evaluate(el=>el.scrollWidth<=el.clientWidth),true,`${tab} overflows`);
  }
  assert.equal(await panel.locator('.word-heading').filter({has:page.locator('[data-word="pragmatic"]')}).locator('.word-count').innerText(),'3 Treffer');
  console.log('PASS video word and saved lists: lookup, occurrences, seeking, status, localization and narrow layout');
} finally {await browser.close();}
