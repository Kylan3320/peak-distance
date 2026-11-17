import { applyAppearance } from '@/shared/appearance';
import { translateNativeText, prepareNativeTranslation } from '@/lib/nativeTranslator';
import { brandTokens, brandControls } from '@/shared/brand';
import { uiIcon } from '@/shared/uiControls';
import { TARGET_LANGUAGES } from '@/shared/languages';
import { initDisplayLanguage, getDisplayLocale, localize, languageLabel, message, setText, onDisplayLanguageChange } from '@/shared/i18n';
Object.assign(window, {translateNativeText});

if (window === window.top) {
  applyAppearance(document.documentElement);
  await initDisplayLanguage();
  document.head.insertAdjacentHTML('beforeend', `<style>${brandTokens}${brandControls}
    :root{--pd-paper-tile:url('/brand/paper-tile.png')}
    body{margin:0;background-color:var(--pd-paper);background-image:var(--pd-texture);background-position:center;background-size:620px;color:var(--pd-ink);font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif}
    main{max-width:752px;padding:32px 16px;margin:auto}h1{font:600 20px/1.4 var(--pd-font-heading);margin:0 0 12px}
    p{color:var(--pd-muted)}form{display:flex;flex-wrap:wrap;gap:16px;margin:24px 0}label{flex:1 1 140px;min-width:0;color:var(--pd-muted);font-size:12px}select{display:inline-flex;width:100%;margin-top:4px;background:var(--pd-surface);color:var(--pd-ink);border:1px solid var(--pd-control-line);border-radius:6px;padding:4px 8px}
    button{font-size:14px}#state{white-space:pre-wrap;overflow-wrap:anywhere}
    #prepare{display:inline-flex;align-items:center;gap:6px}
    #prepare svg{display:none;width:16px;height:16px;fill:none;stroke:var(--pd-success);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    #prepare[data-ready] svg{display:block}
    #state.ready{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  </style>`);
  document.body.innerHTML = `<main><h1 data-i18n="准备内置翻译"></h1><p data-i18n="选择要下载的语言对。"></p><form><label><span data-i18n="原文语言"></span><select id="source"><option value="" data-i18n="选择语言"></option></select></label><label><span data-i18n="目标语言"></span><select id="target"></select></label></form><button id="prepare" type="button"><span data-i18n="准备内置翻译"></span>${uiIcon('check')}</button><button id="cancel" data-i18n="取消" hidden></button><p id="state" role="status"></p></main>`;
  localize(document);
  document.documentElement.lang = getDisplayLocale();
  onDisplayLanguageChange(() => { document.documentElement.lang = getDisplayLocale(); localize(document); });
  const source = document.querySelector<HTMLSelectElement>('#source')!, target = document.querySelector<HTMLSelectElement>('#target')!;
  for (const tag of [...new Set(['zh-Hans', 'zh-Hant', ...TARGET_LANGUAGES.filter(l => l !== 'zh')])]) {
    const option = new Option('', tag), other = new Option('', tag);
    setText(option, languageLabel(tag)); setText(other, languageLabel(tag)); source.add(option); target.add(other);
  }
  const params = new URLSearchParams(location.search);
  source.value = params.get('source') ?? ''; target.value = params.get('target') || 'zh-Hans';
  if (!source.value) source.value = '';
  if (!target.value) target.value = 'zh-Hans';
  const prepare = document.querySelector<HTMLButtonElement>('#prepare')!, cancel = document.querySelector<HTMLButtonElement>('#cancel')!, state = document.querySelector('#state')!;
  let controller: AbortController | undefined;
  const updatePrepare = () => { prepare.disabled = !source.value || source.value === target.value; };
  function setPreparationStatus(label = '', ready = false) {
    prepare.toggleAttribute('data-ready', ready);
    state.classList.toggle('ready', ready);
    setText(state, label ? message(label) : '');
  }
  source.onchange = target.onchange = () => { setPreparationStatus(); updatePrepare(); };
  updatePrepare();
  cancel.onclick = () => controller?.abort();
  addEventListener('pagehide', () => controller?.abort());
  prepare.onclick = async () => {
    controller = new AbortController(); prepare.disabled = true; cancel.hidden = false; source.disabled = target.disabled = true;
    setPreparationStatus('正在准备内置翻译，首次使用可能需要较长时间…');
    try { await prepareNativeTranslation({source:source.value, target:target.value}, controller.signal); setPreparationStatus('语言模型已准备好。', true); }
    catch (error) { setPreparationStatus(controller.signal.aborted ? '已取消' : '无法准备此语言对的内置翻译。'); console.warn('[pd] native translation preparation failed', error); }
    finally { updatePrepare(); cancel.hidden = true; source.disabled = target.disabled = false; }
  };
}
