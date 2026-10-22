// Focused acceptance for library actions and the file-sharing / AI settings layout.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const profile=await mkdtemp(join(tmpdir(),'pd-settings-actions-'));
const extension=resolve('.output/chrome-mv3');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1100,height:850},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
context.setDefaultTimeout(8000);
const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
try {
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  const base=`chrome-extension://${new URL(worker.url()).host}`;
  const panel=await context.newPage();await panel.goto(`${base}/sidepanel.html#list`);await panel.waitForFunction(()=>!document.body.inert);
  async function checkHeader(page) {
    const buttons=page.locator('.brand-tools button');
    assert.equal(await buttons.count(),3);
    const boxes=[];for(const button of await buttons.all()){assert.equal(await button.innerText(),'');assert.equal(await button.locator('svg').count(),1);boxes.push(await button.boundingBox());}
    assert.ok(boxes.every(b=>b.width===34&&b.height===34&&Math.abs(b.y-boxes[0].y)<1));
  }
  const send=message=>panel.evaluate(message=>chrome.runtime.sendMessage(message),message);
  await panel.evaluate(()=>chrome.storage.local.set({displayLanguage:'zh-Hans',aiServices:{active:'deepseek',profiles:{deepseek:{protocol:'openai',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'fixture-key'}}}}));
  for(const expression of ['hilarious','deleteword'])assert.equal((await send({type:'save',snapshot:{source:'web',expression,sentence:`This is ${expression}.`,url:'https://example.com/reading',title:'Reading source',lang:'en'},definition:'很可笑的，很滑稽的'})).ok,true);
  await panel.reload();await panel.waitForFunction(()=>!document.body.inert);
  await checkHeader(panel);
  await panel.setViewportSize({width:360,height:780});await checkHeader(panel);assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await panel.setViewportSize({width:1100,height:850});
  const row=panel.locator('#list .entry[data-key="en::deleteword"]');await row.waitFor();
  assert.equal(await row.getByRole('button',{name:'更多操作',exact:true}).count(),0);
  assert.equal(await row.getByRole('button',{name:'删除',exact:true}).locator('svg').count(),1);
  panel.once('dialog',d=>d.dismiss());await row.getByRole('button',{name:'删除',exact:true}).click();
  assert.equal((await send({type:'getEntry',key:'en::deleteword'})).entry.expression,'deleteword');
  panel.once('dialog',d=>d.accept());await row.getByRole('button',{name:'删除',exact:true}).click();await row.waitFor({state:'hidden'});
  assert.equal((await send({type:'getEntry',key:'en::deleteword'})).entry,null);
  const review=panel.getByRole('button',{name:'原句复习',exact:true});
  assert.equal(await review.innerText(),'');assert.equal(await review.locator('svg').count(),1);
  await panel.screenshot({path:'/tmp/peak-distance-library-actions.png'});
  await review.click();await panel.locator('#review-body').getByRole('button',{name:'英语',exact:true}).click();await panel.locator('#view-review:not([hidden]) .review-card').waitFor();
  await panel.locator('#views [data-view="list"]').click();
  await panel.locator('.library-tabs [data-view="knowledge"]').click();assert.equal(await review.isVisible(),false);
  await panel.locator('#open-settings').click();await panel.locator('#ai-current').filter({hasText:'deepseek-flash'}).waitFor();
  assert.equal(await panel.locator('#state').isVisible(),false);
  assert.equal(await panel.locator('#clear').innerText(),'');assert.equal(await panel.locator('#key-help').isVisible(),false);
  assert.equal(await panel.locator('#vault-flush').isVisible(),false);assert.equal(await panel.locator('#vault-disconnect').isVisible(),false);
  // Control only status reads; directory permissions and synchronization are unchanged.
  const settings=await context.newPage();
  await settings.addInitScript(()=>{
    globalThis.vaultFixture={connected:true,pendingCount:17,lastCommitAt:Date.now(),lastError:null};
    globalThis.vaultListeners=[];
    const originalSend=chrome.runtime.sendMessage,originalListen=chrome.runtime.onMessage.addListener;
    chrome.runtime.sendMessage=function(...args){
      if(args[0]?.type==='vaultStatus'){const result={ok:true,status:vaultFixture};if(typeof args[1]==='function'){args[1](result);return;}return Promise.resolve(result);}
      return originalSend.apply(this,args);
    };
    chrome.runtime.onMessage.addListener=function(listener){vaultListeners.push(listener);return originalListen.call(this,listener);};
  });
  await settings.goto(`${base}/sidepanel.html#settings`);await settings.waitForFunction(()=>!document.body.inert);await settings.locator('#vault-pending').filter({hasText:'17'}).waitFor();
  assert.equal(await settings.locator('#vault-connect').getAttribute('aria-label'),'更换文件夹');
  assert.equal(await settings.locator('#vault-connect').innerText(),'');
  assert.equal(await settings.locator('#vault-state').isVisible(),false);
  await settings.locator('#vault-flush').waitFor();await settings.locator('#vault-disconnect').waitFor();
  assert.equal(await settings.locator('#save').innerText(),'');assert.equal(await settings.locator('#save').getAttribute('aria-label'),'保存启用');
  assert.equal(await settings.locator('#save').locator('svg').count(),1);
  await settings.locator('#key').fill('unsaved-test-key');await settings.locator('#state').filter({hasText:'尚未保存'}).waitFor();
  assert.equal((await settings.evaluate(()=>chrome.storage.local.get('aiServices'))).aiServices.profiles.deepseek.apiKey,'fixture-key');
  await settings.evaluate(()=>{globalThis.permissionAllowed=false;chrome.permissions.request=async()=>permissionAllowed;});
  await settings.locator('#save').click();await settings.locator('#state.err').waitFor();
  await settings.setViewportSize({width:360,height:780});await settings.locator('#state').scrollIntoViewIfNeeded();assert.ok(await settings.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await settings.screenshot({path:'/tmp/peak-distance-settings-save-error.png'});await settings.setViewportSize({width:1100,height:850});
  assert.equal(await settings.locator('#key').inputValue(),'unsaved-test-key');
  assert.equal((await settings.evaluate(()=>chrome.storage.local.get('aiServices'))).aiServices.profiles.deepseek.apiKey,'fixture-key');
  await settings.evaluate(()=>{permissionAllowed=true;});await settings.locator('#save').click();
  await settings.waitForFunction(async()=>(await chrome.storage.local.get('aiServices')).aiServices.profiles.deepseek.apiKey==='unsaved-test-key');
  await settings.locator('#state.ok').waitFor();
  await settings.locator('#key').fill('');await settings.locator('#key').dispatchEvent('input');await settings.locator('#state').waitFor({state:'hidden'});
  await settings.locator('#key').blur();await settings.locator('#vault-label').evaluate(n=>{const main=n.closest('main');main.scrollTop+=n.closest('section').getBoundingClientRect().top-main.getBoundingClientRect().top-16;});await settings.screenshot({path:'/tmp/peak-distance-settings-actions.png'});
  await settings.locator('.ai-section').screenshot({path:'/tmp/peak-distance-ai-form-wide.png'});
  await settings.evaluate(()=>{vaultFixture.lastError='no-permission';for(const listener of vaultListeners)listener({type:'vault-changed'}, {},()=>{});});
  await settings.locator('#vault-label').filter({hasText:'需要重新连接'}).waitFor();
  assert.equal(await settings.locator('#vault-connect').innerText(),'重新连接文件夹');
  await settings.locator('#vault-state.err').filter({hasText:'允许访问'}).waitFor();
  await settings.setViewportSize({width:360,height:780});await settings.locator('#vault-label').evaluate(n=>{const main=n.closest('main');main.scrollTop+=n.closest('section').getBoundingClientRect().top-main.getBoundingClientRect().top-16;});
  assert.ok(await settings.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await checkHeader(settings);await settings.screenshot({path:'/tmp/peak-distance-settings-actions-narrow.png'});
  await settings.locator('.ai-section').screenshot({path:'/tmp/peak-distance-ai-form-narrow.png'});
  await settings.locator('#ai-advanced summary').click();await settings.locator('#ai-model').scrollIntoViewIfNeeded();
  assert.ok(await settings.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await settings.screenshot({path:'/tmp/peak-distance-settings-ai-expanded.png'});
  await settings.locator('#ai-advanced summary').click();
  await settings.locator('#displayLanguage').selectOption('de');await settings.waitForFunction(()=>document.documentElement.lang==='de');
  assert.equal(await settings.locator('#vault-connect').getAttribute('aria-label'),'Ordner erneut verbinden');
  assert.ok(await settings.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await settings.locator('.ai-section').screenshot({path:'/tmp/peak-distance-ai-form-de.png'});
  await settings.locator('#clear').click();
  await settings.waitForFunction(async()=>!(await chrome.storage.local.get('aiServices')).aiServices.profiles.deepseek.apiKey);
  assert.equal(await settings.locator('#clear').isVisible(),false);assert.equal(await settings.locator('#key-help').isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS direct delete cancel/confirm; SVG review navigation; split vault status/reconnect; aligned SVG header, AI icon save/permission failure/clear, locale update and 360px layout');
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
