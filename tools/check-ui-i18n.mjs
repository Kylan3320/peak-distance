import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';

// Run while WXT's development server is running. Uses an isolated profile and fake AI responses.
const extension=path.resolve(process.env.PEAK_DISTANCE_UI_EXTENSION || '.output/chrome-mv3-dev');
const profile=await mkdtemp(path.join(os.tmpdir(),'peak-distance-ui-'));
const output=process.env.PEAK_DISTANCE_UI_OUTPUT;
if(output)await mkdir(output,{recursive:true});
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1100,height:850},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const errors=[];
context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
try {
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  await worker.evaluate(()=>{
    globalThis.aiRequests=[];
    globalThis.fetch=async(url,options)=>{
      if(!String(url).startsWith('https://api.deepseek.com/'))throw new Error(`Unexpected test request: ${url}`);
      const body=JSON.parse(options.body);globalThis.aiRequests.push(body);
      return new Response('data: '+JSON.stringify({choices:[{delta:{content:'Test answer'},finish_reason:null}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
    };
  });
  const options=await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForFunction(()=>document.querySelector('#ai-url')?.value==='https://api.deepseek.com');
  assert.equal(await options.locator('#ai-current').isVisible(),false);
  assert.equal(await options.locator('#state').getAttribute('data-i18n'),'未配置');
  assert.equal(await options.locator('#state').getAttribute('class'),'settings-status');
  const saved=await options.evaluate(()=>chrome.runtime.sendMessage({type:'save',snapshot:{source:'web',lang:'en',expression:'learning',sentence:'Learning makes reading easier.',url:'https://example.com/learn',title:'Reading practice'},result:{kind:'translation',source:'google-gtx',text:'学习'}}));
  assert.equal(saved.ok,true);
  const panel=await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html#list`);
  await panel.waitForFunction(()=>!document.body.inert);
  await panel.locator('.note-box summary').click();
  await panel.locator('.note-box textarea').fill('保留解释 {literal} — my unsaved note');
  await options.locator('#key').fill('local-test-key');
  await options.locator('#ai-advanced summary').click();
  await options.locator('#ai-model').fill('local-test-model');
  assert.equal(await options.locator('#state').getAttribute('data-i18n'),'尚未保存');
  const headings={'zh-Hans':'语言设置','zh-Hant':'語言設定',en:'Languages',de:'Sprachen',fr:'Langues'};
  const aiLanguages={'zh-Hans':'Simplified Chinese','zh-Hant':'Traditional Chinese',en:'English',de:'German',fr:'French'};
  const newChatLabels={'zh-Hans':'新建对话','zh-Hant':'新增對話',en:'New chat',de:'Neuer Chat',fr:'Nouveau chat'};
  for(const locale of Object.keys(headings)) {
    await options.locator('#displayLanguage').selectOption(locale);
    await options.waitForFunction(locale=>document.documentElement.lang===locale,locale);
    await panel.waitForFunction(locale=>document.documentElement.lang===locale,locale);
    assert.equal(await options.locator('.settings-section h2').first().innerText(),headings[locale]);
    assert.equal(await panel.locator('.note-box textarea').inputValue(),'保留解释 {literal} — my unsaved note');
    assert.equal(await options.locator('#key').inputValue(),'local-test-key');
    assert.equal(await options.locator('#ai-model').inputValue(),'local-test-model');
    assert.equal(await options.locator('#defaultComprehensionLang').inputValue(),'zh-Hans');
    if(output)await options.screenshot({path:path.join(output,`settings-${locale}.png`),fullPage:true});
  }
  await options.locator('.settings-details').first().locator('summary').click();
  assert.equal(await options.locator('#override-source').inputValue(),'');
  assert.equal(await options.locator('#override-add').isDisabled(),true);
  await options.locator('#override-source').selectOption('zh');
  assert.equal(await options.locator('#override-target').inputValue(),'');
  assert.equal(await options.locator('#override-add').isDisabled(),true);
  await options.locator('#override-source').selectOption('ja');
  await options.locator('#override-target').selectOption('en');
  await options.locator('#override-add').click();
  await options.waitForFunction(async()=>((await chrome.storage.local.get('comprehensionOverrides')).comprehensionOverrides??{}).ja==='en');
  await options.reload();
  await options.waitForFunction(()=>document.querySelector('#displayLanguage')?.value==='fr');
  assert.equal((await options.evaluate(()=>chrome.storage.local.get('comprehensionOverrides'))).comprehensionOverrides.ja,'en');

  await options.locator('details.settings-section summary').click();
  await options.locator('#cacheLimit').fill('501');
  await options.locator('#cacheLimit').dispatchEvent('change');
  await options.waitForFunction(()=>document.querySelector('#online-state')?.classList.contains('err'));
  assert.notEqual((await options.evaluate(()=>chrome.storage.local.get('cacheLimit'))).cacheLimit,501);
  await options.evaluate(()=>{globalThis.originalStorageSet=chrome.storage.local.set;chrome.storage.local.set=async()=>{throw new Error('test-save-failure');};});
  await options.locator('#cacheLimit').fill('100');
  await options.locator('#cacheLimit').dispatchEvent('change');
  await options.waitForFunction(()=>document.querySelector('#online-state')?.textContent.includes('Réessayez'));
  assert.equal(await options.locator('#cacheLimit').inputValue(),'100');
  await options.evaluate(()=>{chrome.storage.local.set=globalThis.originalStorageSet;});
  await options.locator('#key').fill('local-test-key');
  await options.locator('#save').click();
  await options.waitForFunction(async()=>!!(await chrome.storage.local.get('aiServices')).aiServices?.profiles?.deepseek?.apiKey);
  await options.waitForFunction(()=>document.querySelector('#state')?.getAttribute('data-i18n')==='已保存并启用');
  assert.equal(await options.locator('#ai-current').isVisible(),true);
  await options.locator('#ai-advanced summary').click();
  await options.locator('#ai-model').fill('changed-model');
  assert.equal(await options.locator('#state').getAttribute('data-i18n'),'尚未保存');
  await options.locator('#ai-model').fill('deepseek-flash');
  assert.equal(await options.locator('#state').getAttribute('data-i18n'),'已配置');
  await panel.locator('[data-view="chat"]').click();
  assert.ok((await panel.locator('#chat-head .native-delete-main').boundingBox()).width>60);
  for(const [index,locale] of Object.keys(headings).entries()) {
    await options.locator('#displayLanguage').selectOption(locale);
    await panel.waitForFunction(locale=>document.documentElement.lang===locale,locale);
    await panel.locator('#chat-input').fill(`Question in ${locale}`);
    await panel.locator('#chat-send').click();
    await panel.waitForFunction(count=>document.querySelectorAll('.state.done').length===count,index+1);
    const requests=await worker.evaluate(()=>globalThis.aiRequests);
    assert.ok(requests.at(-1).messages[0].content.startsWith(`Answer in ${aiLanguages[locale]}.`));
  }
  await panel.locator('#chat-input').fill('未发送的问题 {literal}');
  await options.locator('#displayLanguage').selectOption('de');
  await panel.waitForFunction(()=>document.documentElement.lang==='de');
  assert.equal(await panel.locator('#chat-input').inputValue(),'未发送的问题 {literal}');
  assert.equal(await panel.locator('#chat-head .chat-tool').first().innerText(),newChatLabels.de);
  assert.equal((await worker.evaluate(()=>globalThis.aiRequests)).length,5);
  await options.locator('#displayLanguage').selectOption('auto');
  const browserLanguage=await options.evaluate(()=>chrome.i18n.getUILanguage());
  await panel.waitForFunction(()=>document.querySelector('#displayLanguage')?.value==='auto');
  assert.equal((await options.evaluate(()=>chrome.storage.local.get('displayLanguage'))).displayLanguage,'auto');
  assert.ok(browserLanguage);
  if(output)await panel.screenshot({path:path.join(output,'sidebar.png')});
  await options.locator('#displayLanguage').selectOption('en');
  await context.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Reading practice</title></head><body><article><p id="selection">Learning makes reading easier.</p></article></body></html>'}));
  const web=await context.newPage();await web.goto('https://example.com/learn');
  await web.waitForSelector('html[data-blc-web="1"]');
  await web.evaluate(()=>{const node=document.createTreeWalker(document.querySelector('#selection'),NodeFilter.SHOW_TEXT).nextNode(),range=document.createRange();range.setStart(node,0);range.setEnd(node,8);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await web.locator('#blc-lookup-pill #lookup').waitFor();
  assert.equal(await web.locator('#blc-lookup-pill #lookup').innerText(),'Look up');
  await options.locator('#displayLanguage').selectOption('de');
  await web.waitForFunction(()=>document.querySelector('#blc-lookup-pill')?.shadowRoot?.querySelector('#lookup')?.textContent==='Nachschlagen');
  await web.locator('#blc-lookup-pill #lookup').click();
  await web.locator('#blc-lookup-popup .act.save').waitFor();
  assert.equal(await web.locator('#blc-lookup-popup .act.save').innerText(),'Speichern');
  await options.locator('#displayLanguage').selectOption('fr');
  await web.waitForFunction(()=>document.querySelector('#blc-lookup-popup')?.shadowRoot?.querySelector('.act.save')?.textContent==='Enregistrer');
  assert.equal(await web.locator('#blc-lookup-popup .ctx').innerText(),'Learning makes reading easier.');
  assert.equal(await web.locator('html').getAttribute('lang'),'en');
  if(output)await web.screenshot({path:path.join(output,'web-lookup-fr.png')});
  await context.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Video practice</title><style>body{margin:0;padding:32px;background:#fff;font:14px system-ui}#movie_player{position:relative;width:960px;height:540px;margin:auto;background:#181818}video{width:100%;height:100%}.ytp-chrome-bottom{position:absolute;left:12px;right:12px;bottom:16px;height:48px;display:flex;justify-content:flex-end}.ytp-right-controls{display:flex;height:100%}button{font:inherit;color:#fff}</style></head><body><div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video><div class="ytp-chrome-bottom"><div class="ytp-right-controls"></div><button class="ytp-subtitles-button" aria-pressed="true"></button></div></div></body></html>'}));
  const video=await context.newPage();await video.goto('https://www.youtube.com/watch?v=abcdefghijk');
  await video.locator('#blc-subs-switch #learning').waitFor();
  assert.equal(await video.locator('#blc-subs-switch #learning').innerText(),'Sous-titres');
  await video.locator('#blc-subs-switch #learning').click();
  await options.locator('#displayLanguage').selectOption('en');
  await video.waitForFunction(()=>document.querySelector('#blc-subs-switch')?.shadowRoot?.querySelector('#learning')?.textContent==='Subtitles');
  assert.equal(await video.locator('#blc-subs-switch label').filter({has:video.locator('#chinese')}).innerText(),'Show translation');
  assert.equal(await video.locator('#blc-subs-switch label').filter({has:video.locator('#ap')}).innerText(),'Pause after each line');
  assert.equal(await video.locator('#blc-subs-switch #translation-mode option[value="ai"]').innerText(),'AI translation');
  if(output)await video.screenshot({path:path.join(output,'video-controls-en.png')});
  for(const locale of ['de','fr']) {
    await options.locator('#displayLanguage').selectOption(locale);
    await video.waitForFunction(locale=>document.querySelector('#blc-subs-switch')?.lang===locale,locale);
    assert.ok(await video.evaluate(()=>{const menu=document.querySelector('#blc-subs-switch').shadowRoot.querySelector('#menu');return menu.scrollWidth<=menu.clientWidth;}),`${locale}: video menu overflow`);
    if(output)await video.screenshot({path:path.join(output,`video-controls-${locale}.png`)});
  }
  await options.locator('#displayLanguage').selectOption('auto');
  await panel.waitForFunction(()=>document.querySelector('#displayLanguage')?.value==='auto');
  if(output){
    await panel.screenshot({path:path.join(output,'sidebar.png')});
    await panel.locator('#open-settings').click();await panel.setViewportSize({width:390,height:844});
    for(const locale of ['zh-Hans','en','de','fr']){
      await options.locator('#displayLanguage').selectOption(locale);
      await panel.waitForFunction(locale=>document.documentElement.lang===locale,locale);
      assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),`${locale}: narrow panel overflow`);
      await panel.screenshot({path:path.join(output,`sidebar-settings-${locale}-390.png`),fullPage:true});
      await panel.locator('#ai-provider').scrollIntoViewIfNeeded();
      await panel.screenshot({path:path.join(output,`sidebar-ai-${locale}-390.png`)});
      await panel.locator('#displayLanguage').scrollIntoViewIfNeeded();
    }
  }
  assert.deepEqual(errors,[]);
  console.log('UI checks passed: five locales, live updates, preserved inputs, saved rules, reload, save failure, AI request language, webpage lookup and video controls.');
} finally {
  await context.close();await rm(profile,{recursive:true});
}
