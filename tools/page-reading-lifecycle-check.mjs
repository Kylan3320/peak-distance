import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { extensionPath } from './extension-path.mjs';

// Exercise the packaged content script. Hold individual translation replies so
// the site can recycle its DOM and the background can disconnect mid-reading.
const browser = await chromium.launch({
  ...(process.env.BLC_CHROME ? {executablePath:process.env.BLC_CHROME} : {channel:'chrome'}),
});
try {
  const page = await browser.newPage();
  await page.route('https://article.test/**', route => route.fulfill({
    contentType:'text/html',body:'<html lang="en"><main><p id="story">Original paragraph.</p></main></html>',
  }));
  await page.goto('https://article.test/read');
  await page.evaluate(() => {
    const listeners = [];
    const settings = {displayLanguage:'en',pageTranslationEngine:'native',pageTranslationStyle:'translated',
      defaultComprehensionLang:'zh-Hans',markingEnabled:false};
    window.broadcast = type => listeners.forEach(listener => listener({type},{},()=>{}));
    window.requests = [];
    window.browser = {i18n:{getUILanguage:()=>'en'},runtime:{
      id:'reading-test', getURL:path => location.origin + '/' + path,
      onMessage:{addListener:listener => listeners.push(listener)},
      async sendMessage(m) { return m.type === 'getSettings' ? {ok:true,settings} : {ok:true,items:[]}; },
      connect() {
        let receive, close;
        const port = {
          onMessage:{addListener:fn => { receive = fn; }},
          onDisconnect:{addListener:fn => { close = fn; }},
          disconnect:()=>close?.(),
          postMessage(m) {
            window.requests.push({text:m.text,answer:text=>receive({id:m.id,ok:true,text})});
          },
        };
        window.backgroundSleep = port.disconnect;
        return port;
      },
    }};
  });
  await page.addScriptTag({content:await readFile(join(extensionPath,'content-scripts/web.js'),'utf8')});
  await page.waitForSelector('html[data-blc-web]');
  // Windows virtual keyboards can send a trusted logical key with no physical code.
  const input = await page.context().newCDPSession(page);
  await input.send('Input.dispatchKeyEvent', {type:'keyDown',key:'s',modifiers:1});
  await input.send('Input.dispatchKeyEvent', {type:'keyUp',key:'s',modifiers:1});
  await page.waitForFunction(()=>window.requests.length === 1);
  await page.evaluate(()=>{
    document.querySelector('#story').textContent = 'Updated paragraph.';
    window.requests[0].answer('过时的译文。');
  });
  await page.waitForFunction(()=>window.requests.length === 2);
  assert.doesNotMatch(await page.locator('#story').innerText(),/过时/);
  await page.evaluate(()=>window.requests[1].answer('更新后的段落。'));
  await page.waitForSelector('pd-page-translation');
  await page.evaluate(()=>{
    window.backgroundSleep();
    const story = document.querySelector('#story');
    const group = document.createElement('span');
    group.append(...story.childNodes);
    story.append(group);
    const next = document.createElement('p');
    next.textContent = 'Another paragraph.';
    story.after(next);
  });
  await page.waitForFunction(()=>window.requests.length === 3);
  assert.equal((await page.locator('#story').innerText()).trim(),'更新后的段落。');
  await page.evaluate(()=>{
    window.broadcast('page-translation-toggle');
    window.requests[2].answer('延迟的译文。');
  });
  assert.equal((await page.locator('#story').innerText()).trim(),'Updated paragraph.');
  assert.equal(await page.locator('pd-page-translation,[data-pd-original]').count(),0);
  console.log('Verified source replacement, background reconnect, reparented originals and late replies after toggle-off.');
} finally { await browser.close(); }
