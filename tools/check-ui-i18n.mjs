import { extensionPath as extension } from './extension-path.mjs';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';

// Uses an isolated profile and fake AI responses.
const manifest = path.join(extension, 'manifest.json');
try {
  await access(manifest);
} catch (error) {
  if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  console.error(`Extension manifest not found at ${manifest}. Run npm run build or set PEAK_DISTANCE_UI_EXTENSION to a built extension directory.`);
  process.exit(1);
}
const profile=await mkdtemp(path.join(os.tmpdir(),'peak-distance-ui-'));
const output=process.env.PEAK_DISTANCE_UI_OUTPUT;
if(output)await mkdir(output,{recursive:true});
const context=await chromium.launchPersistentContext(profile,{...(process.env.BLC_CHROME?{executablePath:process.env.BLC_CHROME}:{channel:'chromium'}),headless:true,viewport:{width:1100,height:850},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
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
  const search=panel.getByRole('searchbox');
  assert.equal(await search.getAttribute('placeholder'),null);
  await panel.locator('.library-tabs [data-view="knowledge"]').click();
  assert.equal(await search.getAttribute('placeholder'),null);
  await panel.locator('.library-tabs [data-view="sentences"]').click();
  assert.equal(await search.getAttribute('placeholder'),null);
  assert.equal(await panel.locator('#language-filter').isVisible(),false);
  const sentenceRows=panel.locator('#sentences-list .entry');
  const seedSentences=await options.evaluate(async()=>{
    const video={videoId:'search-fixture',trackId:'en',trackKind:'manual',trackLang:'en',startMs:0};
    return Promise.all([
      chrome.runtime.sendMessage({type:'saveSentence',sentence:{video,title:'Search fixture',text:'The northern lights.',zh:'北极光。',endMs:1500}}),
      chrome.runtime.sendMessage({type:'saveSentence',sentence:{video:{...video,startMs:2000},title:'Search fixture',text:'A clear night.',endMs:3500}}),
    ]);
  });
  assert.ok(seedSentences.every(result=>result.ok));
  await panel.waitForFunction(()=>document.querySelectorAll('#sentences-list .entry').length===2);
  await panel.setViewportSize({width:320,height:790});
  assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
  if(output)await panel.screenshot({path:path.join(output,'sentence-search.png')});
  await panel.setViewportSize({width:1100,height:850});
  for(const query of ['  NORTHERN  ','极光']) {
    await search.fill(query);
    await sentenceRows.filter({hasText:'A clear night.'}).waitFor({state:'hidden'});
    assert.equal(await sentenceRows.locator('.sentence').innerText(),'The northern lights.');
    await search.fill('');
    await sentenceRows.filter({hasText:'A clear night.'}).waitFor();
  }
  await search.fill('not-a-match');
  await options.locator('#displayLanguage').selectOption('en');
  await panel.getByRole('searchbox',{name:'Search sentences'}).waitFor();
  await panel.getByText('No matching sentences.',{exact:true}).waitFor();
  await panel.locator('#sentences-list [data-i18n="清除搜索"]').click();
  assert.equal(await search.inputValue(),'');
  await panel.waitForFunction(()=>document.querySelectorAll('#sentences-list .entry').length===2);
  await options.locator('#displayLanguage').selectOption('zh-Hans');
  await panel.waitForFunction(()=>document.documentElement.lang==='zh-Hans');
  await panel.locator('.library-tabs [data-view="list"]').click();
  await panel.locator('.entry-expand').click();
  await panel.getByRole('button',{name:'添加笔记',exact:true}).click();
  await options.locator('#ai-settings > summary').click();
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

  await options.locator('details').filter({has:options.locator('#cacheLimit')}).locator('summary').click();
  await options.locator('#cacheLimit').fill('501');
  await options.locator('#cacheLimit').dispatchEvent('change');
  await options.waitForFunction(()=>document.querySelector('#cacheLimit')?.closest('.settings-field').querySelector('.settings-field-state')?.classList.contains('err'));
  assert.notEqual((await options.evaluate(()=>chrome.storage.local.get('cacheLimit'))).cacheLimit,501);
  await options.evaluate(()=>{globalThis.originalStorageSet=chrome.storage.local.set;chrome.storage.local.set=async()=>{throw new Error('test-save-failure');};});
  await options.locator('#cacheLimit').fill('100');
  await options.locator('#cacheLimit').dispatchEvent('change');
  await options.waitForFunction(()=>document.querySelector('#cacheLimit')?.closest('.settings-field').querySelector('.settings-field-state')?.textContent.includes('Réessayez'));
  assert.equal(await options.locator('#cacheLimit').inputValue(),'100');
  await options.evaluate(()=>{chrome.storage.local.set=globalThis.originalStorageSet;});
  await options.locator('#ai-settings > summary').click();
  await options.locator('#key').fill('local-test-key');
  await options.locator('#save').click();
  await options.waitForFunction(async()=>!!(await chrome.storage.local.get('aiServices')).aiServices?.profiles?.deepseek?.apiKey);
  await options.locator('#ai-current').filter({hasText:'deepseek-flash'}).waitFor();
  assert.equal(await options.locator('#state').isVisible(),false);
  await options.locator('#ai-advanced summary').click();
  await options.locator('#ai-model').fill('changed-model');
  assert.equal(await options.locator('#state').getAttribute('data-i18n'),'尚未保存');
  await options.locator('#ai-model').fill('deepseek-flash');
  assert.equal(await options.locator('#state').isVisible(),false);
  await panel.locator('[data-view="chat"]').click();
  assert.equal(await panel.locator('#chat-actions').isVisible(),false);
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
  assert.equal(await panel.locator('#chat-head [data-i18n-aria-label="新对话"]').getAttribute('aria-label'),newChatLabels.de);
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
  assert.equal(await web.locator('#blc-lookup-pill #lookup').getAttribute('aria-label'),'Look up');
  await options.locator('#appearanceTheme').selectOption('classic');
  await web.locator('#blc-lookup-pill[data-pd-theme=classic]').waitFor();
  assert.equal(await web.evaluate(()=>getSelection().toString()),'Learning');
  assert.equal(await web.locator('html').getAttribute('data-pd-theme'),null);
  await options.locator('#displayLanguage').selectOption('de');
  await web.waitForFunction(()=>document.querySelector('#blc-lookup-pill')?.shadowRoot?.querySelector('#lookup')?.getAttribute('aria-label')==='Nachschlagen');
  await web.locator('#blc-lookup-pill #lookup').click();
  await web.locator('#blc-lookup-popup .save.is-saved').waitFor();
  assert.equal(await web.locator('#blc-lookup-popup .save.is-saved').getAttribute('aria-label'), 'Gespeichert');
  await options.locator('#displayLanguage').selectOption('fr');
  await web.waitForFunction(()=>document.querySelector('#blc-lookup-popup')?.shadowRoot?.querySelector('.save.is-saved')?.getAttribute('aria-label')==='Enregistré');
  assert.equal(await web.locator('#blc-lookup-popup .ctx').innerText(),'Learning makes reading easier.');
  assert.equal(await web.locator('html').getAttribute('lang'),'en');
  await web.locator('#blc-lookup-popup[data-pd-theme=classic]').waitFor();
  await options.locator('#appearanceTheme').selectOption('minimal');
  await web.locator('#blc-lookup-popup[data-pd-theme=minimal]').waitFor();
  if(output)await web.screenshot({path:path.join(output,'web-lookup-fr.png')});
  await context.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Video practice</title><style>body{margin:0;padding:32px;background:#fff;font:14px system-ui}#movie_player{position:relative;width:960px;height:540px;margin:auto;background:#181818}video{width:100%;height:100%}.ytp-chrome-bottom{position:absolute;left:12px;right:12px;bottom:16px;height:48px;display:flex;justify-content:flex-end}.ytp-right-controls{display:flex;height:100%}button{font:inherit;color:#fff}</style></head><body><div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video><div class="ytp-chrome-bottom"><div class="ytp-right-controls"></div><button class="ytp-subtitles-button" aria-pressed="true"></button></div></div></body></html>'}));
  const video=await context.newPage();await video.goto('https://www.youtube.com/watch?v=abcdefghijk');
  await video.locator('#blc-subs-switch #learning').waitFor();
  assert.equal(await video.locator('#blc-subs-switch #learning').getAttribute('aria-label'),'Désactiver les sous-titres bilingues');
  await video.locator('#blc-subs-switch #learning').click();
  await options.locator('#displayLanguage').selectOption('en');
  await video.waitForFunction(()=>document.querySelector('#blc-subs-switch')?.shadowRoot?.querySelector('#learning')?.getAttribute('aria-label')==='Turn on bilingual subtitles');
  assert.equal(await video.locator('#blc-subs-switch #learning').getAttribute('aria-pressed'),'false');
  assert.equal(await video.locator('#blc-subs-switch #menu').count(),0);
  await video.locator('#blc-subs-switch #learning').click();
  await video.waitForFunction(()=>document.querySelector('#blc-subs-switch').shadowRoot.querySelector('#learning').getAttribute('aria-pressed')==='true');
  if(output)await video.screenshot({path:path.join(output,'video-controls-en.png')});
  for(const locale of ['de','fr']) {
    await options.locator('#displayLanguage').selectOption(locale);
    await video.waitForFunction(locale=>document.querySelector('#blc-subs-switch')?.lang===locale,locale);
    assert.ok(await video.evaluate(()=>{const controls=document.querySelector('#blc-subs-switch');return controls.getBoundingClientRect().right<=innerWidth;}),`${locale}: video controls overflow`);
    if(output)await video.screenshot({path:path.join(output,`video-controls-${locale}.png`)});
  }
  await options.locator('#displayLanguage').selectOption('auto');
  await panel.waitForFunction(()=>document.querySelector('#displayLanguage')?.value==='auto');
  if(output){
    await panel.screenshot({path:path.join(output,'sidebar.png')});
    await panel.locator('#open-settings').click();await panel.setViewportSize({width:390,height:844});
    await panel.locator('#ai-settings > summary').click();
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
  await options.locator('#displayLanguage').selectOption('en');
  await worker.evaluate(()=>chrome.storage.local.set({panelMode:'floating',translationMode:'regular'}));
  await video.bringToFront();
  assert.equal((await options.evaluate(async()=>{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    return chrome.tabs.sendMessage(tab.id,{type:'pd-panel-show'},{frameId:0});
  })).ok,true);
  const videoPanel=video.frameLocator('#pd-floating-panel iframe');
  await videoPanel.locator('body:not([inert])').waitFor();
  await videoPanel.locator('#views [data-view="subs"]').click();
  await videoPanel.locator('#open-settings').click();
  await videoPanel.locator('#video-settings:not([hidden])').waitFor();
  assert.equal(await videoPanel.locator('#video-track').isDisabled(),true);
  await videoPanel.locator('#video-mode').selectOption('ai');
  await videoPanel.locator('#video-mode:not([disabled])').waitFor();
  const videoTabId=await videoPanel.locator('body').evaluate(async()=> (await chrome.runtime.sendMessage({type:'panelContext'})).tabId);
  const modeState=await options.evaluate(tabId=>chrome.tabs.sendMessage(tabId,{type:'pd-video-settings-get'}),videoTabId);
  assert.equal(modeState.mode,'ai');
  assert.equal((await options.evaluate(()=>chrome.storage.local.get('translationMode'))).translationMode,'regular');
  await videoPanel.locator('#video-mode').selectOption('regular');
  await videoPanel.locator('#video-mode:not([disabled])').waitFor();
  // Keyboard activation also reaches the player while the floating settings remain open.
  await video.locator('#blc-subs-switch #learning').focus();
  await video.locator('#blc-subs-switch #learning').press('Enter');
  await videoPanel.locator('#bilingualEnabled:not(:checked)').waitFor();
  await videoPanel.locator('#bilingualEnabled').check();
  await video.waitForFunction(()=>document.querySelector('#blc-subs-switch').shadowRoot.querySelector('#learning').getAttribute('aria-pressed')==='true');
  const authorizationTabPromise=context.waitForEvent('page');
  await videoPanel.locator('#vault-connect').click();
  const authorizationTab=await authorizationTabPromise;await authorizationTab.waitForLoadState();
  assert.equal(new URL(authorizationTab.url()).pathname,'/options.html');
  assert.equal(new URL(authorizationTab.url()).searchParams.get('vault'),'connect');
  await authorizationTab.locator('#vault-connect').waitFor();await authorizationTab.close();
  console.log('PASS redesigned video settings keep per-video mode separate, synchronize the toggle, and route embedded folder access to the settings tab');
  assert.deepEqual(errors,[]);
  console.log('UI checks passed: five locales, live updates, preserved inputs, saved rules, reload, save failure, AI request language, webpage lookup and video controls.');
} finally {
  await context.close();await rm(profile,{recursive:true});
}
