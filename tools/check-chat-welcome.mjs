// Built extension: loading, retry, empty conversation and live appearance.
import { extensionPath as extension } from './extension-path.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const profile = await mkdtemp(join(tmpdir(), 'pd-appearance-'));
const output = resolve('.upstream/ui-refresh');
await mkdir(output,{recursive:true});
const context = await chromium.launchPersistentContext(profile,{
  executablePath: process.env.BLC_CHROME || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless:true,
  args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
});
context.setDefaultTimeout(10000);
const errors=[];
context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
try {
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  const base=`chrome-extension://${new URL(worker.url()).host}`;
  const settings=await context.newPage();
  await settings.goto(`${base}/options.html`);
  await settings.evaluate(()=>chrome.storage.local.set({displayLanguage:'en'}));

  const panel=await context.newPage();
  await panel.addInitScript(()=>{
    const send=chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage=(message,...args)=>{
      if(message?.type==='chatActive'&&!window.chatReleased) {
        const callback=args.find(arg=>typeof arg==='function');
        const held=window.heldChatCallbacks??=[];
        held.push(callback);
        window.releaseChat=()=>{
          window.chatReleased=true;
          held.splice(0).forEach(callback=>callback({ok:false,error:'io'}));
        };
        return;
      }
      return send(message,...args);
    };
  });
  await panel.goto(`${base}/sidepanel.html#chat`);
  await panel.locator('#chat-list [data-i18n="正在读取对话…"]').waitFor();
  await panel.waitForFunction(()=>!!window.releaseChat);
  await panel.evaluate(()=>window.releaseChat());
  await panel.getByRole('button',{name:'Retry',exact:true}).click();
  await panel.waitForFunction(()=>!document.querySelector('#chat-list').children.length);
  await panel.getByRole('heading',{name:'New chat',exact:true}).waitFor();
  assert.equal(await panel.locator('#chat-count').isVisible(),false);
  assert.equal(await panel.locator('.chat-welcome,.brand-row').count(),0);
  assert.equal(await panel.locator('#views button > svg').count(),3);
  assert.equal(await settings.locator('#appearanceTheme').inputValue(),'minimal');

  for(const width of [320,400,600]){
    await panel.setViewportSize({width,height:850});
    assert.ok(await panel.evaluate(()=>{
      const rect=document.querySelector('#chat-input-row').getBoundingClientRect();
      return rect.left>=0&&rect.right<=innerWidth&&innerHeight-rect.bottom<=20;
    }),`Composer at ${width}px`);
    assert.equal(await panel.locator('.app-rail').evaluate(el=>el.offsetWidth),width<560?48:52);
    await panel.screenshot({path:join(output,`chat-${width}.png`)});
  }
  await panel.setViewportSize({width:400,height:850});
  const zoom=scale=>panel.evaluate(async scale=>chrome.tabs.setZoom((await chrome.tabs.getCurrent()).id,scale),scale);
  const unzoomed=await panel.evaluate(()=>devicePixelRatio);
  await zoom(1.25);
  await panel.waitForFunction(previous=>devicePixelRatio>previous,unzoomed);
  assert.ok(await panel.locator('#view-chat').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await zoom(1);
  await panel.locator('#chat-input').fill('Unsaved question across a theme switch.');
  await settings.locator('#ai-settings > summary').click();
  await settings.locator('#key').fill('unsaved-test-key');
  await settings.locator('#ai-advanced > summary').click();
  await settings.locator('#ai-url').fill('https://a-very-long-custom-ai-endpoint-for-the-layout.example/v1');
  await settings.locator('#appearanceTheme').selectOption('classic');
  await panel.waitForFunction(()=>document.documentElement.dataset.pdTheme==='classic');
  assert.equal(await panel.locator('#chat-input').inputValue(),'Unsaved question across a theme switch.');
  assert.equal(await settings.locator('#key').inputValue(),'unsaved-test-key');
  assert.equal(await settings.locator('#ai-advanced').evaluate(el=>el.open),true);
  assert.match(await panel.locator('body').evaluate(el=>getComputedStyle(el).backgroundImage),/paper-tile/);
  await settings.locator('#displayLanguage').selectOption('de');
  await settings.setViewportSize({width:320,height:850});
  assert.ok(await settings.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await settings.screenshot({path:join(output,'settings-classic-de-320.png'),fullPage:true});

  const prep=await context.newPage();
  await prep.goto(`${base}/native-translator.html`);
  await prep.waitForFunction(()=>document.documentElement.dataset.pdTheme==='classic');
  await prep.setViewportSize({width:320,height:700});
  assert.ok(await prep.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await settings.reload();
  await settings.waitForFunction(()=>document.querySelector('#appearanceTheme').value==='classic');
  await settings.locator('#appearanceTheme').selectOption('minimal');
  await prep.waitForFunction(()=>document.documentElement.dataset.pdTheme==='minimal');
  await panel.waitForFunction(()=>document.documentElement.dataset.pdTheme==='minimal');
  assert.equal(await panel.locator('body').evaluate(el=>getComputedStyle(el).backgroundImage),'none');

  await settings.evaluate(()=>{
    const write=chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set=async changes=>{
      if('appearanceTheme' in changes)throw Error('Test appearance write failure');
      return write(changes);
    };
  });
  await settings.locator('#appearanceTheme').selectOption('classic');
  await settings.locator('#appearanceTheme + .settings-field-state.err').waitFor();
  assert.equal(await settings.locator('#appearanceTheme').inputValue(),'minimal');
  assert.equal(await panel.locator('html').getAttribute('data-pd-theme'),'minimal');
  await panel.locator('#views button').first().press('Tab');
  await panel.locator('span[popover]:popover-open').waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS chat loading, failed read/retry, empty composer at 320/400/600, keyboard hint, live appearance/drafts, persistence and failed theme save');
} finally {
  await context.close();
  await rm(profile,{recursive:true,force:true});
}
