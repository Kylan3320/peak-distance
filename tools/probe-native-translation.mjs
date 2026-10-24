// Real installed browsers and real models. No cloud translation or mocked responses.
// Keeps isolated profiles/model downloads under .upstream; never changes user profiles.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve('.upstream/native-translation-probe');
await mkdir(root, { recursive: true });
const timeoutMs = Number(process.env.PD_NATIVE_TIMEOUT_MS || 90000);
// Playwright disables Translate itself and component updates by default. Restore
// normal browser features for this capability probe; do not enable experimental APIs.
const require = createRequire(import.meta.url);
const playwrightSource = await readFile(join(dirname(require.resolve('playwright-core/package.json')), 'lib/coreBundle.js'), 'utf8');
const disabledFeatures = playwrightSource.match(/disabledFeatures = \[([\s\S]*?)\]\.filter\(Boolean\)/)?.[1];
if (!disabledFeatures) throw Error('Cannot identify Playwright feature defaults; native probe would be unreliable');
const featureFlag = '--disable-features=' + [...disabledFeatures.matchAll(/^\s*"([^"]+)"/gm)].map(m=>m[1]).join(',');
const script = `
window.probe = { phase: 'idle' };
window.spec = { sourceLanguage:'en', targetLanguage:'zh', text:'What advice do you have for submitting a strong application?' };
document.querySelector('button').onclick = async () => {
  const started = performance.now(), spec = window.spec;
  const state = window.probe = { phase:'running', spec, progress:[], translator:typeof Translator, detector:typeof LanguageDetector };
  const timer = new AbortController();
  const deadline = setTimeout(() => timer.abort(), ${timeoutMs});
  const render = () => document.querySelector('pre').textContent = JSON.stringify({...state,progress:state.progress.length?[state.progress[0],state.progress.at(-1)]:[]}, null, 2);
  const monitor = m => m.addEventListener('downloadprogress', e => { state.progress.push({loaded:e.loaded,total:e.total,ms:Math.round(performance.now()-started)}); render(); });
  let session;
  try {
    if (spec.detect) {
      state.availability = await LanguageDetector.availability(); render();
      session = await LanguageDetector.create({signal:timer.signal, monitor});
      state.output = await session.detect(spec.text, {signal:timer.signal});
      state.ok = state.output[0]?.detectedLanguage === 'en';
    } else {
      state.availability = await Translator.availability(spec); render();
      session = await Translator.create({...spec, signal:timer.signal, monitor});
      state.createdMs = Math.round(performance.now()-started);
      state.output = await session.translate(spec.text, {signal:timer.signal});
      state.ok = !!state.output && state.output !== spec.text && (!spec.targetLanguage.startsWith('zh') || /[\\u3400-\\u9fff]/u.test(state.output));
    }
  } catch (e) { state.ok=false; state.error={name:e.name,message:e.message}; }
  finally { clearTimeout(deadline); session?.destroy(); state.ms=Math.round(performance.now()-started); state.phase='done'; render(); }
};`;
const html = '<!doctype html><meta charset="utf-8"><title>Native translation probe</title><button>Prepare model and translate</button><pre>Ready</pre><script src="/probe.js"></script>';
const fixture = join(root, 'extension');
await mkdir(fixture, { recursive: true });
await Promise.all([
  writeFile(join(fixture, 'manifest.json'), JSON.stringify({manifest_version:3,name:'Peak Distance native translation probe',version:'1.0',background:{service_worker:'worker.js'},options_ui:{page:'probe.html',open_in_tab:true}})),
  writeFile(join(fixture, 'probe.html'), html.replace('/probe.js', 'probe.js')),
  writeFile(join(fixture, 'probe.js'), script),
  writeFile(join(fixture, 'worker.js'), 'chrome.runtime.onMessage.addListener((m,s,reply)=>{if(m.type==="capability")reply({translator:typeof Translator,detector:typeof LanguageDetector});});'),
]);
const server = createServer((req, res) => {
  res.setHeader('content-type', req.url === '/probe.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/probe.js' ? script : html);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const pageUrl = `http://127.0.0.1:${server.address().port}/`;
const requested = process.argv.find(a => a.startsWith('--browser='))?.split('=')[1];
const browsers = {
  chrome:'C:/Program Files/Google/Chrome/Application/chrome.exe',
  edge:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
};
const results = [];
const resultFile = join(root, `results-${process.argv.includes('--headed')?'headed':'headless'}-${Date.now()}.json`);
async function run(page, name, spec) {
  await page.evaluate(spec => { window.spec=spec; }, spec);
  await page.getByRole('button').click();
  try { await page.waitForFunction(() => window.probe.phase === 'done', null, {timeout:timeoutMs+5000}); }
  catch { /* Record the actual pending state if a browser API ignores cancellation. */ }
  const result = {name, ...await page.evaluate(() => window.probe)};
  results.push(result); console.log(JSON.stringify({...result,progress:result.progress.length ? [result.progress[0],result.progress.at(-1)] : []}));
  await writeFile(resultFile, JSON.stringify(results, null, 2));
  return result;
}
try {
  for (const [name, executablePath] of Object.entries(browsers)) {
    if (requested && name !== requested) continue;
    let context;
    try {
      context = await chromium.launchPersistentContext(join(root, `${name}-profile`), {
        executablePath, headless:!process.argv.includes('--headed'), chromiumSandbox:true,
        // Model provisioning needs the normal browser component updater/network service.
        ignoreDefaultArgs:['--disable-component-update','--disable-background-networking','--disable-field-trial-config',featureFlag],
        ...(process.env.BLC_PROXY ? {proxy:{server:process.env.BLC_PROXY}} : {}),
        args:[`--disable-extensions-except=${fixture}`,`--load-extension=${fixture}`],
      });
      console.log(JSON.stringify({browser:name, version:context.browser()?.version(), mode:process.argv.includes('--headed')?'headed':'headless'}));
      let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker',{timeout:10000}).catch(()=>null);
      if (worker) console.log(JSON.stringify({browser:name, worker:await worker.evaluate(async()=>({translator:typeof Translator,detector:typeof LanguageDetector,availability:typeof Translator==='function'?await Translator.availability({sourceLanguage:'en',targetLanguage:'zh-Hans'}):null}))}));
      else console.log(JSON.stringify({browser:name, extension:'No extension worker observed during startup; extension context remains unverified'}));
      const web = await context.newPage(); await web.goto(pageUrl);
      web.on('console', msg => { if(msg.type()==='warning'||msg.type()==='error')console.log(JSON.stringify({browser:name,console:msg.text()})); });
      const capabilities = await web.evaluate(()=>({translator:typeof Translator,detector:typeof LanguageDetector,ua:navigator.userAgent}));
      console.log(JSON.stringify({browser:name, capabilities}));
      if (capabilities.translator !== 'function') { results.push({name:`${name}:web`,ok:false,error:'Translator API unavailable'}); continue; }
      const targetLanguage = name==='edge'?'zh-Hans':'zh';
      const first = await run(web, `${name}:web:en-zh`, {sourceLanguage:'en',targetLanguage,text:'What advice do you have for submitting a strong application?'});
      if (first.ok) await run(web, `${name}:web:detect`, {detect:true,text:'What advice do you have for submitting a strong application?'});
      worker ??= context.serviceWorkers()[0];
      if (worker) {
        const extensionPage = await context.newPage();
        await extensionPage.goto(`chrome-extension://${new URL(worker.url()).host}/probe.html`);
        const extensionResult = await run(extensionPage, `${name}:extension:en-zh`, {sourceLanguage:'en',targetLanguage,text:'Keep the original sentence and save the translation for later review.'});
        if (extensionResult.ok) {
          await context.setOffline(true);
          await run(extensionPage, `${name}:extension:offline`, {sourceLanguage:'en',targetLanguage,text:'This new sentence must be translated while the browser is offline.'});
          await context.setOffline(false);
        }
      }
      if (first.ok) {
        await context.setOffline(true);
        await run(web, `${name}:web:offline`, {sourceLanguage:'en',targetLanguage,text:'The fresh bread tastes wonderful every morning.\nKeep the original line break.'});
        await run(web, `${name}:web:zh-en:offline`, {sourceLanguage:targetLanguage,targetLanguage:'en',text:'学习语言时，请保留原句和来源。'});
        await context.setOffline(false);
        await context.close();
        context = await chromium.launchPersistentContext(join(root, `${name}-profile`), {
          executablePath, headless:!process.argv.includes('--headed'), chromiumSandbox:true,
          ...(process.env.BLC_PROXY ? {proxy:{server:process.env.BLC_PROXY}} : {}),
          ignoreDefaultArgs:['--disable-component-update','--disable-background-networking','--disable-field-trial-config',featureFlag],
          args:[`--disable-extensions-except=${fixture}`,`--load-extension=${fixture}`],
        });
        const restarted = await context.newPage(); await restarted.goto(pageUrl);
        await context.setOffline(true);
        await run(restarted, `${name}:web:restart:offline`, {sourceLanguage:'en',targetLanguage,text:'A restarted browser should reuse the prepared translation model.'});
      }
    } catch (e) { const result={name,ok:false,error:String(e)};results.push(result);console.log(JSON.stringify(result)); }
    finally { await context?.close(); await writeFile(resultFile, JSON.stringify(results,null,2)); }
  }
} finally { server.close(); }
