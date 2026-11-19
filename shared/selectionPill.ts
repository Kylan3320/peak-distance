import { applyAppearance } from './appearance';
import { localize, onDisplayLanguageChange, message, setText, setLocalizedAttribute, type UiText } from './i18n';
// 选区浮条（选区查词 spec 的单层入口）：普通网页 / X 与 YouTube 页面正文共用。
// 分类表驱动按钮：word=查词+添加到对话；phrase=查词+翻译+添加到对话；
// sentence=翻译+添加到对话。查词用有效表达（补残缺词边界、去词外标点），
// 翻译与附加用原始选区（不改写）；选区形成即固定候选（文本、来源、位置与
// 局部上下文）。来源、轻提示与「继续问」由调用方注入，跳过条件可扩展
// （YouTube 用它排除字幕栏等自身 UI 内的选区）。
import { brandTokens, sharedControls, CHAT_ADD_ICON } from './brand';
import selectionActionStyles from './selectionActions.css?inline';
import { actionMenu, iconButton } from './uiControls';
import { detectTextLanguage } from './tokenize';
import { classifyRangeIn, inlineRunContainer, readingText } from './selection';
import { materialFromCandidate, type SelectionCandidate, type SourceDescriptor } from './chat';
import type { LookupPopup } from './lookupPopup';
import { isLanguageTag, normalizeLangTag } from './languages';
import type { SelectionSnapshot } from './panel';
import type { PillVisibilityChoice, PillVisibilityUndo } from './selectionVisibility';

export const PILL_ID = 'blc-lookup-pill';
const visibilityOptions = {
  page: ['本页不再显示', '本页已隐藏浮条'],
  hour: ['暂停 1 小时', '所有网页已暂停 1 小时'],
  day: ['暂停 1 天', '所有网页已暂停 1 天'],
} as const;

export interface PillSelectionInfo {
  /** 原始选区（翻译/附加用；不改写）。 */
  raw: string;
  kind: 'word' | 'phrase' | 'sentence';
  hasWord: boolean;
  /** 有效查词表达（补齐残缺词、去词外标点）；无法定位为 null。 */
  expression: string | null;
  /** 所在正文块的包含原句；无可靠原句为 null。 */
  sentence: string | null;
  blockText: string;
  source: SourceDescriptor | null;
  sourceLang?: string;
  lookupLang: string;
  rect: DOMRect | null;
}

export interface SelectionPillDeps {
  send: <T>(msg: unknown) => Promise<T>;
  lookup: LookupPopup;
  translation: { open(snapshot: SelectionSnapshot, rect?: DOMRect | null): void; close(restoreFocus?: boolean): void };
  /** 选区来源（X 绑定被选帖子；YouTube 页面正文按当前地址的 article 源）。 */
  buildSource: () => SourceDescriptor | null;
  /** 页面内轻提示（网页与播放器样式不同，由调用方提供）。 */
  toast: (text: string | UiText) => void;
  /** 词卡「继续问」：附加词卡表达与可靠原句（可带已有释义），不发新查询。 */
  onContinueAsk?: (ctx: { snapshot: { expression: string; sentence?: string }; definition: string | null }) => void;
  /** 额外跳过条件：自身其它 UI（如字幕栏、选区操作条、词卡）内的选区不产生入口。 */
  skipSelection?: (sel: Selection) => boolean;
}

function editableTarget(sel: Selection): boolean {
  const node = sel.anchorNode;
  const el =
    node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
  if (!el) return true;
  return !!el.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
  );
}

export function createSelectionPill(deps: SelectionPillDeps) {
  const { send, lookup, translation } = deps;

  let dismissedRange: Range | null = null;
  let dismissedText = '';
  let selectionTimer: ReturnType<typeof setTimeout> | null = null;
  let currentInfo: PillSelectionInfo | null = null;
  let pushedCandidateKey = '';
  let revision = 0;
  let pendingDisplay = false;
  let selecting = false;
  let notice: HTMLElement | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const stopLocalizing = onDisplayLanguageChange(() => {
    const root = document.getElementById(PILL_ID)?.shadowRoot;
    if (root) localize(root);
    if (notice?.shadowRoot) localize(notice.shadowRoot);
  });

  const sameDismissedSelection = () => {
    const s = document.getSelection();
    if (!s?.rangeCount || !dismissedRange) return false;
    const r = s.getRangeAt(0);
    return s.toString() === dismissedText && r.startContainer === dismissedRange.startContainer &&
      r.endContainer === dismissedRange.endContainer && r.startOffset === dismissedRange.startOffset && r.endOffset === dismissedRange.endOffset;
  };
  const dismissSelection = () => {
    const s = document.getSelection();
    dismissedRange = s?.rangeCount ? s.getRangeAt(0).cloneRange() : null;
    dismissedText = s?.toString() ?? '';
    if (selectionTimer) clearTimeout(selectionTimer);
    remove();
  };

  function blockElementOf(node: Node | null): Element | null {
    // 通用文本块检测（见 shared/selection.ts）：不依赖语义标签清单，
    // X / YouTube 页面正文等 div 结构同样得到正确的块
    return inlineRunContainer(node);
  }

  function evaluate(): PillSelectionInfo | null {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    if (editableTarget(sel)) return null;
    if (sel.anchorNode?.parentElement?.closest('#pd-floating-panel,#pd-translation')) return null;
    if (deps.skipSelection?.(sel)) return null;
    // 原始选区不改写（保留换行与大小写）；分类与展示在各自层面处理空白
    const raw = sel.toString().trim();
    if (!raw || raw.length > 20000) return null;
    let rect: DOMRect | null = null;
    try {
      rect = sel.getRangeAt(0).getBoundingClientRect();
    } catch {
      /* ignore */
    }
    const range = sel.getRangeAt(0);
    const startBlock = blockElementOf(range.startContainer);
    const endBlock = blockElementOf(range.endContainer);
    const blockText = readingText(startBlock).replace(/\s+/g, ' ').trim();
    const sourceLang = inheritedSelectionLanguage(range.startContainer);
    const script = detectTextLanguage(raw) ?? detectTextLanguage(blockText);
    const lang = sourceLang ?? (script === 'en' ? 'und' : script ?? 'und');
    // 未跨正文块时才有词/短语分类；跨块（或选区落在无块元素文本上）按句段处理。
    // 分类与有效表达的计算见 shared/selection.ts 的 classifyRangeIn
    const crossesBlock = !startBlock || startBlock !== endBlock;
    const cls = classifyRangeIn(startBlock, range, lang, { crossesBlock });
    return {
      raw,
      kind: cls?.kind ?? 'sentence',
      hasWord: cls?.hasWord ?? false,
      expression: cls?.expression ?? null,
      sentence: cls?.sentence ?? null,
      blockText: blockText.slice(0, 600),
      source: deps.buildSource(),
      sourceLang, lookupLang: lang,
      rect,
    };
  }

  // ---- 查词入口（pill：分类驱动按钮 + 添加到对话） -----------------------------

  function ensureHost(): HTMLElement {
    let host = document.getElementById(PILL_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = PILL_ID;
      applyAppearance(host);
      // 挂在文档最前：置于页面 AX 树开头，避免被大页面的元素截断隐藏
      document.documentElement.prepend(host);
      const root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        ${brandTokens}:host {display:block;text-shadow:none;letter-spacing:normal;text-transform:none;font-weight:400}
        ${sharedControls}${selectionActionStyles}
        .selection-actions .pill-visibility-trigger svg {width:12px;height:12px}
        .selection-actions .pill-visibility-menu {inline-size:max-content;min-inline-size:0;
          position-try-fallbacks:flip-inline,--pill-menu-beside,flip-block,flip-block flip-inline,--menu-scroll-below,--menu-scroll-above}
        @position-try --pill-menu-beside {position-area:inline-end span-block-end;align-self:start;justify-self:start;margin:0 6px}
        .selection-actions .pill-visibility-menu > button {display:flex;width:auto;height:auto;justify-content:flex-start;
          padding:6px 10px;color:var(--pd-ink);font:inherit;font-size:var(--pd-text-nav)}
      `;
      root.appendChild(style);
      const bar = document.createElement('div'); bar.className = 'selection-actions'; root.append(bar);
      const btn = iconButton('lookup', message('查词'));
      btn.id = 'lookup';
      bar.appendChild(btn);
      const translate = iconButton('translate', message('翻译'));
      translate.id = 'translate'; bar.append(translate);
      translate.addEventListener('click', () => {
        const info = evaluate() ?? currentInfo;
        if (!info) return;
        dismissSelection();
        lookup.close();
        // Translation preserves the actual selection and its frozen source.
        translation.open({ text: info.raw, url: info.source?.url ?? location.href, title: info.source?.title ?? document.title, ...(info.source ? {source:info.source} : {}), ...(info.sourceLang ? {sourceLang:info.sourceLang,languageEvidence:'element'} : {}) }, info.rect);
        remove();
      });
      const chat = document.createElement('button');
      chat.id = 'chat';
      chat.className = 'blc-chat-add';
      setLocalizedAttribute(chat, 'title', message('添加到对话'));
      setLocalizedAttribute(chat, 'aria-label', message('添加到对话'));
      chat.innerHTML = CHAT_ADD_ICON;
      bar.append(chat);
      const { wrap, trigger, menu } = actionMenu(message('浮条显示选项'), 'expand');
      trigger.classList.add('pill-visibility-trigger');
      menu.classList.add('pill-visibility-menu');
      menu.id = 'pill-visibility-menu';
      trigger.setAttribute('aria-controls', menu.id);
      trigger.setAttribute('aria-expanded', 'false');
      menu.addEventListener('toggle', () => {
        trigger.setAttribute('aria-expanded', String(menu.matches(':popover-open')));
      });
      for (const choice of Object.keys(visibilityOptions) as PillVisibilityChoice[]) {
        const option = document.createElement('button');
        option.type = 'button';
        option.value = choice;
        setText(option, message(visibilityOptions[choice][0]));
        if (choice !== 'page') setLocalizedAttribute(option, 'aria-label', message('所有网页：{action}', { action: message(visibilityOptions[choice][0]) }));
        option.onclick = async event => {
          if (menu.hasAttribute('aria-busy')) return;
          const url = location.href;
          menu.setAttribute('aria-busy', 'true');
          const result = await send<{ok: boolean; undo?: PillVisibilityUndo}>({type:'selectionVisibilitySet', choice, url});
          menu.removeAttribute('aria-busy');
          if (!result?.ok || !result.undo) { deps.toast(message('保存失败，请重试')); return; }
          if (menu.isConnected) dismissSelection();
          if (location.href === url) showVisibilityNotice(choice, url, result.undo, event.detail === 0);
        };
        menu.append(option);
      }
      bar.append(wrap);
      localize(root);
      chat.addEventListener('click', () => {
        const info = evaluate() ?? currentInfo;
        if (info) void attach(info);
      });
      // mousedown 阻止默认，避免点击入口时选区被清除
      host.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        const info = evaluate() ?? currentInfo;
        if (info) openLookup(info);
      });
    }
    return host;
  }

  function clearNotice(): void {
    clearTimeout(noticeTimer);
    notice?.remove();
    notice = undefined;
  }

  function showVisibilityNotice(choice: PillVisibilityChoice, url: string, undo: PillVisibilityUndo, focus: boolean): void {
    clearNotice();
    const host = document.createElement('div');
    host.id = 'pd-selection-visibility-notice';
    applyAppearance(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${brandTokens}
      :host {position:fixed;inset:auto 12px 32px;z-index:2147483647;display:flex;justify-content:center;pointer-events:none}
      div {display:flex;align-items:center;gap:12px;max-width:100%;padding:6px 8px 6px 12px;pointer-events:auto;
        border-radius:8px;background:var(--pd-surface);color:var(--pd-ink);box-shadow:var(--pd-menu-shadow);font:13px/1.5 var(--pd-font-ui)}
      button {min-height:34px;border:0;border-radius:6px;padding:0 8px;background:transparent;color:var(--pd-blue);font:inherit;cursor:pointer}
      button:hover {background:var(--pd-hover)}
      button:focus-visible {outline:2px solid var(--pd-blue)}
    </style><div><span role="status"></span><button type="button"></button></div>`;
    const button = root.querySelector('button')!;
    setText(root.querySelector('span')!, message(visibilityOptions[choice][1]));
    setText(button, message('撤销'));
    button.onclick = async () => {
      button.disabled = true;
      const result = await send<{ok: boolean}>({type:'selectionVisibilityRestore', url:choice === 'page' ? url : undefined, undo});
      if (notice === host) clearNotice();
      if (!result?.ok) deps.toast(message('撤销失败，请在设置中检查浮条状态'));
    };
    notice = host;
    document.documentElement.prepend(host);
    const expire = () => {
      clearTimeout(noticeTimer);
      if (!host.matches(':hover') && !root.activeElement) noticeTimer = setTimeout(clearNotice, 8000);
    };
    host.addEventListener('pointerenter', () => clearTimeout(noticeTimer));
    host.addEventListener('pointerleave', expire);
    host.addEventListener('focusin', () => clearTimeout(noticeTimer));
    host.addEventListener('focusout', expire);
    if (focus) button.focus({ preventScroll: true });
    expire();
  }

  function show(info: PillSelectionInfo): void {
    currentInfo = info;
    const host = ensureHost();
    // 分类表：word=查词+对话；phrase=查词+翻译+对话；sentence/无有效表达=翻译+对话
    host.shadowRoot!.querySelector<HTMLElement>('#lookup')!.hidden = info.kind === 'sentence' || !info.hasWord;
    host.shadowRoot!.querySelector<HTMLElement>('#translate')!.hidden = info.kind === 'word';
    const r = info.rect;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    host.style.position = 'fixed';
    const { width, height } = host.getBoundingClientRect();
    const x = Math.max(8, Math.min(r ? r.left : vw / 2, vw - width - 8));
    const below = r ? r.bottom + 6 : vh / 2;
    const preferredY = below + height <= vh - 8 ? below : (r?.top ?? vh) - height - 6;
    const y = Math.max(8, Math.min(preferredY, vh - height - 8));
    host.style.left = `${Math.round(x)}px`;
    host.style.top = `${Math.round(y)}px`;
    host.style.zIndex = '2147483646';
  }

  /** 有效阅读选区形成时固定候选（文本、来源、位置与局部上下文）。 */
  function pushCandidate(info: PillSelectionInfo): void {
    if (!info.source) return;
    const key = `${info.source.sourceKey}|${info.raw}`;
    if (key === pushedCandidateKey) return;
    pushedCandidateKey = key;
    void send({ type: 'selectionCandidateSet', candidate: candidateOf(info) });
  }

  function candidateOf(info: PillSelectionInfo, definition?: string): SelectionCandidate | null {
    if (!info.source) return null;
    return {
      at: Date.now(),
      pageUrl: location.href,
      text: info.raw,
      kind: info.kind,
      expression: info.kind === 'sentence' ? null : info.expression,
      lang: info.lookupLang,
      ...(info.sentence ? { sentence: info.sentence } : {}),
      source: info.source,
      ...(definition ? { definition } : {}),
    };
  }

  /** 点击「添加到对话」：直接附加并进入当前聊天；不先查词、不自动发送。 */
  async function attach(info: PillSelectionInfo): Promise<void> {
    const candidate = candidateOf(info);
    if (!candidate || !info.source) {
      deps.toast(message('当前选区无法附加，请重新选择'));
      return;
    }
    const built = materialFromCandidate(candidate);
    if (!built) { deps.toast(message('当前选区无法附加，请重新选择')); return; }
    const r = await send<{ ok: boolean; panelOpened?: boolean }>({
      type: 'chatEnsure',
      source: info.source,
      material: built.material,
      quote: built.quote,
      openPanel: true,
    });
    remove();
    // 材料附加成功与面板打开成功分别判断；写入失败不提示已附加
    if (!r?.ok) { deps.toast(message('附加失败，请重试')); return; }
    if (!r.panelOpened) deps.toast(message('已附加到当前对话：点扩展图标打开侧栏继续'));
  }

  function remove(): void {
    revision++;
    pendingDisplay = false;
    currentInfo = null;
    document.getElementById(PILL_ID)?.remove();
  }

  function openLookup(info: PillSelectionInfo): void {
    dismissSelection();
    translation.close();
    const expression = info.expression ?? info.raw;
    void send({ type: 'selectionSnapshot', snapshot: { text: info.raw, url: info.source?.url ?? location.href, title: info.source?.title ?? document.title, source:info.source ?? undefined, sourceLang:info.sourceLang, languageEvidence:info.sourceLang ? 'element' : undefined } });
    lookup.open({
      sourceMissing: !info.source,
      snapshot: {
        source: 'web',
        expression,
        sentence: info.sentence ?? info.blockText,
        url: info.source?.url ?? location.href,
        title: info.source?.title ?? document.title,
        lang: info.lookupLang,
      },
      onContinueAsk: deps.onContinueAsk,
    });
    remove();
  }

  async function refresh(allowShow = true): Promise<void> {
    if (selecting || !allowShow && !currentInfo) return;
    const info = evaluate();
    if (document.getSelection()?.isCollapsed) dismissedRange = null;
    if (sameDismissedSelection()) { remove(); return; }
    if (!info) {
      remove();
      return;
    }
    if (allowShow) pushCandidate(info);
    const url = location.href;
    const request = ++revision;
    pendingDisplay = allowShow;
    const result = await send<{ ok: boolean; suppressed?: boolean }>({ type:'selectionVisibilityGet', url });
    if (request !== revision) return;
    pendingDisplay = false;
    if (url !== location.href) return;
    if (result?.suppressed) remove();
    else if (allowShow) show(info);
  }

  function onMaybeSelection(): void {
    revision++;
    pendingDisplay = false;
    if (selectionTimer) clearTimeout(selectionTimer);
    if (!selecting) selectionTimer = setTimeout(() => void refresh(), 250);
  }

  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.shiftKey) onMaybeSelection();
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0) return;
    const host = document.getElementById(PILL_ID);
    if (host && event.composedPath().includes(host)) return;
    selecting = true;
    if (host) dismissSelection();
  };
  const onPointerEnd = (event: PointerEvent): void => {
    if (!event.isPrimary || !selecting) return;
    selecting = false;
    onMaybeSelection();
  };
  const onEscape = (event: KeyboardEvent): void => {
    const root = document.getElementById(PILL_ID)?.shadowRoot;
    if (event.key === 'Escape' && root && !root.querySelector(':popover-open')) dismissSelection();
  };
  const onVisibilityChanged = (event: {type?: string}): void => {
    if (event.type === 'selection-visibility-changed' && (currentInfo || pendingDisplay)) void refresh(pendingDisplay);
  };

  document.addEventListener('selectionchange', onMaybeSelection, true);
  document.addEventListener('mouseup', onMaybeSelection, true);
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerEnd, true);
  document.addEventListener('pointercancel', onPointerEnd, true);
  document.addEventListener('keydown', onEscape, true);
  browser.runtime.onMessage.addListener(onVisibilityChanged);

  return {
    /** 当前选区信息（供外部即时读取）。 */
    evaluate,
    remove,
    /** 站内导航（SPA）后清理旧浮条与候选去重键。 */
    reset() {
      remove();
      clearNotice();
      if (selectionTimer) clearTimeout(selectionTimer);
      dismissedRange = null;
      pushedCandidateKey = '';
    },
    dispose() {
      if (selectionTimer) clearTimeout(selectionTimer);
      remove();
      clearNotice();
      stopLocalizing();
      document.removeEventListener('selectionchange', onMaybeSelection, true);
      document.removeEventListener('mouseup', onMaybeSelection, true);
      document.removeEventListener('keyup', onKeyUp, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerEnd, true);
      document.removeEventListener('pointercancel', onPointerEnd, true);
      document.removeEventListener('keydown', onEscape, true);
      browser.runtime.onMessage.removeListener(onVisibilityChanged);
    },
  };
}

function inheritedSelectionLanguage(node: Node): string | undefined {
  let element = node instanceof Element ? node : node.parentElement;
  while (element) {
    if (element.hasAttribute('lang')) {
      const lang = element.getAttribute('lang');
      return isLanguageTag(lang) && lang !== 'und' ? normalizeLangTag(lang) : undefined;
    }
    element = element.parentElement ?? (element.getRootNode() instanceof ShadowRoot ? (element.getRootNode() as ShadowRoot).host : null);
  }
  return undefined;
}
