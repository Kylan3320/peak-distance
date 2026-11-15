// Real browsers and the same production build. Only article HTML is controlled.
import { extensionPath } from './extension-path.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const root = resolve('.upstream/native-translation-probe');
const require = createRequire(import.meta.url);
const source = await readFile(join(dirname(require.resolve('playwright-core/package.json')), 'lib/coreBundle.js'), 'utf8');
const list = source.match(/disabledFeatures = \[([\s\S]*?)\]\.filter\(Boolean\)/)?.[1];
assert.ok(list, 'Playwright feature defaults must be identifiable');
const features = [...list.matchAll(/^\s*"([^"]+)"/gm)].map(m => m[1]);
const browserPaths = {
  chrome: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  edge: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
};
const only = process.argv.find(arg => arg.startsWith('--browser='))?.split('=')[1];
const results = [];
await mkdir(root, { recursive:true });

for (const [name, executablePath] of Object.entries(browserPaths)) {
  if (only && only !== name) continue;
  const result = { browser:name, samples:[] };
  results.push(result);
  let context;
  try {
    context = await chromium.launchPersistentContext(join(root, name+'-continuous-profile'), {
      executablePath, headless:false, chromiumSandbox:true,
      ignoreDefaultArgs:['--disable-extensions', '--disable-component-update', '--disable-background-networking',
        '--disable-field-trial-config', '--disable-features='+features.join(',')],
      args:['--enable-unsafe-extension-debugging', '--disable-features='+features.filter(feature => !['Translate','OptimizationHints'].includes(feature)).join(',')],
    });
    context.setDefaultTimeout(18000);
    result.version = context.browser().version();
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', {path:extensionPath});
    await cdp.send('Extensions.uninstall', {id});
    await cdp.send('Extensions.loadUnpacked', {path:extensionPath});
    const base = 'chrome-extension://'+id;
    const prep = await context.newPage();
    await prep.goto(base+'/native-translator.html?target=zh-Hans');
    assert.equal(await prep.locator('#source').inputValue(), '');
    assert.equal(await prep.locator('#prepare').isDisabled(), true);
    await prep.locator('#source').selectOption('en');
    await prep.locator('#prepare').click();
    await prep.waitForFunction(() => !document.querySelector('#prepare').disabled, null, {timeout:90000});
    result.preparation = await prep.locator('#state').innerText();
    result.capabilities = await prep.evaluate(async () => {
      const result = {};
      for (const source of ['en','ja','fr']) {
        result[source] = typeof Translator === 'function' ? await Translator.availability({sourceLanguage:source, targetLanguage:'zh'}) : 'no-api';
      }
      result.detector = typeof LanguageDetector === 'function' ? await LanguageDetector.availability() : 'no-api';
      return result;
    });
    console.log(JSON.stringify({browser:name, version:result.version, preparation:result.preparation, capabilities:result.capabilities}));
    await prep.close();

    const options = await context.newPage();
    await options.goto(base+'/options.html');
    await options.evaluate(() => chrome.storage.local.set({displayLanguage:'zh-Hans',defaultComprehensionLang:'zh-Hans',comprehensionOverrides:{en:'de'},regularTranslation:'browser-native'}));
    await options.reload();
    await options.locator('#defaultComprehensionLang').waitFor();
    assert.equal(await options.locator('#defaultComprehensionLang').inputValue(), 'zh-Hans');
    assert.match(await options.locator('label:has(#displayLanguage)').innerText(), /界面语言/u);
    assert.match(await options.locator('label:has(#defaultComprehensionLang)').innerText(), /翻译与释义语言/u);
    assert.equal(await options.locator('#regularTranslation, #override-source').count(), 0);
    console.log(name+' settings verified');
    const worker = context.serviceWorkers().find(w => w.url().startsWith(base)) ?? await context.waitForEvent('serviceworker', {predicate:w => w.url().startsWith(base)});
    const clear = await options.evaluate(() => Promise.race([
      chrome.runtime.sendMessage({type:'clearQueryCache'}),
      new Promise((_,reject) => setTimeout(() => reject(new Error('Query cache clear timed out')), 10000)),
    ]));
    assert.equal(clear?.ok,true);
    await worker.evaluate(() => {
      globalThis.translationTraffic = [];
      globalThis.nativeDetections = [];
      const connect = chrome.runtime.connect.bind(chrome.runtime);
      chrome.runtime.connect = options => {
        const port = connect(options);
        if (options.name === 'native-translation') port.onMessage.addListener(message => {
          if (message.detected) globalThis.nativeDetections.push(message.detected);
        });
        return port;
      };
      const fetchOriginal = globalThis.fetch;
      globalThis.fetch = (url, init) => {
        if (String(url).includes('translate.googleapis.com')) {
          globalThis.translationTraffic.push({source:new URL(url).searchParams.get('sl'), target:new URL(url).searchParams.get('tl')});
          if (globalThis.translationOffline) throw new Error('Online translation disabled for offline check');
        }
        return fetchOriginal(url, init);
      };
    });

    const samples = [
      {id:'en', text:'The spring rain nourishes the garden.'},
      {id:'ja', text:'図書館は毎週月曜日に休館します。'},
      {id:'fr', text:'Le dernier train part à minuit.'},
      {id:'auto', text:'Notre boulangerie ouvre le dimanche matin.'},
      {id:'offline', text:'This fresh sentence can be read even while the browser is offline.'},
    ];
    await context.route('https://example.com/continuous-reading', route => route.fulfill({
      contentType:'text/html',
      body:'<!doctype html><html><meta charset="utf-8"><title>Continuous multilingual reading</title><article>'+
        samples.map(({id,text}) => '<p id="'+id+'"'+(id==='auto' ? '' : ' lang="'+(id==='offline'?'en':id)+'"')+'>'+text+'</p>').join('')+
        '</article></html>',
    }));
    const page = await context.newPage();
    await page.goto('https://example.com/continuous-reading');
    await page.locator('html[data-blc-web="1"]').waitFor();
    const card = page.locator('#pd-translation');
    async function translate({id,text}) {
      await page.evaluate(id => {
        const range = document.createRange();
        range.selectNodeContents(document.getElementById(id));
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      }, id);
      await page.locator('#blc-lookup-pill #translate').click();
      const original = card.locator('#original');
      assert.equal(await original.innerText(), text);
      await card.locator('#copy:not([disabled]), #retry-inline:visible').first().waitFor();
      const state = await card.locator('#query-state').textContent();
      const output = await card.locator('#result').textContent();
      const attribution = await card.locator('.attribution span').textContent();
      result.samples.push({ id, text, output, attribution, state });
      console.log(JSON.stringify({browser:name, ...result.samples.at(-1)}));
      await card.locator('#close').click();
      return {output, attribution};
    }
    for (const sample of samples.slice(0,4)) await translate(sample);
    await context.setOffline(true);
    await worker.evaluate(() => { globalThis.translationOffline = true; });
    const offline = await translate(samples[4]);
    result.onlineCalls = await worker.evaluate(() => globalThis.translationTraffic);
    result.nativeDetections = await worker.evaluate(() => globalThis.nativeDetections);
    for (const {text,output,attribution,id} of result.samples) {
      assert.ok(output !== text && /\p{Script=Han}/u.test(output), id+' must have a real Chinese translation');
      const source = id === 'offline' ? 'en' : id === 'auto' && result.nativeDetections.includes('fr') ? 'fr' : id;
      const expected = result.capabilities[source] === 'available' ? '浏览器内置翻译' : 'Google';
      assert.equal(attribution, id === 'offline' ? '浏览器内置翻译' : expected, id+' source');
    }
    assert.equal(offline.attribution, '浏览器内置翻译');
    assert.equal(result.capabilities.en, 'available');
    assert.ok(['ja','fr'].some(source => result.capabilities[source] !== 'available'), 'At least one selected language must need online fallback');
    const online = result.samples.filter(sample => sample.attribution === 'Google')
      .map(sample => sample.id === 'auto' ? result.nativeDetections[0] ?? 'auto' : sample.id);
    assert.deepEqual(result.onlineCalls, online.map(source => ({source,target:'zh-CN'})));
    console.log(JSON.stringify({browser:name, onlineCalls:result.onlineCalls, nativeDetections:result.nativeDetections}));
    result.ok = true;
  } catch (error) {
    result.ok = false;
    result.error = String(error);
    console.error(JSON.stringify(result));
  } finally {
    await context?.close();
    await writeFile(join(root, 'continuous-'+name+'-'+Date.now()+'.json'), JSON.stringify(result,null,2));
  }
}
if (results.some(result => !result.ok)) process.exitCode = 1;
