import {
  AI_PRESETS, aiReasoningOptions, defaultAiProfile, normalizeAiBaseUrl, readAiServices, supportsAiFast, validateAiProfile,
  type AiProfile, type AiProvider, type AiReasoningEffort, type AiServices,
} from './aiConfig';
import { message, setText, t } from './i18n';
import { uiIcon } from './uiControls';

export const aiSettingsMarkup = `<details id="ai-settings" class="settings-section settings-details settings-group ai-section">
  <summary data-i18n="AI 服务"></summary>
  <button id="ai-view" type="button" class="ui-icon-button" aria-controls="ai-card" disabled></button>
  <div id="ai-card" class="ai-card" hidden>
    <div id="ai-quick" hidden>
      <div class="ai-quick-head">
        <button id="ai-fast" type="button" class="ui-icon-button" aria-pressed="false" data-i18n-aria-label="Fast" data-i18n-title="Fast 按更高费率计费" hidden>${uiIcon('bolt')}</button>
        <button id="ai-model-entry" type="button" aria-controls="ai-card" aria-describedby="ai-current ai-effort" data-i18n-aria-label="编辑模型">
          <strong id="ai-effort"></strong><span id="ai-current"></span>
        </button>
        <button id="ai-reset" type="button" class="ui-icon-button" data-i18n-aria-label="服务商默认" data-i18n-title="服务商默认" hidden>${uiIcon('reset')}</button>
      </div>
      <div id="ai-slider" hidden>
        <div class="ai-track" aria-hidden="true"><div class="ai-fill"><i></i><i></i><i></i><i></i><i></i><i></i></div><div id="ai-ticks"></div></div>
        <input id="ai-reasoning" type="range" min="0" step="1" data-i18n-aria-label="推理强度">
      </div>
    </div>
    <fieldset id="ai-fields" hidden>
      <div class="ai-row"><label for="ai-provider" data-i18n="服务商"></label><select id="ai-provider"></select></div>
      <p id="ai-active-note" class="hint" hidden></p>
      <div class="ai-row"><label for="key" data-i18n="API Key"></label><button id="clear" class="ui-icon-button ui-danger" type="button" data-i18n-title="清除当前 Key" data-i18n-aria-label="清除当前 Key" hidden>${uiIcon('trash')}</button></div>
      <div class="ai-input-row"><input id="key" type="password" autocomplete="off" spellcheck="false" maxlength="4096"><button id="save" class="primary" type="button" data-i18n="保存配置" hidden></button></div>
      <div id="ai-clear-confirm" class="ai-clear-confirm" hidden>
        <span data-i18n="清除当前 Key"></span>
        <button id="ai-keep" type="button" data-i18n="取消"></button>
        <button id="ai-remove" type="button" class="ui-icon-button ui-danger" data-i18n-aria-label="确认清除密钥" data-i18n-title="确认清除密钥">${uiIcon('check')}</button>
      </div>
      <details id="ai-advanced" class="settings-details"><summary data-i18n="高级设置"></summary>
        <label class="ai-field"><span data-i18n="模型 ID"></span><input id="ai-model" type="text" spellcheck="false" maxlength="200"></label>
        <div class="ai-row"><label for="ai-protocol" data-i18n="接口格式"></label><select id="ai-protocol"><option value="openai" data-i18n="OpenAI 兼容"></option><option value="anthropic">Anthropic Messages</option><option value="gemini">Gemini</option></select></div>
        <label class="ai-field"><span data-i18n="API 地址（Base URL）"></span><input id="ai-url" type="url" spellcheck="false"></label>
      </details>
    </fieldset>
    <form id="ai-model-form" novalidate hidden>
      <label for="ai-model-quick" data-i18n="模型 ID"></label>
      <div class="ai-input-row"><input id="ai-model-quick" type="text" spellcheck="false" maxlength="200"><button id="ai-save-model" class="primary" type="submit" data-i18n="保存配置" hidden></button></div>
    </form>
    <div id="state" class="settings-status err" role="alert"></div>
  </div><span id="ai-announcement" class="ui-sr-only" role="status"></span>
</details>`;

const storageKeys = ['aiServices', 'deepseekApiKey'];
const effortLabels = { '': '服务商默认', off: '关闭推理', low: '低推理强度', high: '高推理强度', max: '最高推理强度' };
type View = 'quick' | 'connection' | 'model';

function sameEndpoint(a: AiProfile, b: AiProfile) {
  try { return a.protocol === b.protocol && normalizeAiBaseUrl(a.baseUrl) === normalizeAiBaseUrl(b.baseUrl); }
  catch { return false; }
}

export function mountAiSettings(section: HTMLDetailsElement) {
  const get = <T extends HTMLElement = HTMLElement>(id: string) => section.querySelector<T>('#' + id)!;
  const card = get('ai-card');
  const control = get<HTMLButtonElement>('ai-view');
  const provider = get<HTMLSelectElement>('ai-provider');
  const protocol = get<HTMLSelectElement>('ai-protocol');
  const key = get<HTMLInputElement>('key');
  const url = get<HTMLInputElement>('ai-url');
  const model = get<HTMLInputElement>('ai-model');
  const quickModel = get<HTMLInputElement>('ai-model-quick');
  const range = get<HTMLInputElement>('ai-reasoning');
  const fast = get<HTMLButtonElement>('ai-fast');
  const reset = get<HTMLButtonElement>('ai-reset');
  const advanced = get<HTMLDetailsElement>('ai-advanced');
  const fields = get<HTMLFieldSetElement>('ai-fields');
  const confirm = get('ai-clear-confirm');
  const save = get<HTMLButtonElement>('save');
  const modelSave = get<HTMLButtonElement>('ai-save-model');
  const modelEntry = get<HTMLButtonElement>('ai-model-entry');
  const clear = get<HTMLButtonElement>('clear');
  const panels = { quick: get('ai-quick'), connection: fields, model: get('ai-model-form') };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const drafts = new Map<AiProvider, { profile: AiProfile; keyInput: string }>();
  let services: AiServices | undefined;
  let selected: AiProvider = 'deepseek';
  let view: View = 'quick';
  let revealOnLoad = false;
  let busy = false;
  let levels: (AiReasoningEffort | '')[] = [''];
  let dragging = false;
  let nextEffort: {value: AiReasoningEffort | undefined} | undefined;
  let animation: Animation | undefined;

  const active = () => services?.profiles[services.active];
  const providerLabel = (value: AiProvider) => ['glm', 'kimi', 'custom'].includes(value) ? t(AI_PRESETS[value].label) : AI_PRESETS[value].label;
  for (const value of Object.keys(AI_PRESETS) as AiProvider[]) provider.add(new Option(providerLabel(value), value));

  function report(label = '') {
    setText(get('state'), label ? message(label) : '');
    if (label) {
      section.open = true;
      card.hidden = false;
    }
  }

  function announce(label: string) {
    setText(get('ai-announcement'), message(label));
  }

  function drawEffort() {
    const label = t(effortLabels[levels[Number(range.value)] ?? '']);
    get('ai-effort').textContent = levels.length > 1 ? label : '';
    range.setAttribute('aria-valuetext', label);
    get('ai-slider').style.setProperty('--fill', String(Number(range.value) / Math.max(1, levels.length - 1)));
    for (const [index, tick] of [...get('ai-ticks').children].entries()) {
      tick.toggleAttribute('data-selected', index <= Number(range.value));
    }
  }

  function render() {
    const profile = active();
    const configured = !!profile?.apiKey;
    control.disabled = !services || busy;
    control.innerHTML = uiIcon(view === 'quick' ? 'key' : 'back');
    control.dataset.saved = String(configured);
    const label = view !== 'quick' ? t('返回') : t(configured ? '编辑 AI 连接' : '配置 AI 服务');
    control.title = label;
    control.setAttribute('aria-label', label);
    control.setAttribute('aria-description', t(configured ? '密钥已保存' : '未配置'));
    card.hidden = !configured && view === 'quick' && !get('state').textContent;
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== view || (name === 'quick' && !configured);
    fields.disabled = busy;
    quickModel.disabled = busy;
    modelSave.disabled = busy;
    modelEntry.disabled = busy;
    fast.setAttribute('aria-disabled', String(busy));
    reset.setAttribute('aria-disabled', String(busy));
    if (configured) {
      get('ai-current').textContent = profile.model;
      const options = aiReasoningOptions(profile);
      const nextLevels: typeof levels = ['', ...(['off', 'low', 'high', 'max'] as const).filter(value => Object.hasOwn(options, value))];
      if ((!dragging && !busy) || nextLevels.join() !== levels.join()) {
        levels = nextLevels;
        range.max = String(levels.length - 1);
        range.value = String(Math.max(0, levels.indexOf((nextEffort ? nextEffort.value : profile.reasoningEffort) ?? '')));
      }
      const ticks = get('ai-ticks');
      if (ticks.childElementCount !== levels.length) {
        ticks.replaceChildren(...levels.map(() => document.createElement('i')));
      }
      get('ai-slider').hidden = levels.length < 2;
      fast.hidden = !supportsAiFast(profile);
      fast.setAttribute('aria-pressed', String(!fast.hidden && profile.serviceTier === 'fast'));
      get('ai-slider').dataset.fast = fast.getAttribute('aria-pressed')!;
      reset.hidden = !profile.reasoningEffort;
      drawEffort();
    }
    if (view === 'connection') renderDraft();
  }

  function draft() {
    const saved = services?.profiles[selected];
    const profile: AiProfile = { protocol: protocol.value as AiProfile['protocol'], baseUrl: url.value.trim(), model: model.value.trim(), apiKey: key.value.trim() };
    if (saved && sameEndpoint(saved, profile)) {
      profile.apiKey ||= saved.apiKey;
      if (saved.reasoningEffort && Object.hasOwn(aiReasoningOptions(profile), saved.reasoningEffort)) profile.reasoningEffort = saved.reasoningEffort;
      if (saved.serviceTier && supportsAiFast(profile)) profile.serviceTier = saved.serviceTier;
    }
    return profile;
  }

  function renderDraft() {
    const saved = services?.profiles[selected] ?? defaultAiProfile(selected);
    const next = draft();
    save.hidden = selected === services?.active && !(['apiKey', 'protocol', 'baseUrl', 'model'] as const).some(field => saved[field] !== next[field]);
    clear.hidden = !saved.apiKey || !confirm.hidden;
    const note = get('ai-active-note');
    const current = active();
    note.hidden = selected === services?.active || !current?.apiKey;
    if (!note.hidden && current && services) {
      setText(note, message('当前使用：{provider} · {model}', { provider: providerLabel(services.active), model: current.model }));
    }
  }

  function loadDraft() {
    const pending = drafts.get(selected);
    const profile = pending?.profile ?? services?.profiles[selected] ?? defaultAiProfile(selected);
    provider.value = selected;
    protocol.value = profile.protocol;
    url.value = profile.baseUrl;
    model.value = profile.model;
    key.value = pending?.keyInput ?? '';
    confirm.hidden = true;
    advanced.open = selected === 'custom';
  }

  function switchView(next: View, focus = true) {
    animation?.cancel();
    const before = card.offsetHeight;
    view = next;
    report();
    if (next === 'connection') {
      selected = services?.active ?? 'deepseek';
      drafts.clear();
      loadDraft();
    }
    if (next === 'model') {
      quickModel.value = active()?.model ?? '';
      modelSave.hidden = true;
    }
    render();
    if (focus) (next === 'connection' ? key : next === 'model' ? quickModel : control).focus({ preventScroll: true });
    if (!before || card.hidden || reducedMotion.matches || !section.open) return;
    animation = card.animate([{ height: before + 'px' }, { height: card.offsetHeight + 'px' }], { duration: 230, easing: 'cubic-bezier(.2,.72,.28,1)' });
    panels[next].animate([{ opacity: .4, transform: 'translateX(' + (next === 'quick' ? -9 : 9) + 'px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: 200, easing: 'ease-out' });
  }

  function show(reveal = false) {
    section.open = true;
    if (!reveal) return;
    if (!services) revealOnLoad = true;
    else if (view === 'quick' && !active()?.apiKey) switchView('connection', false);
    section.scrollIntoView({ block: 'start' });
  }

  function load(stored: Record<string, unknown>) {
    if (busy) return;
    services = readAiServices(stored);
    if (revealOnLoad) {
      revealOnLoad = false;
      if (!active()?.apiKey) switchView('connection', false);
    }
    render();
  }

  async function mutate(change: (latest: AiServices) => void) {
    return navigator.locks.request('peak-distance-ai-services', async () => {
      const latest = readAiServices(await browser.storage.local.get(storageKeys));
      change(latest);
      await browser.storage.local.set({ aiServices: latest });
      return latest;
    });
  }

  async function perform(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    render();
    try { await action(); }
    catch { report('保存失败，请重试'); }
    finally {
      busy = false;
      render();
      if (view === 'quick' && document.activeElement === document.body) control.focus({ preventScroll: true });
      if (nextEffort) commitEffort();
    }
  }

  function updateActive(change: (current: AiProfile) => AiProfile, returnToQuick = false) {
    const target = services?.active;
    const opened = active();
    if (!target || !opened?.apiKey) return;
    void perform(async () => {
      services = await mutate(latest => {
        const current = latest.profiles[target];
        if (latest.active !== target || !current || current.apiKey !== opened.apiKey || !sameEndpoint(opened, current) || current.model !== opened.model) throw Error('configuration changed');
        latest.profiles[target] = change(current);
      });
      report();
      if (returnToQuick) switchView('quick', false);
      announce('已保存');
    });
  }

  control.onclick = () => switchView(view === 'quick' ? 'connection' : 'quick');
  modelEntry.onclick = () => switchView('model');
  section.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || view === 'quick' || busy || section.querySelector('select:open')) return;
    event.preventDefault();
    event.stopPropagation();
    switchView('quick');
  });
  provider.onchange = () => {
    drafts.set(selected, { profile: draft(), keyInput: key.value });
    selected = provider.value as AiProvider;
    loadDraft();
    report();
    renderDraft();
  };
  for (const input of [key, url, model, protocol]) input.oninput = () => { report(); renderDraft(); };
  quickModel.oninput = () => { report(); modelSave.hidden = quickModel.value.trim() === active()?.model; };
  get<HTMLFormElement>('ai-model-form').onsubmit = event => {
    event.preventDefault();
    const current = active();
    const value = quickModel.value.trim();
    if (!current || current.model === value) return;
    const profile = { ...current, model: value };
    if (profile.reasoningEffort && !Object.hasOwn(aiReasoningOptions(profile), profile.reasoningEffort)) delete profile.reasoningEffort;
    if (!supportsAiFast(profile)) delete profile.serviceTier;
    const error = validateAiProfile(profile);
    if (error) { report(error); return; }
    updateActive(latest => {
      const next = { ...latest, model: value };
      if (next.reasoningEffort && !Object.hasOwn(aiReasoningOptions(next), next.reasoningEffort)) delete next.reasoningEffort;
      if (!supportsAiFast(next)) delete next.serviceTier;
      return next;
    }, true);
  };

  range.onpointerdown = () => { dragging = true; };
  range.onpointerup = range.onpointercancel = () => { dragging = false; };
  range.oninput = drawEffort;
  function commitEffort() {
    if (busy || !nextEffort) return;
    const { value } = nextEffort;
    nextEffort = undefined;
    updateActive(current => ({ ...current, reasoningEffort: value }));
  }
  range.onchange = () => {
    nextEffort = { value: levels[Number(range.value)] || undefined };
    dragging = false;
    commitEffort();
  };
  reset.onclick = () => {
    if (busy) return;
    range.value = '0';
    drawEffort();
    nextEffort = { value: undefined };
    commitEffort();
  };
  fast.onclick = () => updateActive(current => ({ ...current, serviceTier: current.serviceTier === 'fast' ? 'default' : 'fast' }));

  save.onclick = () => {
    const profile = draft();
    const error = validateAiProfile(profile);
    if (error) { report(error); return; }
    const target = selected;
    profile.baseUrl = normalizeAiBaseUrl(profile.baseUrl);
    void perform(async () => {
      // Browser permissions must be requested within the save gesture.
      if (!await browser.permissions.request({ origins: [new URL(profile.baseUrl).origin + '/*'] })) {
        report('未获得该 API 地址的访问权限，配置未更改。再次保存可重试。');
        return;
      }
      services = await mutate(latest => {
        const previous = latest.profiles[target];
        if (previous && sameEndpoint(previous, profile)) {
          profile.reasoningEffort = previous.reasoningEffort && Object.hasOwn(aiReasoningOptions(profile), previous.reasoningEffort) ? previous.reasoningEffort : undefined;
          profile.serviceTier = supportsAiFast(profile) ? previous.serviceTier : undefined;
        }
        latest.active = target;
        latest.profiles[target] = profile;
      });
      drafts.clear();
      key.value = '';
      switchView('quick', false);
      announce('已保存并启用');
    });
  };
  key.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !save.hidden && !busy) save.click();
  });

  clear.onclick = () => { confirm.hidden = false; renderDraft(); get('ai-keep').focus(); };
  get('ai-keep').onclick = () => { confirm.hidden = true; renderDraft(); clear.focus(); };
  get('ai-remove').onclick = () => {
    const target = selected;
    void perform(async () => {
      try {
        services = await mutate(latest => {
          latest.profiles[target] = { ...latest.profiles[target] ?? defaultAiProfile(target), apiKey: '' };
        });
        if (target === 'deepseek') await browser.storage.local.remove('deepseekApiKey');
        drafts.delete(target);
        loadDraft();
        report();
        announce('密钥已清除');
      } catch { report('清除失败，请重试'); }
    });
  };
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.aiServices || changes.deepseekApiKey)) {
      void browser.storage.local.get(storageKeys).then(load, () => report('设置读取失败，请重新打开设置重试'));
    }
  });

  return { load, show, report, localize() {
    for (const option of provider.options) option.textContent = providerLabel(option.value as AiProvider);
    render();
    drawEffort();
  } };
}
