import { AI_ERROR_LABEL } from './aiErrorLabels';
import { AI_PRESETS, isAiProvider } from './aiConfig';
import { uiIcon } from './uiControls';
import { applyAppearance } from './appearance';
import { localize, onDisplayLanguageChange, message, setText, setLocalizedAttribute, materialLabel, languageLabel } from './i18n';
import { brandTokens, brandControls } from './brand';
import { selectionError, MAX_SELECTION_CHARS, type SelectionSnapshot } from './panel';
import { TARGET_LANGUAGES, isLanguageTag, normalizeLangTag, primaryOfLang } from './languages';
import { DEFAULT_SETTINGS, type Settings } from './settings';

interface SavedState { ok: boolean; changed?: boolean; vaultId: string | null; connected?: boolean; id?: string; written?: boolean; error?: string }
type Channel = Settings['selectionTranslationMode'];
export function createTranslationPopup(send: <T>(msg: unknown) => Promise<T>) {
  let active: { host: HTMLElement; openedAt: number; page: string; pinned: boolean; close: (restore: boolean) => void; constrain: () => void } | null = null;
  let documentPage = location.href;
  let lastPosition: {left: number; top: number} | null = null;
  const close = (restoreFocus = true) => active?.close(restoreFocus);
  onDisplayLanguageChange(() => { if (active) { localize(active.host.shadowRoot!); active.constrain(); } });
  const navigationTimer = setInterval(() => { if (location.href !== documentPage) { close(false); lastPosition = null; documentPage = location.href; } }, 250);

  function open(input: SelectionSnapshot, rect?: DOMRect | null) {
    close(false);
    if (documentPage !== location.href) {lastPosition = null;documentPage = location.href;}
    const snapshot = structuredClone(input), focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const host = document.createElement('div'); host.id = 'pd-translation';
    applyAppearance(host);
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const root = host.attachShadow({mode:'open'});
    const icon = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
    root.innerHTML = `<style>${brandTokens}:host{font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;color:var(--pd-ink);text-shadow:none;letter-spacing:normal;text-transform:none;font-weight:400}*{box-sizing:border-box}${brandControls}
      [hidden]{display:none!important}.card{pointer-events:auto;position:fixed;width:min(420px,calc(100vw - 24px));display:flex;flex-direction:column;background-color:var(--pd-paper);background-image:var(--pd-texture);background-position:center;background-size:620px;border-radius:12px;box-shadow:var(--pd-shadow)}
      button{min-height:32px;transition:background .12s,color .12s}button:active:not(:disabled){transform:translateY(1px)}button:disabled{cursor:default;opacity:1;color:var(--pd-muted)}svg{width:var(--pd-icon-size);height:var(--pd-icon-size);flex-shrink:0;fill:none;stroke:currentColor;stroke-width:var(--pd-icon-stroke);stroke-linecap:round;stroke-linejoin:round}
      header{display:flex;gap:2px;align-items:center;padding:10px 12px 2px 20px;cursor:move;touch-action:none;flex-shrink:0}header strong{font-size:13px;font-weight:600;flex:1}header button{cursor:pointer}.icon{display:inline-flex;align-items:center;justify-content:center;width:34px;min-height:34px;padding:0;background:transparent;border:0;color:var(--pd-muted)}.icon:hover,.quiet:hover{background:var(--pd-selected);color:var(--pd-ink)}#pin[aria-pressed=true]{background:var(--pd-selected);color:var(--pd-blue)}
      main{overflow:auto;overscroll-behavior:contain;padding:0 20px;min-height:0}p{white-space:pre-wrap;overflow-wrap:anywhere}#language-toggle{display:flex;align-items:center;gap:6px;max-width:100%;padding:3px 0;border:0;background:transparent;color:var(--pd-muted);font-size:12px;text-align:start}#language-toggle:hover{color:var(--pd-blue)}#language-toggle span{min-width:0;overflow-wrap:anywhere}#language-toggle svg{width:12px;height:12px}#language-toggle[aria-expanded=true] svg{transform:rotate(180deg)}
      .languages{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;margin:8px 0 12px}.languages label{min-width:0;font-size:11px;color:var(--pd-muted)}.languages select{width:100%;min-width:0;margin-top:2px;padding:4px 0;border:0;border-radius:4px;color:var(--pd-ink);background:transparent;font-size:13px}.languages select:hover,.languages select:open{background:var(--pd-nav)}
      #original{margin:12px 0 0;font-size:14px;line-height:1.6;color:var(--pd-muted)}#result{margin:12px 0 0;font-size:14px;line-height:1.6;color:var(--pd-ink)}#result:empty{display:none}#query-state{margin:12px 0 0;font-size:13px;color:var(--pd-muted)}#query-state:empty{display:none}.query-feedback{display:flex;flex-wrap:wrap;align-items:center;gap:8px}#retry-inline,#configure-ai{flex-shrink:0;border:0;background:transparent;padding:2px 0;color:var(--pd-blue);font-size:13px}
      main{padding-bottom:20px}footer{flex-shrink:0;padding:8px 12px 8px 20px;border-top:1px solid var(--pd-line)}.actions{display:flex;justify-content:flex-end;align-items:center;gap:2px}.actions button{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;min-height:34px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--pd-muted)}.actions button:hover{background:var(--pd-selected);color:var(--pd-ink)}.actions button:disabled{color:#91979a}#view{color:var(--pd-blue)}#view svg{fill:currentColor;stroke:currentColor}#save[aria-busy=true] svg{opacity:.5}#copy.copied{color:var(--pd-blue)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}#save-state,#channel-error{display:block;margin:4px 0;font-size:12px;color:var(--pd-muted);overflow-wrap:anywhere}#save-state:empty,#channel-error:empty{display:none}
      #more{anchor-name:--translation-more}#more[aria-expanded=true]{background:var(--pd-hover);color:var(--pd-ink)}
      #more-panel{position-anchor:--translation-more;inline-size:max-content;min-inline-size:0}#more-panel:popover-open{display:grid}
      #more-panel button{width:auto;min-height:var(--pd-control-size);justify-content:space-between;gap:12px;font-size:13px}
      #more-panel hr{margin:4px;border:0;border-top:1px solid var(--pd-line)}
      @media(max-width:360px){.languages{grid-template-columns:minmax(0,1fr)}header{padding-left:16px}main{padding:0 16px}footer{padding:10px 12px}}@media(prefers-reduced-motion:reduce){button{transition:none}}
    </style><section class="card" role="dialog"><header tabindex="0"><strong data-i18n="翻译"></strong><button id="pin" class="icon" aria-pressed="false" data-i18n-title="保持展开" data-i18n-aria-label="保持展开">${icon('<path d="m16 3 5 5-4 1-3 5-1 4-3-3-6 6 6-6-3-3 4-1 5-3z"/>')}</button><button id="more" class="icon" aria-expanded="false" aria-controls="more-panel" data-i18n-title="更多翻译操作" data-i18n-aria-label="更多翻译操作">${uiIcon('more')}</button><button id="close" class="icon" data-i18n-title="关闭翻译" data-i18n-aria-label="关闭翻译">${uiIcon('close')}</button></header>
      <div id="more-panel" class="ui-action-menu" popover="auto" role="group" data-i18n-aria-label="更多翻译操作">
        <button id="channel-regular" type="button" aria-pressed="false" disabled><span data-i18n="选区常规翻译"></span>${uiIcon('check')}</button>
        <button id="channel-ai" type="button" aria-pressed="false" disabled><span data-i18n="选区 AI 翻译"></span>${uiIcon('check')}</button>
        <hr><button id="retry" type="button" data-i18n="重新翻译" disabled></button>
      </div>
      <main><button id="language-toggle" aria-expanded="false" aria-controls="languages" data-i18n-title="调整本次翻译语言"><span id="direction"></span>${uiIcon('expand')}</button><div id="languages" class="languages" hidden><label><span data-i18n="原文语言"></span><select id="from"></select></label><label><span data-i18n="目标语言"></span><select id="to"></select></label></div><p id="original"></p><p id="result"></p><div class="query-feedback"><p id="query-state" role="status" data-i18n="正在加载…"></p><button id="retry-inline" data-i18n="重试" hidden></button><button id="configure-ai" data-i18n="打开设置填写 API key" hidden></button></div><small id="channel-error" role="status"></small></main>
      <footer><div class="actions"><button id="copy" class="quiet" disabled>${uiIcon('copy')}<span class="sr-only" id="copy-label" role="status" data-i18n="复制译文"></span></button><button id="save" class="primary" disabled>${uiIcon('bookmark')}<span class="sr-only" id="save-label" data-i18n="收藏原文"></span></button><button id="view" class="primary" data-i18n-title="查看收藏" data-i18n-aria-label="查看收藏" hidden>${uiIcon('saved')}<span class="sr-only" data-i18n="查看收藏"></span></button></div><small id="save-state" role="status"></small></footer></section>`;
    const card = root.querySelector<HTMLElement>('.card')!, header = root.querySelector<HTMLElement>('header')!;
    const node = (id: string) => root.getElementById(id)!;
    const button = (id: string) => node(id) as HTMLButtonElement;
    const from = node('from') as HTMLSelectElement, to = node('to') as HTMLSelectElement;
    const channelButtons = { regular: button('channel-regular'), ai: button('channel-ai') };
    const morePanel = node('more-panel');
    let mode = DEFAULT_SETTINGS.selectionTranslationMode;
    let changingMode = false;
    const sourceLang = snapshot.sourceLang && snapshot.languageEvidence !== 'heuristic' && isLanguageTag(snapshot.sourceLang) && snapshot.sourceLang !== 'und' ? normalizeLangTag(snapshot.sourceLang) : 'auto';
    let sourceManual = false;
    let owner: string | null = null, ownerReady = false, libraryChanged = false;
    let requestId = '', generation = 0, translated = '', detectedLang = '', targetManual = false, initialized = false, saving = false, savedId = '', copying = 0;
    let positioned = false, dragged = !!lastPosition;
    const state = {host, openedAt: performance.timeOrigin + performance.now(), page: location.href, pinned:false, close: finish, constrain};
    active = state;
    const current = () => active === state;
    const viewport = () => ({left:visualViewport?.offsetLeft ?? 0, top:visualViewport?.offsetTop ?? 0, width:visualViewport?.width ?? innerWidth, height:visualViewport?.height ?? innerHeight});
    function constrain() {
      if (!current()) return;
      const v = viewport();
      card.style.maxHeight = `${Math.max(0, v.height - 24)}px`;
      card.style.maxWidth = `${Math.max(0, v.width - 24)}px`;
      const box = card.getBoundingClientRect();
      let left = Number.parseFloat(card.style.left), top = Number.parseFloat(card.style.top);
      if (!positioned || !dragged) {
        left = rect?.left ?? v.left + v.width - box.width - 24;
        const below = (rect?.bottom ?? v.top + 56) + 8, above = (rect?.top ?? 0) - box.height - 8;
        top = below + box.height <= v.top + v.height - 12 ? below : above >= v.top + 12 ? above : below;
      }
      if (!positioned && lastPosition) { left = lastPosition.left; top = lastPosition.top; }
      card.style.left = `${Math.max(v.left + 12, Math.min(left, v.left + v.width - box.width - 12))}px`;
      card.style.top = `${Math.max(v.top + 12, Math.min(top, v.top + v.height - box.height - 12))}px`;
      positioned = true;
    }
    function finish(restore: boolean) {
      if (!current()) return;
      active = null; generation++; copying++;
      if (requestId) void send({type:'cancelOnline', requestId});
      observer.disconnect(); clearInterval(poll);
      window.removeEventListener('resize', constrain); visualViewport?.removeEventListener('resize', constrain); visualViewport?.removeEventListener('scroll', constrain); document.removeEventListener('fullscreenchange', fullscreen);
      host.remove(); if (restore && focus?.isConnected) focus.focus({preventScroll:true});
    }
    function fullscreen() { if (current()) { (document.fullscreenElement ?? document.documentElement).append(host); constrain(); } }
    function options(control: HTMLSelectElement, value: string, auto: boolean) {
      control.replaceChildren();
      for (const tag of [...new Set([...(auto ? ['auto'] : []), 'zh-Hans', 'zh-Hant', ...TARGET_LANGUAGES.filter(t => t !== 'zh'), value])]) {
        const option = document.createElement('option'); option.value = tag; setText(option, message(tag === 'auto' ? '自动检测' : '$language', tag === 'auto' ? undefined : {tag})); control.append(option);
      }
      control.value = value;
    }
    options(from, sourceLang, true); options(to, DEFAULT_SETTINGS.defaultComprehensionLang, false);
    setLocalizedAttribute(card, 'aria-label', message('选区翻译'));
    setLocalizedAttribute(header, 'aria-label', message('移动翻译卡（方向键）'));
    setLocalizedAttribute(from, 'aria-label', message('原文语言')); setLocalizedAttribute(to, 'aria-label', message('目标语言'));
    node('original').textContent = snapshot.text;
    direction();
    localize(root);
    (document.fullscreenElement ?? document.documentElement).append(host);
    constrain();
    const observer = new ResizeObserver(constrain); observer.observe(card);
    window.addEventListener('resize', constrain); visualViewport?.addEventListener('resize', constrain); visualViewport?.addEventListener('scroll', constrain); document.addEventListener('fullscreenchange', fullscreen);
    const poll = setInterval(() => {if (initialized && ownerReady && !saving) void refreshSaved(generation);}, 1200);
    function direction() {
      const source = from.value === 'auto' ? detectedLang ? languageLabel(detectedLang) : message('自动检测') : languageLabel(from.value);
      setText(node('direction'), message('{from} → {to}', {from:source, to:languageLabel(to.value)}));
    }
    const copyIcon = button('copy').querySelector('svg')!.innerHTML;
    function copyState(key: string) {
      const label = message(key);
      setText(node('copy-label'), label); setLocalizedAttribute(button('copy'), 'title', label); setLocalizedAttribute(button('copy'), 'aria-label', label);
      button('copy').classList.toggle('copied', key === '已复制');
      button('copy').querySelector('svg')!.innerHTML = key === '已复制' ? '<path d="m5 12 4 4L19 6"/>' : copyIcon;
    }
    copyState('复制译文');
    function saveControls() {
      button('save').disabled = !ownerReady || libraryChanged || saving || !!savedId || !requestId;
      const label = message(saving ? '正在保存…' : savedId ? '已收藏' : translated ? '收藏翻译' : '收藏原文');
      setText(node('save-label'), label); setLocalizedAttribute(button('save'), 'aria-label', label); setLocalizedAttribute(button('save'), 'title', label);
      button('save').setAttribute('aria-busy', String(saving));
      button('save').hidden = initialized && !!savedId;
      button('view').hidden = !initialized || !savedId; button('view').disabled = libraryChanged;
    }
    async function refreshSaved(version: number) {
      const r = await send<SavedState>({type:'selectionKnowledgeState', snapshot, sourceMode:from.value, targetLang:to.value, ...(ownerReady ? {vaultId:owner} : {})});
      if (!current() || version !== generation || saving) return;
      if (!r?.ok) { setText(node('save-state'), message(r?.error === 'extension-context-invalidated' ? '扩展已更新，请刷新当前网页' : '保存状态读取失败，请重试')); return; }
      if (!ownerReady) { owner = r.vaultId; ownerReady = true; }
      libraryChanged = !!r.changed;
      if (libraryChanged) { setText(node('save-state'), message('学习库已切换，请重新打开翻译卡')); saveControls(); return; }
      savedId = r.id ?? '';
      setText(node('save-state'), savedId && !r.written && (r.connected || owner) ? message('已保存在本机，待写入学习库') : '');
      setLocalizedAttribute(button('view'), 'title', r.written ? message('{source} · {text}', {source:message('查看收藏'),text:message('已写入学习库')}) : message('查看收藏'));
      saveControls();
    }
    async function run(fresh = false, changed = false) {
      if (!current() || !initialized) return;
      const error = selectionError(snapshot.text);
      if (error) { setText(node('query-state'), message(error, {limit:MAX_SELECTION_CHARS})); return; }
      const previousId = requestId, id = requestId = `selection-${crypto.randomUUID()}`, version = ++generation;
      if (changed) {
        for (const option of Object.values(channelButtons)) setChannelSource(option, '');
        saving = false; setText(node('save-state'),''); translated = ''; detectedLang = ''; savedId = ''; copying++; node('result').textContent = ''; copyState('复制译文');
      }
      button('copy').disabled = !translated; button('retry').disabled = true; button('retry-inline').hidden = true; button('configure-ai').hidden = true;
      setText(node('query-state'), message(translated ? '正在更新译文…' : '正在翻译…')); direction(); saveControls();
      void refreshSaved(version);
      const r = await send<import('@/lib/translationLearning').SelectionTranslationResult>({type:'translateSelection', mode, text:snapshot.text, snapshot, requestId:id, sourceLang:from.value, targetLang:to.value, fresh, ...(previousId ? {replaceRequestId:previousId} : {})});
      if (!current() || version !== generation) return;
      if (location.href !== state.page) { close(false); return; }
      button('retry').disabled = false;
      if (r?.ok) {
        const provider = r.source.slice(3);
        const label = isAiProvider(provider) ? AI_PRESETS[provider].label : r.source === 'browser-native' ? '浏览器内置翻译' : 'Google';
        setChannelSource(channelButtons[mode], materialLabel(label));
        translated = r.text; detectedLang = r.detectedLang ?? ''; node('result').textContent = translated;
        setText(node('query-state'), '');  direction();
      } else if (r?.error === 'extension-context-invalidated') {
        setText(node('query-state'), message('扩展已更新，请刷新当前网页')); button('retry').hidden = true;
      } else {
        button('retry-inline').hidden = false;
        button('configure-ai').hidden = mode !== 'ai' || !['no-key','auth','permission','invalid-config'].includes(r?.error ?? '');
        const aiReason = mode === 'ai' && r?.error && AI_ERROR_LABEL[r.error];
        const reason = aiReason ? message(aiReason) : r?.error === 'restricted' ? message('翻译服务限制访问，请稍后重试。原文已保留。')
          : r?.error === 'network' ? message('网络连接失败，请检查连接后重试。原文已保留。')
          : r?.error === 'http' && r.httpStatus ? message('翻译服务返回错误（HTTP {status}）。原文已保留。', {status:r.httpStatus})
          : r?.error === 'empty' || r?.error === 'bad-response' ? message('翻译服务未返回有效译文。原文已保留。')
          : message('翻译暂不可用，请重试。原文已保留。');
        setText(node('query-state'), translated ? message('更新失败，保留上次译文。{reason}', {reason}) : reason);
      }
      button('copy').disabled = !translated; saveControls(); constrain();
    }
    button('close').onclick = () => close();
    button('pin').onclick = () => { state.pinned = !state.pinned; button('pin').setAttribute('aria-pressed', String(state.pinned)); };
    function setChannelSource(option: HTMLButtonElement, label: ReturnType<typeof materialLabel>) {
      setLocalizedAttribute(option, 'title', label);
      setLocalizedAttribute(option, 'aria-description', label);
    }
    function renderChannels() {
      for (const [choice, option] of Object.entries(channelButtons)) {
        option.setAttribute('aria-pressed', String(initialized && mode === choice));
        option.disabled = !initialized || changingMode;
      }
    }
    function more(open: boolean, restoreFocus = false) {
      if (open && !morePanel.matches(':popover-open')) morePanel.showPopover();
      if (!open && morePanel.matches(':popover-open')) morePanel.hidePopover();
      button('more').setAttribute('aria-expanded',String(open));
      if (restoreFocus) button('more').focus({preventScroll:true});
      if (open) {
        languages(false);
        const selected = channelButtons[mode];
        (selected.disabled ? button('retry') : selected).focus({preventScroll:true});
      }
    }
    function languages(open: boolean, restoreFocus = false) {
      node('languages').hidden = !open; button('language-toggle').setAttribute('aria-expanded',String(open));
      if (restoreFocus) button('language-toggle').focus({preventScroll:true});
      if (open) { more(false); from.focus({preventScroll:true}); }
      constrain();
    }
    button('more').onclick = () => more(!morePanel.matches(':popover-open'));
    morePanel.addEventListener('toggle', () => {
      button('more').setAttribute('aria-expanded', String(morePanel.matches(':popover-open')));
    });
    button('language-toggle').onclick = () => languages(node('languages').hidden);
    button('retry').onclick = () => {more(false,true);void run(true);};
    button('retry-inline').onclick = () => void run(true);
    root.addEventListener('pointerdown', e => {
      const path = e.composedPath();
      if (!path.includes(morePanel) && !path.includes(button('more'))) more(false);
    });
    button('configure-ai').onclick = () => void send({type:'openSettings', ai:true});
    async function changeChannel(next: Channel) {
      if (!initialized || changingMode) return;
      more(false,true);
      if (next === mode) return;
      changingMode = true;
      renderChannels();
      setText(node('channel-error'), '');
      try {
        const result = await send<{ok:boolean}>({type:'setSetting', name:'selectionTranslationMode', value:next});
        if (!result?.ok) throw new Error('setting write failed');
        if (!current()) return;
        mode = next;
        void run(false,true);
      } catch {
        if (current()) setText(node('channel-error'), message('保存失败，请重试'));
      } finally {
        changingMode = false;
        if (current()) renderChannels();
      }
    }
    channelButtons.regular.onclick = () => void changeChannel('regular');
    channelButtons.ai.onclick = () => void changeChannel('ai');
    from.onchange = () => { sourceManual = true; void run(false,true); };
    to.onchange = () => { targetManual = true; void run(false,true); };
    button('copy').onclick = async () => {
      const version = generation, attempt = ++copying;
      try { await navigator.clipboard.writeText(translated); if (current() && version === generation && attempt === copying) copyState('已复制'); }
      catch { if (current() && version === generation && attempt === copying) copyState('复制失败，请重试'); }
    };
    button('save').onclick = async () => {
      if (button('save').disabled) return;
      saving = true; saveControls(); const version = generation;
      const r = await send<{ok:boolean;id?:string;error?:string}>({type:'saveSelectionKnowledge',requestId,vaultId:owner});
      if (!current() || version !== generation) return;
      saving = false;
      if (r?.ok) { savedId = r.id ?? ''; await refreshSaved(version); }
      else setText(node('save-state'), message(r?.error === 'conflict' ? '学习库已切换，请重新打开翻译卡' : '保存失败，请重试'));
      saveControls();
    };
    button('view').onclick = async () => {
      const version = generation;
      const r = await send<{ok:boolean;error?:string}>({type:'viewSelectionKnowledge',id:savedId,vaultId:owner});
      if (current() && version === generation && !r?.ok) setText(node('save-state'), message(r?.error === 'conflict' ? '学习库已切换，请重新打开翻译卡' : '收藏已删除或无法打开'));
    };
    const move = (left: number, top: number) => { dragged = true; card.style.left = `${left}px`; card.style.top = `${top}px`; constrain(); lastPosition = {left:parseFloat(card.style.left),top:parseFloat(card.style.top)}; };
    header.onpointerdown = e => {
      if (e.button !== 0 || (e.target as Element).closest('button,a,input,select,label')) return;
      e.preventDefault(); header.focus({preventScroll:true}); header.setPointerCapture(e.pointerId);
      const startX=e.clientX,startY=e.clientY,left=parseFloat(card.style.left),top=parseFloat(card.style.top);
      header.onpointermove = event => { if(header.hasPointerCapture(event.pointerId)) move(left+event.clientX-startX,top+event.clientY-startY); };
      header.onpointerup = event => { if(header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId); header.onpointermove=null; };
    };
    header.onkeydown = e => {
      if (e.target !== header) return;
      const delta: Record<string,[number,number]> = {ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]};
      const d=delta[e.key]; if(d){e.preventDefault();move(parseFloat(card.style.left)+d[0],parseFloat(card.style.top)+d[1]);}
    };
    host.addEventListener('keydown', e => { e.stopPropagation(); if(e.key === 'Escape'){if(root.querySelector('select:open')) return; e.preventDefault(); if(morePanel.matches(':popover-open')) more(false,true); else if(!node('languages').hidden) languages(false,true); else close();} });
    host.addEventListener('mousedown', e => e.stopPropagation());
    button('close').focus({preventScroll:true});
    void send({type:'selectionSnapshot',snapshot});
    const openingGeneration = generation;
    void (async () => {
      const [r] = await Promise.all([send<{ok:boolean;settings?:Settings}>({type:'getSettings'}), refreshSaved(openingGeneration)]);
      if (!current() || generation !== openingGeneration) return;
      if (!targetManual) options(to, r?.settings?.defaultComprehensionLang ?? DEFAULT_SETTINGS.defaultComprehensionLang, false);
      // A whole-page language hint cannot establish the selected text's language when
      // it would bypass translation entirely (e.g. English text on a zh-CN page).
      if (!sourceManual && snapshot.languageEvidence === 'element' && from.value !== 'auto'
        && primaryOfLang(from.value) === primaryOfLang(to.value)) from.value = 'auto';
      mode = r?.settings?.selectionTranslationMode ?? DEFAULT_SETTINGS.selectionTranslationMode;
      initialized = true;
      renderChannels();
      void run(false,true);
    })();
  }
  document.addEventListener('pointerdown', e => { if(active && !active.pinned && !e.composedPath().includes(active.host)) close(false); }, true);
  document.addEventListener('pd-popup-outside', e => { const at=(e as CustomEvent<{at?:number}>).detail?.at; if(active && !active.pinned && (at===undefined || at>=active.openedAt)) close(false); });
  window.addEventListener('pagehide', () => {close(false);lastPosition=null;clearInterval(navigationTimer);});
  return {open,close};
}
