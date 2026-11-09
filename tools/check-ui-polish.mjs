// Focused visual/interaction check: actual extension chat and built lookup UI with controlled responses.
import { extensionPath as extension } from './extension-path.mjs';
import { chromium } from 'playwright-core';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import assert from 'node:assert/strict';

const profile = mkdtempSync(join(tmpdir(), 'pd-polish-'));
const output = resolve('.upstream/ui-polish');
mkdirSync(output, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.BLC_CHROME || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
context.setDefaultTimeout(12000);
const results = [], errors = [];
const check = (name, ok) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); assert.ok(ok, name); };
context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ deepseekApiKey: 'isolated-ui-fixture' });
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
      const text = '“get straight to the point” 的意思是「直奔主题」。\n\n这里的 straight 强调直接、不绕弯子；the point 指谈话的重点。整句话可以译为：“为什么，我可以直接切入正题。”\n\n换一个场景试试：\nLet’s get straight to the point. What do you need?\n我们直奔主题吧，你需要什么？\n\n与 get to the point 相比，加上 straight 会更强调省去铺垫。在会议、演讲开场或希望提高讨论效率时，都可以使用这个表达。';
      setTimeout(() => controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n')), 300);
      setTimeout(() => { controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close(); }, 900);
    }}), { headers: { 'content-type': 'text/event-stream' } });
  });
  const panel = await context.newPage();
  await panel.addInitScript(() => {
    const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.__holdChat = true; window.__heldChatReads = 0; window.__liveChatReads = 0;
    chrome.runtime.sendMessage = (message, ...args) => {
      if (message?.type === 'chatActive') {
        if (window.__holdChat) {
          window.__heldChatReads++;
          const callback = args.find(arg => typeof arg === 'function');
          if (callback) { callback({ ok: false }); return; }
          return Promise.resolve({ ok: false });
        }
        window.__liveChatReads++;
      }
      return originalSend(message, ...args);
    };
  });
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.waitForFunction(() => document.body && !document.body.inert);
  await panel.getByRole('button', { name: 'AI问答', exact: true }).click();
  await panel.locator('#chat-list .chat-hint').waitFor();
  check('读取失败保留贴底输入区及重试入口', await panel.evaluate(() => window.__heldChatReads > 0) && await panel.locator('#chat-input').isVisible());
  await panel.evaluate(() => { window.__holdChat = false; });
  await panel.locator('#chat-list .chat-hint button').click();
  await panel.waitForFunction(() => window.__liveChatReads > 0 && !document.querySelector('#chat-list').children.length);
  for (const width of [1200, 400, 320, 1000]) {
    await panel.setViewportSize({ width, height: width === 320 ? 700 : width === 1000 ? 1250 : 900 });
    await panel.screenshot({ path: join(output, `chat-empty-${width}.png`) });
    check(`空态 ${width}px：输入框与发送按钮完整可见`, await panel.locator('#chat-send').isVisible() && await panel.locator('#chat-input').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }));
    check(`空态 ${width}px：输入区贴底`, await panel.locator('#chat-input-row').evaluate(el=>innerHeight-el.getBoundingClientRect().bottom<=20));
  }
  await panel.locator('#chat-attachments summary').click();
  await panel.locator('#chat-attach-video').waitFor({state:'hidden'});
  check('附加菜单按来源展示页面和选区入口', await panel.locator('.chat-attachment-menu button:visible').count() === 2);
  await panel.locator('#chat-attachments summary').press('Escape');
  check('Escape 收起菜单并恢复焦点', await panel.locator('#chat-attachments').evaluate(el => !el.open && document.activeElement === el.querySelector('summary')));
  await panel.locator('#open-settings').click();
  await panel.locator('#view-settings').waitFor({ state: 'visible' });
  await panel.screenshot({ path: join(output, 'settings-back.png') });
  await panel.locator('#workspace-back').click();
  await panel.locator('#chat-input').fill('“get straight to the point” 是什么意思？可以举个例子吗？');
  await panel.locator('#chat-input').press('Control+Enter');
  await panel.locator('#chat-stop').waitFor({ state: 'visible' });
  await panel.locator('#chat-list .state.done').waitFor({state:'attached'});
  check('快捷键发送与流式回答完成', await panel.locator('#chat-list .a-text').innerText().then(text => text.includes('直奔主题')));
  for (const width of [1200, 400, 320]) {
    await panel.setViewportSize({ width, height: 900 });
    await panel.screenshot({ path: join(output, `chat-answer-${width}.png`) });
    check(`对话 ${width}px：正文与输入区无横向溢出`, await panel.locator('#view-chat').evaluate(el => el.scrollWidth <= el.clientWidth && document.querySelector('#chat-list').scrollWidth <= document.querySelector('#chat-list').clientWidth));
  }
  await panel.locator('[data-i18n-aria-label="保留解释"]').click();
  await panel.locator('#chat-head [data-i18n-aria-label="只看本对话已标记回答"]').click();
  check('保留筛选仍显示已保留回答', await panel.locator('#chat-list .msg.assistant').count() === 1);
  await panel.locator('#chat-head [data-i18n-aria-label="历史"]').click();
  await panel.locator('.chat-recent-row').first().waitFor();
  await panel.screenshot({ path: join(output, 'chat-history-320.png') });
  check('历史会话操作可达', await panel.locator('.chat-recent-row .delete-confirm-action').first().isVisible());

  // Use the shipped web content script with controlled dictionary responses.
  await worker.evaluate(()=>{
    globalThis.lookups=[];
    globalThis.fetch=async url=>{
      const host=new URL(url).hostname;
      if(host==='dict.youdao.com') {
        lookups.push('youdao');
        return Response.json({
          ec:{word:[{'return-phrase':{l:{i:'comfortable'}},trs:[{tr:[{l:{i:['adj. 舒适的；自在的']}}]}]}]},
          blng_sents_part:{'sentence-pair':[{sentence:'She is comfortable with people.','sentence-translation':'她和别人相处很自在。'}]},
        });
      }
      if(host==='dictionary.cambridge.org'){
        lookups.push('cambridge');
        const response=new Response('<div class="entry-body"><div class="entry-body__el"><span class="headword">comfortable</span><div class="def-block"><span class="trans dtrans">舒适的</span><div class="eg"><span class="deg">A comfortable chair.</span></div></div><div class="def-block"><span class="trans dtrans">自在的</span></div></div></div>');
        Object.defineProperty(response,'url',{value:String(url)});
        return response;
      }
      throw Error('Unexpected request: '+url);
    };
  });
  await context.route('https://example.com/ui-polish',route=>route.fulfill({
    contentType:'text/html',
    body:'<!doctype html><html lang="en"><body style="margin:40px;background:#e7e4db;text-shadow:0 0 2px #000"><p id="text">She is comfortable with people.</p></body></html>',
  }));
  const page = await context.newPage();
  await page.setViewportSize({width:800,height:800});
  await page.goto('https://example.com/ui-polish');
  await page.locator('html[data-blc-web="1"]').waitFor();
  await page.locator('#text').evaluate(el => {
    const range = document.createRange(); const start = el.firstChild.textContent.indexOf('comfortable');
    range.setStart(el.firstChild, start); range.setEnd(el.firstChild, start + 11);
    getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('button', { name: '查词', exact: true }).click();
  await page.locator('#blc-lookup-popup .example').first().waitFor();
  for (const width of [800, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.screenshot({ path: join(output, `lookup-${width}.png`) });
    check(`词卡 ${width}px：不溢出且不继承阴影`, await page.locator('#blc-lookup-popup .card').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth && getComputedStyle(el).textShadow === 'none'; }));
  }
  await page.getByRole('combobox', { name: '词典', exact: true }).selectOption('cambridge');
  check('字典下拉仍切换真实查询参数', await worker.evaluate(() => lookups.at(-1) === 'cambridge'));
  await page.locator('#blc-lookup-popup summary').click();
  await page.locator('#blc-lookup-popup input[type=radio]').nth(1).check();
  check('展开和选择其他义项可用', await page.locator('#blc-lookup-popup input[type=radio]').nth(1).isChecked());
  check('来源链接保留地址和打开方式', await page.getByRole('link', { name: '词典原页' }).getAttribute('target') === '_blank');
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await page.locator('#blc-lookup-popup .save.is-saved').waitFor();
  check('新词卡显示实心书签状态', true);
  check('无页面脚本异常', !errors.length);
} finally {
  writeFileSync(join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
  const safeProfile = resolve(profile);
  if (safeProfile.startsWith(resolve(tmpdir()) + sep) && safeProfile.includes('pd-polish-')) rmSync(safeProfile, { recursive: true, force: true });
}
