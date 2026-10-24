import { translateNativeText, prepareNativeTranslation } from '@/lib/nativeTranslator';
import { brandTokens, brandControls } from '@/shared/brand';
import { TARGET_LANGUAGES } from '@/shared/languages';
import { initDisplayLanguage, getDisplayLocale, localize, languageLabel, message, setText, onDisplayLanguageChange } from '@/shared/i18n';
Object.assign(window, {translateNativeText});

if (window === window.top) {
  await initDisplayLanguage();
  document.head.insertAdjacentHTML('beforeend', `<style>${brandTokens}${brandControls}
    body{margin:0;background:var(--pd-paper);color:var(--pd-ink);font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif}
    main{max-width:480px;padding:32px 20px;margin:auto}h1{font-size:18px;font-weight:600;margin:0 0 12px}
    p{color:var(--pd-muted)}form{display:flex;gap:16px;margin:24px 0}label{flex:1;color:var(--pd-muted);font-size:12px}select{display:block;width:100%;margin-top:4px}
    button{font-size:14px}#state{white-space:pre-wrap;overflow-wrap:anywhere}
  </style>`);
  document.body.innerHTML = `<main><h1 data-i18n="准备内置翻译"></h1><p data-i18n="首次使用需要下载语言模型。准备完成后可关闭此页，回到原文重试。"></p><form><label><span data-i18n="原文语言"></span><select id="source"></select></label><label><span data-i18n="目标语言"></span><select id="target"></select></label></form><button id="prepare" data-i18n="准备内置翻译"></button><button id="cancel" data-i18n="取消" hidden></button><p id="state" role="status"></p></main>`;
  localize(document);
  document.documentElement.lang = getDisplayLocale();
  onDisplayLanguageChange(() => { document.documentElement.lang = getDisplayLocale(); localize(document); });
  const source = document.querySelector<HTMLSelectElement>('#source')!, target = document.querySelector<HTMLSelectElement>('#target')!;
  for (const tag of [...new Set(['zh-Hans', 'zh-Hant', ...TARGET_LANGUAGES.filter(l => l !== 'zh')])]) {
    const option = new Option('', tag), other = new Option('', tag);
    setText(option, languageLabel(tag)); setText(other, languageLabel(tag)); source.add(option); target.add(other);
  }
  const params = new URLSearchParams(location.search);
  source.value = params.get('source') || 'en'; target.value = params.get('target') || 'zh-Hans';
  if (!source.value) source.value = 'en';
  if (!target.value) target.value = 'zh-Hans';
  const prepare = document.querySelector<HTMLButtonElement>('#prepare')!, cancel = document.querySelector<HTMLButtonElement>('#cancel')!, state = document.querySelector('#state')!;
  let controller: AbortController | undefined;
  cancel.onclick = () => controller?.abort();
  addEventListener('pagehide', () => controller?.abort());
  prepare.onclick = async () => {
    controller = new AbortController(); prepare.disabled = true; cancel.hidden = false; source.disabled = target.disabled = true;
    setText(state, message('正在准备内置翻译，首次使用可能需要较长时间…'));
    try { await prepareNativeTranslation({source:source.value, target:target.value}, controller.signal); setText(state, message('准备完成，请回到原文重试。')); }
    catch (error) { setText(state, message(controller.signal.aborted ? '已取消' : '浏览器内置翻译暂不可用，请在设置中更换翻译来源。原文已保留。')); console.warn('[pd] native translation preparation failed', error); }
    finally { prepare.disabled = false; cancel.hidden = true; source.disabled = target.disabled = false; }
  };
}
