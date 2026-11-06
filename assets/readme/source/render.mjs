// Build first, then run: node assets/readme/source/render.mjs
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const local = relative => fileURLToPath(new URL(relative, import.meta.url));
const extension = process.env.PEAK_DISTANCE_UI_EXTENSION || local('../../../.output/build/chrome-mv3');
const browserOptions = {
  executablePath: process.env.BLC_CHROME || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
};
const profile = await mkdtemp(join(tmpdir(), 'peak-distance-readme-'));
const original = 'You get more out of a book when you slow down.';
const expression = 'slow down';
const articleUrl = 'https://example.com/reading-sample';
const settings = {
  'zh-Hans': {
    suffix: '', tagline: '把词留在句子里', source: '阅读示例', english: '英语',
    lookup: '查词并收藏', review: '回到原句复习',
  },
  en: {
    suffix: '-en', tagline: 'Keep the sentence with the word', source: 'Reading sample', english: 'English',
    lookup: 'Look up and save', review: 'Review in context',
  },
};
const image = (buffer, type = 'png') => `data:image/${type};base64,${buffer.toString('base64')}`;
const background = image(await readFile(local('grid-art.jpg')), 'jpeg');

async function capture(locale, labels) {
  const context = await chromium.launchPersistentContext(join(profile, locale), {
    ...browserOptions,
    viewport: {width: 640, height: 500},
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(10000);
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', {timeout: 12000});
    const base = `chrome-extension://${new URL(worker.url()).host}`;
    // Controlled dictionary result and article, real selection, save and review UI.
    await worker.evaluate(expression => {
      globalThis.fetch = async url => {
        if (new URL(url).hostname !== 'dict.youdao.com') throw new Error(`Unexpected request: ${url}`);
        return Response.json({ec:{word:[{'return-phrase':{l:{i:expression}},trs:[{tr:[{l:{i:['放慢速度']}}]}]}]}});
      };
    }, expression);
    const panel = await context.newPage();
    await panel.setViewportSize({width: 464, height: 410});
    await panel.goto(base + '/options.html');
    await panel.evaluate(locale => chrome.storage.local.set({displayLanguage:locale}), locale);
    const saved = await panel.evaluate(({original, source}) => chrome.runtime.sendMessage({
      type:'saveSentence',
      sentence:{
        video:{videoId:'readme-sample',trackId:'en',trackKind:'manual',trackLang:'en',startMs:44000},
        title:source,text:original,zh:'放慢一点读，收获会更多。',endMs:47000,
      },
    }), {original, source:labels.source});
    assert.equal(saved.ok, true);
    await panel.goto(base + '/sidepanel.html#sentences');
    await panel.locator('#sentences-list .entry').getByText(original).waitFor();
    const library = await panel.screenshot();

    await context.route(articleUrl, route => route.fulfill({
      contentType:'text/html',
      body:`<!doctype html><html lang="en"><meta charset="utf-8"><title>${labels.source}</title>
      <body style="margin:64px 44px;background:#f8f7f4;color:#292b27;font:22px/1.6 Georgia,serif">
      <article><p id="sentence">${original}</p></article></body></html>`,
    }));
    const web = await context.newPage();
    await web.goto(articleUrl);
    await web.locator('html[data-blc-web="1"]').waitFor();
    await web.locator('#sentence').evaluate((element, expression) => {
      const node = element.firstChild;
      const start = node.textContent.indexOf(expression);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + expression.length);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
    }, expression);
    await web.locator('#blc-lookup-pill #lookup').click();
    const popup = web.locator('#blc-lookup-popup .card');
    await popup.getByText('放慢速度', {exact:true}).waitFor();
    await popup.locator('.act.save').click();
    await popup.locator('.learning-status').waitFor();
    const lookup = await popup.screenshot();

    await panel.locator('.library-tabs [data-view="list"]').click();
    await panel.getByRole('button', {name:expression, exact:false}).first().waitFor();
    await panel.locator('#review-library').click();
    await panel.locator('#review-body').getByRole('button', {name:labels.english, exact:true}).click();
    await panel.locator('.review-card').waitFor();
    const review = await panel.screenshot({clip:{x:0,y:0,width:464,height:356}});
    return {library, lookup, review};
  } finally {
    await context.close();
  }
}

try {
  const browser = await chromium.launch(browserOptions);
  try {
    const page = await browser.newPage({viewport:{width:1120,height:486},deviceScaleFactor:2});
    const render = async (body, styles, height, file, type) => {
      await page.setViewportSize({width:1120,height});
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>
        *{box-sizing:border-box}body{margin:0;color:#11131a;font-family:"Segoe UI","Microsoft YaHei",sans-serif}
        h1,p,figure{margin:0}img{display:block}${styles}</style>${body}`);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(img => img.decode()));
      });
      await page.screenshot({path:local(`../${file}`),type,...(type === 'jpeg' && {quality:91})});
    };

    for (const [locale, labels] of Object.entries(settings)) {
      const {library, lookup, review} = await capture(locale, labels);
      await render(
        `<img class="paper" src="${background}"><div class="title"><h1>Peak Distance</h1><p>${labels.tagline}</p></div>
        <div class="panel"><img src="${image(library)}"></div>`,
        `body{height:100vh;overflow:hidden;background:#faf9f6}
        .paper{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
        .title{position:absolute;inset:56px 0 auto;text-align:center}
        h1{font-size:77px;line-height:1.05;font-weight:760;letter-spacing:-3.2px}
        p{font-size:25px;color:#343d56;margin-top:12px}
        .panel{position:absolute;left:50%;top:211px;transform:translateX(-50%);width:464px;
          overflow:hidden;border:1px solid #dcdfdf;border-radius:11px 11px 0 0;background:#f8f7f4}
        .panel img{width:100%;height:auto}`, 486, `hero${labels.suffix}.jpg`, 'jpeg');
      await render(
        `<main><figure><figcaption>${labels.lookup}</figcaption><img src="${image(lookup)}"></figure>
        <span aria-hidden="true">→</span><figure><figcaption>${labels.review}</figcaption><img src="${image(review)}"></figure></main>`,
        `body{background:#f2f4f8}main{display:grid;grid-template-columns:minmax(0,1fr) 30px minmax(0,1fr);
          align-items:start;gap:22px;padding:24px 34px}figcaption{font-size:22px;font-weight:600;margin-bottom:12px}
        figure img{width:100%;height:314px;object-fit:contain;object-position:center;
          background:#f8f7f4;border:1px solid #dce0e6;border-radius:9px}
        span{align-self:center;color:#53657f;font-size:25px;text-align:center}`, 406, `demo${labels.suffix}.png`, 'png');
    }
  } finally {
    await browser.close();
  }
} finally {
  await rm(profile, {recursive:true,force:true});
}
