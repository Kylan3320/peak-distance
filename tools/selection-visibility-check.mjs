// Exercise display controls against the built extension in an isolated browser.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { extensionPath } from './extension-path.mjs';

const profile = mkdtempSync(join(tmpdir(), 'pd-selection-visibility-'));
const browser = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.BLC_CHROME || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--disable-extensions-except=' + extensionPath, '--load-extension=' + extensionPath],
});
const check = (name, passed) => { assert(passed, name); console.log('PASS ' + name); };
try {
  await browser.route('https://example.com/article', route => route.fulfill({ contentType: 'text/html', body:
    '<p id="p1">They are learning English together.</p>' +
    "<button id=\"page-action\" onmousedown=\"event.preventDefault()\" onclick=\"this.dataset.clicked='yes'\">Page action</button>",
  }));
  await browser.route('https://example.com/other', route => route.fulfill({ contentType: 'text/html', body:
    '<p id="q1">A different page entirely, with different text about mountains and rivers.</p>',
  }));
  const sw = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  await sw.evaluate(() => chrome.storage.local.set({ displayLanguage: 'zh-Hans' }));
  const extId = new URL(sw.url()).host;
  const page = await browser.newPage();
  await page.goto('https://example.com/article');
  await page.waitForFunction(() => document.documentElement.dataset.blcWeb === '1');
  const selectText = (selector, start, end) => page.locator(selector).evaluate((p, offsets) => {
    const range = document.createRange();
    range.setStart(p.firstChild, offsets[0]);
    range.setEnd(p.firstChild, offsets[1]);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, [start, end]);
  const learnAt = (await page.locator('#p1').textContent()).indexOf('learnin');
  await selectText('#p1', learnAt, learnAt + 7);
  const pill = page.locator('#blc-lookup-pill');
  const visibilityTrigger = pill.getByRole('button', { name: '浮条显示选项' });
  const visibilityMenu = pill.locator('#pill-visibility-menu');
  const openVisibilityMenu = async () => {
    await visibilityTrigger.click();
    await visibilityMenu.waitFor({ timeout: 5000 });
  };
  await openVisibilityMenu();
  check('显示菜单只有三项且按内容收宽', await visibilityMenu.evaluate(menu => {
    const rows = Array.from(menu.querySelectorAll('button'));
    const longest = Math.max(...rows.map(row => {
      const range = document.createRange();
      range.selectNodeContents(row);
      return range.getBoundingClientRect().width;
    }));
    const width = menu.getBoundingClientRect().width;
    return rows.map(row => row.textContent).join('|') === '本页不再显示|暂停 1 小时|暂停 1 天' &&
      rows.every(row => row.getBoundingClientRect().height === 34) && Math.abs(width - longest - 34) < 1;
  }));
  await page.keyboard.press('Escape');
  await visibilityMenu.waitFor({ state: 'hidden', timeout: 5000 });
  check('Esc 优先收起菜单，保留浮条', await pill.isVisible());
  await page.locator('#page-action').click();
  await pill.waitFor({ state: 'hidden', timeout: 5000 });
  check('点外收起且网页点击和原生选区可继续', await page.evaluate(() =>
    document.querySelector('#page-action').dataset.clicked === 'yes' && getSelection().toString() === 'learnin'));

  await selectText('#p1', learnAt, learnAt + 8);
  await openVisibilityMenu();
  await visibilityMenu.locator('[value="page"]').click();
  await page.locator('#pd-selection-visibility-notice').getByText('本页已隐藏浮条').waitFor({ timeout: 5000 });
  await page.reload();
  await selectText('#p1', learnAt, learnAt + 7);
  const articleTabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
  const otherTab = await browser.newPage();
  await otherTab.goto('https://example.com/other');
  const selectOther = () => otherTab.locator('#q1').evaluate(p => {
    const range = document.createRange();
    range.setStart(p.firstChild, 2);
    range.setEnd(p.firstChild, 11);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await selectOther();
  await otherTab.locator('#blc-lookup-pill').waitFor({ timeout: 5000 });
  check('本页隐藏跨刷新保留，同站其他页照常显示', !await pill.isVisible());

  const options = await browser.newPage();
  await options.goto(`chrome-extension://${extId}/options.html`);
  const rules = options.locator('#pill-visibility-settings');
  const revealRules = async () => {
    await rules.waitFor({ timeout: 5000 });
    if (!await rules.evaluate(details => details.open)) await rules.locator('summary').click();
  };
  await options.waitForFunction(async tabId => {
    const result = await chrome.runtime.sendMessage({ type: 'selectionCandidateGet', tabId });
    return result?.candidate?.text === 'learnin';
  }, articleTabId, { timeout: 5000 });
  check('隐藏浮条后仍保留侧栏附加选区候选', true);
  await revealRules();
  await rules.getByRole('button', { name: '恢复显示' }).click();
  await rules.waitFor({ state: 'hidden', timeout: 5000 });

  await selectText('#p1', learnAt, learnAt + 7);
  await openVisibilityMenu();
  await visibilityMenu.locator('[value="hour"]').click();
  const pauseNotice = page.locator('#pd-selection-visibility-notice');
  await pauseNotice.getByText('所有网页已暂停 1 小时').waitFor({ timeout: 5000 });
  await otherTab.locator('#blc-lookup-pill').waitFor({ state: 'hidden', timeout: 5000 });
  const expiresIn = () => sw.evaluate(async () => (await chrome.storage.local.get('selectionPillPause')).selectionPillPause.until - Date.now());
  check('暂停 1 小时立即关闭其他标签页浮条', Math.abs(await expiresIn() - 3600000) < 10000);
  await pauseNotice.getByRole('button', { name: '撤销' }).click();
  await rules.waitFor({ state: 'hidden', timeout: 5000 });
  await selectOther();
  await otherTab.locator('#blc-lookup-pill').waitFor({ timeout: 5000 });
  check('撤销暂停后重新划选恢复', true);

  await selectText('#p1', learnAt, learnAt + 8);
  await openVisibilityMenu();
  await visibilityMenu.locator('[value="day"]').click();
  await pauseNotice.getByText('所有网页已暂停 1 天').waitFor({ timeout: 5000 });
  check('暂停 1 天以 24 小时计', Math.abs(await expiresIn() - 86400000) < 10000);
  await revealRules();
  await rules.getByRole('button', { name: '恢复显示' }).click();
  await rules.waitFor({ state: 'hidden', timeout: 5000 });
  await sw.evaluate(() => chrome.storage.local.set({ selectionPillPause: { id: 'expired', until: Date.now() - 1 } }));
  await options.close();
  await otherTab.close();
  await page.bringToFront();
  await selectText('#p1', learnAt, learnAt + 7);
  await pill.waitFor({ timeout: 5000 });
  check('暂停到期后重新划选恢复', await pill.isVisible());
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
