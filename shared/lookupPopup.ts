import { applyAppearance } from './appearance';
import { t as tr, localize, onDisplayLanguageChange , message, setText, setLocalizedAttribute, type UiText } from './i18n';
import { brandTokens, sharedControls } from './brand';
import type { DictionarySource } from '@/lib/onlineDictionary';
// 共用查词弹窗（网页与 YouTube 字幕共用，M1 行为原样提取）：
//   Shadow DOM 卡片、宿主 fixed+inset:0+满 z-index（不被页面悬浮层盖住）、
//   标题行拖动、Esc 关闭、快照在打开时固定（保存/释义都用这一份）、
//   弹窗替换后丢弃旧响应，保存结果以数据库响应为准。
// 来源差异（网页 URL / 视频轨道+时间）只体现在 snapshot 类型与 subLine 附加行。

import type {
  BgcError,
  GetEntryResult,
  LookupResult,
  OnlineLookupResult,
  SaveResult,
} from '@/shared/messages';
import {
  normalizeExpression,
  isDuplicateContext,
  isDuplicateVideoContext,
  type LookupSnapshot,
  type LearningResult,
  type ContextExplanation,
} from '@/shared/vocab';
import { entryKeyOf } from './languages';
import { readingIcon, readingIconStyles, animateBookmark } from './readingIcons';

export const POPUP_ID = 'blc-lookup-popup';

// 纸纹背景地址在注入期解析一次并复用：扩展重载/更新后，残留旧标签页里的
// content script 在事件期（首次打开词卡）再调 runtime.getURL 会抛
// Extension context invalidated；地址本身不变，注入期上下文必然有效。

export interface PopupOpenArgs {
  snapshot: LookupSnapshot;
  anchor?: HTMLElement;
  compact?: boolean;
  /** 上下文下的附加行（视频：时间 + 相邻字幕）。 */
  subLine?: string;
  /** 弹窗关闭后回调（视频：恢复播放判定在此实现）。 */
  onClose?: () => void;
  /** M5「继续问」：转入侧栏问答并带入引用（提供时才显示该按钮）。 */
  onContinueAsk?: (ctx: {
    snapshot: LookupSnapshot;
    definition: string | null;
    subLine?: string;
  }) => void;
}

export interface LookupPopup {
  open(args: PopupOpenArgs): void;
  /** silent：不触发 onClose（页面卸载 / 主动清理）。 */
  close(silent?: boolean): void;
  isOpen(): boolean;
  expand(): void;
  isCompact(): boolean;
  host(): HTMLElement | null;
}

interface PinnedState {
  anchor?: HTMLElement;
  compact?: boolean;
  snapshot: LookupSnapshot;
  subLine: string | undefined;
  onClose: (() => void) | undefined;
  onContinueAsk: PopupOpenArgs['onContinueAsk'];
  savedContextId: number | null;
  vaultId?: string | null;
  checkingSaved: boolean;
  saving?: boolean;
  saveError?: boolean;
  definition: string | null;
  result?: LearningResult;
  explanation?: ContextExplanation;
  source?: DictionarySource;
  lookupRequest?: string;
  aiRequest?: string;
  aiError?: string;
  note: string | undefined;
  lookupError: string | undefined;
  degraded?: Extract<OnlineLookupResult, { ok: true }>['degraded'];
}

const ERROR_LABEL: Record<string, string> = {
  'invalid-config': 'AI 配置无效，请在设置中检查接口与模型',
  permission: '请在设置中重新保存 AI 配置并允许访问服务地址',
  'no-key': '尚未配置 API key，可先保存原文',
  auth: 'API key 无效或无权限',
  'rate-limit': '请求过于频繁，稍后再试',
  network: '网络错误',
  http: '服务返回异常',
  'bad-response': '服务响应无法解析',
};
const LOOKUP_ERROR_LABEL: Record<string, string> = {
  'not-found': '未查到该表达',
  'extension-context-invalidated': '扩展已更新，请刷新当前网页',
};

export function createLookupPopup(opts: {
  send: <T>(msg: unknown) => Promise<T>;
  /** 宿主挂载点（默认 documentElement；全屏时由调用方移动节点）。 */
  mountParent?: () => HTMLElement | null;
}): LookupPopup {
  onDisplayLanguageChange(()=>{
    const root = document.getElementById(POPUP_ID)?.shadowRoot;
    if (root) {
      localize(root);
      const card = root.querySelector<HTMLDivElement>('.card');
      if (card) applyDragPos(card);
    }
  });
  const send = opts.send;
  const playerUrl = browser.runtime.getURL('/dictionary-audio.html');
  let pinned: PinnedState | null = null;
  let requestCounter = 0;
  // 拖动后的卡片位置（null = 仍锚定右上角），跨渲染保留
  let anchorRect: DOMRect | null = null;
  let openedAt = 0;
  let dragPos: { x: number; y: number } | null = null;

  function applyDragPos(card: HTMLDivElement): void {
    if (pinned?.anchor) {
      if (pinned.anchor.isConnected) anchorRect = pinned.anchor.getBoundingClientRect();
      const r = anchorRect; if (!r) return;
      const panel = document.fullscreenElement?.querySelector<HTMLElement>('#blc-learning-panel');
      const inSubtitles = (pinned.anchor.getRootNode() as ShadowRoot).host?.id === 'blc-subs';
      const right = panel && inSubtitles ? panel.getBoundingClientRect().left - 8 : innerWidth;
      card.style.maxWidth = `${Math.max(160, right - 16)}px`;
      const width = card.offsetWidth, height = card.offsetHeight;
      card.style.right = 'auto';
      card.style.left = `${Math.max(8, Math.min(r.left, right - width - 8))}px`;
      card.style.top = `${Math.max(8, Math.min(r.top >= height + 8 ? r.top - height - 6 : r.bottom + 6, innerHeight - height - 8))}px`;
      return;
    }
    if (dragPos) {
      card.style.left = `${dragPos.x}px`;
      card.style.top = `${dragPos.y}px`;
      card.style.right = 'auto';
    }
  }

  function ensurePopupHost(): HTMLDivElement {
    let host = document.getElementById(POPUP_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = POPUP_ID;
      applyAppearance(host);
      // 宿主必须是定位元素且给满 z-index，否则 prepend 到 DOM 最前意味着
      // 绘制顺序垫底，会被页面的悬浮层盖住。
      const parent = opts.mountParent?.() ?? document.documentElement;
      parent.prepend(host);
      host.style.position = 'fixed';
      host.style.inset = '0';
      host.style.zIndex = '2147483647';
      host.style.pointerEvents = 'none';
      const root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        ${brandTokens}${sharedControls}:host { font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif; text-shadow:none; letter-spacing:normal; text-transform:none; font-weight:400; color:var(--pd-ink); }
        * { box-sizing:border-box; }
        ::selection { background:var(--pd-selected); color:var(--pd-ink); }
        .card {
          position: fixed; top: 64px; right: 16px; width: min(420px, calc(100vw - 32px));
          max-height: min(70vh, 560px); overflow: auto;
          background-color:var(--pd-paper);background-image:var(--pd-texture);background-position:center;background-size:620px; color: var(--pd-ink); border-radius: 12px;
          box-shadow: var(--pd-shadow);
          font: 14px/1.6 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
          padding: 20px; box-sizing: border-box;
          pointer-events: auto; scrollbar-width:thin; scrollbar-color:var(--pd-line) transparent;
        }
        button,input,select { font:inherit; color:inherit; }
        button:focus-visible, select:focus-visible, a:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--pd-blue); outline-offset: 2px; }
        .card.compact { width: min(290px, calc(100vw - 16px)); }
        .compact .ctx, .compact .sub { display: none; }
        .compact .feedback:empty { display: none; }
        .card.dragging { user-select: none; }
        .expr { font:400 22px/1.35 var(--pd-font-reading); margin: 0 0 10px; word-break: break-word;
                cursor: grab; touch-action: none; }
        .ctx { color: var(--pd-muted); font-size: 13px; margin: 4px 0 8px;
               display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .sub { color: var(--pd-muted); font-size: 12px; margin: 0 0 16px; }
        .def-box { border-top: 1px solid var(--pd-line); padding-top: 12px; margin-top: 12px; }
        .def-state { color: var(--pd-muted); }
        .def-label { font-size: 12px; color: var(--pd-muted); margin: 0 0 8px; }
        .def-text { margin: 0; white-space: pre-wrap; word-break: break-word; }
        .sense {margin:10px 0 14px;overflow-wrap:anywhere}
        .sense label {display:flex;align-items:baseline;gap:8px;cursor:pointer;font-size:15px;line-height:1.7}
        .sense input {accent-color:var(--pd-blue);margin:0;flex:none}
        .example {font:17px/1.65 var(--pd-font-reading);margin:12px 0 6px}
        details {margin-top:8px} summary {cursor:pointer;color:var(--pd-muted);font-size:13px;padding:6px 0}
        .lookup-media:empty {display:none}
        .lookup-media iframe {display:block;width:100%;height:54px;border:0;margin-top:8px;color-scheme:light}
        .link-btn {cursor:pointer;color:var(--pd-blue);font:13px/1.5 system-ui;border:0;background:transparent;border-radius:6px;padding:6px 8px;min-height:32px}
        .link-btn:hover {background:var(--pd-selected)}
        .row { margin-top: 12px; display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
        .sources {padding-top:12px;border-top:1px solid var(--pd-line);margin-bottom:4px}
        .sources select {border-color:transparent;background:transparent;padding-left:7px}
        .actions .close {margin-left:auto}
        .sources a {display:inline-flex;align-items:center;gap:4px;min-height:34px;padding:4px 7px;border-radius:6px;color:var(--pd-muted);font:13px/1.5 system-ui;text-decoration:none}
        .sources a:hover {background:var(--pd-selected);color:var(--pd-blue)}
        .sources a svg {width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
        button.act {box-sizing:border-box;cursor:pointer;padding:7px 8px;border:1px solid transparent;min-height:36px;border-radius:7px;font:13px/1.5 system-ui}
        button:disabled {opacity:.6;cursor:default}
        ${readingIconStyles}
        button.ghost { background: transparent; color: var(--pd-ink); border-color:var(--pd-line); }
        button.ghost:hover { background: var(--pd-selected); }
        select {cursor:pointer;max-width:100%;min-height:34px;padding:6px 10px;border:1px solid var(--pd-line);border-radius:6px;font:13px/1.5 system-ui;background:var(--pd-surface)}
        select:hover {border-color:var(--pd-muted)}
        option {background:var(--pd-surface);color:var(--pd-ink)}
        .feedback { font-size: 12px; margin-top: 8px; }
        .feedback:empty {display:none}
        .feedback.err { color:var(--pd-danger); }
        .err-kind { font-size: 11px; color: var(--pd-muted); margin-top: 2px; }
      `;
      root.appendChild(style);
      const body = document.createElement('div');
      body.className = 'card';
      for (const name of ['lookup-content', 'lookup-media', 'lookup-footer']) {
        const region = document.createElement('div'); region.className = name; body.append(region);
      }
      root.appendChild(body);
      localize(root);
      // 页面内点击弹窗本身不冒泡成“新选区”
      host.addEventListener('mousedown', (e) => e.stopPropagation());
      // 按住词头拖动整卡。
      // 监听器在 shadow 边界外，e.target 已被 retarget 成 host，须用 composedPath 取真实目标。
      host.addEventListener('pointerdown', (e) => {
        const real = e.composedPath()[0] as Element | null;
        const header = real?.closest?.('.expr');
        const card = root.querySelector('.card') as HTMLDivElement | null;
        if (!header || !card || pinned?.anchor) return;
        e.preventDefault();
        card.classList.add('dragging');
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = card.getBoundingClientRect();
        const originX = rect.left;
        const originY = rect.top;
        const onMove = (ev: PointerEvent) => {
          dragPos = {
            x: Math.min(Math.max(originX + ev.clientX - startX, 0), window.innerWidth - 80),
            y: Math.min(Math.max(originY + ev.clientY - startY, 0), window.innerHeight - 48),
          };
          applyDragPos(card);
        };
        const onUp = () => {
          card.classList.remove('dragging');
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    }
    const host2 = document.getElementById(POPUP_ID)!;
    const card2 = host2.shadowRoot!.querySelector('.card') as HTMLDivElement;
    applyDragPos(card2);
    return card2;
  }

  function setFeedback(ok: boolean, text: string | UiText): void {
    const el = document
      .getElementById(POPUP_ID)
      ?.shadowRoot?.querySelector('#blc-feedback') as HTMLDivElement | undefined;
    if (el) {
      el.className = `feedback ${ok ? 'ok' : 'err'}`;
      setText(el,text);
    }
  }

  function renderPopup(): void {
    if (!pinned) return;
    const card = ensurePopupHost();
    const body = card.querySelector<HTMLDivElement>('.lookup-content')!;
    const footer = card.querySelector<HTMLDivElement>('.lookup-footer')!;
    const p = pinned;
    card.classList.toggle('compact', !!p.compact);
    body.textContent = '';
    footer.textContent = '';

    const head = document.createElement('p');
    head.className = 'expr';
    head.textContent = p.snapshot.expression;
    body.appendChild(head);

    // 原文上下文（视频 = 当前字幕；网页 = 所在正文片段）
    const ctx = document.createElement('div');
    ctx.className = 'ctx';
    setText(ctx, p.snapshot.sentence || message('（无上下文）'));
    body.appendChild(ctx);

    if (p.subLine) {
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = p.subLine;
      body.appendChild(sub);
    }

    // 释义区
    const defBox = document.createElement('div');
    defBox.className = 'def-box';
    renderDefinition(defBox, footer);
    body.appendChild(defBox);
    const media = card.querySelector<HTMLDivElement>('.lookup-media')!;
    const audioUrl = !p.compact && p.result?.kind === 'dictionary' ? p.result.entry.audioUrl : undefined;
    const existing = media.querySelector('iframe');
    if (!audioUrl) media.replaceChildren();
    else if (existing?.dataset.audioUrl !== audioUrl) {
      const frame = document.createElement('iframe');
      setLocalizedAttribute(frame, 'title', message('词典发音')); frame.dataset.audioUrl = audioUrl;
      frame.src = `${playerUrl}?src=${encodeURIComponent(audioUrl)}`;
      media.replaceChildren(frame);
    }

    // 操作区
    const row = document.createElement('div');
    row.className = 'row actions';

    const saved = p.savedContextId !== null;
    const save = document.createElement('button');
    save.className = 'act reading-icon save' + (saved ? ' is-saved' : '');
    save.innerHTML = readingIcon(saved ? 'saved' : 'bookmark');
    const saveLabel = message(saved ? '取消收藏' : p.saving ? '保存中…' : '保存');
    setLocalizedAttribute(save, 'title', saveLabel);
    setLocalizedAttribute(save, 'aria-label', saveLabel);
    const busy = p.checkingSaved || !!p.saving;
    save.setAttribute('aria-busy', String(busy));
    save.disabled = busy;
    save.addEventListener('click', () => void toggleSave());
    row.append(save);

    if (!p.compact && typeof p.onContinueAsk === 'function') {
      const ask = document.createElement('button');
      ask.className = 'act reading-icon';
      ask.innerHTML = readingIcon('ask');
      setLocalizedAttribute(ask, 'title', message('继续问'));
      setLocalizedAttribute(ask, 'aria-label', message('继续问'));
      ask.addEventListener('click', () => {
        if (!pinned) return;
        p.onContinueAsk!({
          snapshot: p.snapshot,
          definition: p.explanation?.text ?? p.definition,
          subLine: p.subLine,
        });
      });
      row.appendChild(ask);
    }

    const close = document.createElement('button');
    close.className = 'act reading-icon close';
    close.innerHTML = readingIcon('close');
    setLocalizedAttribute(close, 'title', message('关闭'));
    setLocalizedAttribute(close, 'aria-label', message('关闭'));
    close.addEventListener('click', () => closePopup());
    row.appendChild(close);
    footer.appendChild(row);

    // 数据库结果的反馈（非乐观）
    const fb = document.createElement('div');
    fb.className = 'feedback';
    fb.id = 'blc-feedback';
    fb.setAttribute('role', 'status');
    footer.appendChild(fb);
    if (p.saveError) setFeedback(false, message(saved ? '删除失败，重试' : '保存失败，请重试'));
    applyDragPos(card);
  }

  function renderDefinition(box: HTMLDivElement, footer: HTMLDivElement): void {
    if (!pinned) return;
    const p = pinned;
    const text = (value: string | UiText, cls = 'def-text') => {
      const n = document.createElement('p'); n.className = cls; setText(n,value); target.appendChild(n); return n;
    };
    const button = (label: string | UiText, action: () => void) => {
      const b = document.createElement('button'); b.className = 'link-btn'; setText(b,label); b.addEventListener('click', action); target.appendChild(b); return b;
    };
    let target: HTMLElement = box;
    if (p.degraded) text(message({
      'dictionary-failure': '词典暂不可用，当前显示免费译文',
      'ai-failed': 'AI 释义失败，当前显示免费译文',
      'ai-unconfigured': '尚未配置 AI，当前显示免费译文',
    }[p.degraded]), 'def-state');
    if (p.compact) {
      if (p.result?.kind === 'dictionary') {
        const sense = p.result.entry.senses[0];
        text(`${sense?.partOfSpeech ?? ''} ${sense?.definition ?? ''}`);
        text(p.result.entry.source === 'youdao' ? message('有道') : message('剑桥英汉'), 'def-label');
      } else if (p.result) { text(p.result.text); text(message(p.result.kind === 'translation' ? p.result.source === 'browser-native' ? '浏览器内置翻译' : '翻译 · Google' : 'AI 释义'), 'def-label'); }
      else text(p.lookupError ? message(LOOKUP_ERROR_LABEL[p.lookupError] ?? '暂时无法查询') : message('正在查询…'), 'def-state');
      button(message('展开详情'), () => { p.compact = false; renderPopup(); });
      return;
    }
    if (p.result?.kind === 'dictionary') {
      const entry = p.result.entry;
      text(message('{source} · {word}{phonetic}',{source:message(entry.source==='youdao'?'有道':'剑桥英汉'),word:entry.headword,phonetic:entry.phonetic?` /${entry.phonetic}/`:''}), 'def-label');
      const renderSense = (index: number, parent: HTMLElement) => {
        const sense = entry.senses[index]!;
        const line = document.createElement('div'); line.className = 'sense';
        const select = document.createElement('input'); select.type = 'radio'; select.name = 'sense';
        select.checked = (p.result?.kind === 'dictionary' ? p.result.selectedSense ?? 0 : 0) === index;
        select.addEventListener('change', () => { if (p.result?.kind === 'dictionary') { p.result.selectedSense = index; p.definition = sense.definition; } });
        const label = document.createElement('label'); label.append(select, document.createTextNode(`${sense.partOfSpeech ?? ''} ${sense.definition}`)); line.appendChild(label);
        if (sense.example) { const ex = document.createElement('p'); ex.className = 'example'; ex.textContent = sense.example; line.appendChild(ex); }
        if (sense.exampleTranslation) { const ex = document.createElement('p'); ex.className = 'def-label'; ex.textContent = sense.exampleTranslation; line.appendChild(ex); }
        parent.appendChild(line);
      };
      renderSense(0, box);
      if (entry.senses.length > 1) {
        const more = document.createElement('details'); const summary = document.createElement('summary'); setText(summary, message('其它义项')); more.appendChild(summary);
        for (let i = 1; i < entry.senses.length; i++) renderSense(i, more);
        box.appendChild(more);
      }
      if (entry.forms?.length) text(message('来源词形：{forms}',{forms:entry.forms.join('、')}), 'def-label');
      if (entry.lemmaCandidates?.length) text(message('原形候选：{forms}',{forms:entry.lemmaCandidates.join('、')}), 'def-label');
    } else if (p.result?.kind === 'translation') {
      text(message(p.result.source === 'browser-native' ? '浏览器内置翻译' : '翻译 · Google'), 'def-label'); text(p.result.text);
    } else if (p.result?.kind === 'ai-definition') {
      text(message('AI 释义'), 'def-label'); text(p.result.text);
    } else if (p.lookupError) {
      text(message(LOOKUP_ERROR_LABEL[p.lookupError] ?? '暂时无法查询'), 'def-state');
      if (p.lookupError !== 'extension-context-invalidated') button(message('重试'), () => void requestLookup(p.source));
    } else text(message('正在查询释义…（此时也可保存）'), 'def-state');
    const row = document.createElement('div'); row.className = 'row sources';
    const choose = document.createElement('select'); setLocalizedAttribute(choose, 'aria-label', message('词典'));
    for (const [value, label] of [['', message('首选词典')], ['youdao', message('有道')], ['cambridge', message('剑桥英汉')]] as const) { const opt = document.createElement('option'); opt.value = value; setText(opt,label); choose.appendChild(opt); }
    choose.value = p.source ?? ''; choose.addEventListener('change', () => void requestLookup(choose.value as DictionarySource || undefined)); row.appendChild(choose);
    const source = p.result?.kind === 'dictionary' ? p.result.entry.source : p.source ?? 'youdao';
    const link = document.createElement('a'); setText(link, message('查看原文')); link.target = '_blank'; link.rel = 'noopener';
    link.href = p.result?.kind === 'dictionary' ? p.result.entry.url : source === 'youdao' ? `https://dict.youdao.com/w/${encodeURIComponent(p.snapshot.expression)}/` : `https://dictionary.cambridge.org/dictionary/english-chinese-simplified/${encodeURIComponent(p.snapshot.expression.replace(/\s+/g, '-'))}`;
    row.appendChild(link);
    const oxford = document.createElement('a'); setText(oxford, message('牛津原站')); oxford.href = `https://www.oxfordlearnersdictionaries.com/definition/english/${encodeURIComponent(p.snapshot.expression.replace(/\s+/g, '-'))}`; oxford.target = '_blank'; oxford.rel = 'noopener'; row.appendChild(oxford);
    for (const sourceLink of [link, oxford]) {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 16 16'); icon.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M6 3H3v10h10v-3M9 3h4v4M7 9l6-6');
      icon.appendChild(path); sourceLink.appendChild(icon);
    }
    footer.appendChild(row);
    target = footer;
    const ai = button(p.aiRequest ? message('正在解释语境…') : message('解释语境'), () => void explainContext()); ai.disabled = !!p.aiRequest;
    if (p.explanation) { text(message('AI 语境解释 · 当前原句'), 'def-label'); text(p.explanation.text); }
    if (p.aiError) { text(message(ERROR_LABEL[p.aiError] ?? '解释失败，请重试'), 'def-state'); if (p.aiError === 'no-key') button(message('打开设置填写 API key'), () => void send({ type: 'openSettings', ai: true })); }
  }

  // ---- 与 background 的交互 ---------------------------------------------------

  async function querySavedContext(): Promise<void> {
    if (!pinned) return;
    const p = pinned;
    const snap = p.snapshot;
    p.checkingSaved = true;
    p.saveError = false;
    renderPopup();
    const key = snap.lang ? entryKeyOf(snap.lang, snap.expression) : normalizeExpression(snap.expression);
    const r = await send<GetEntryResult>({ type: 'getEntry', key }).catch(() => undefined);
    if (pinned !== p) return;
    p.checkingSaved = false;
    if (!r?.ok) p.saveError = true;
    else {
      p.vaultId = r.vaultId;
      const entry = r.entry;
      const saved = entry && entry.contexts.find(c => {
        const context = { ...c, entryKey: entry.key };
        return snap.source === 'video'
          ? isDuplicateVideoContext(context, entry.key, snap.video, snap.sentence)
          : isDuplicateContext(context, entry.key, snap.url, snap.sentence);
      });
      p.savedContextId = saved?.id ?? null;
      if (saved?.explanation) p.explanation = saved.explanation;
      if (saved) void backfill(p);
    }
    renderPopup();
  }

  async function backfill(p: PinnedState): Promise<void> {
    if (p.savedContextId !== null) await send({ type: 'backfillResult', contextId: p.savedContextId, result: p.result, explanation: p.explanation });
  }

  async function requestLookup(source?: DictionarySource): Promise<void> {
    if (!pinned) return;
    const p = pinned;
    if (p.lookupRequest) void send({ type: 'cancelOnline', requestId: p.lookupRequest });
    const requestId = `lookup-${Date.now()}-${++requestCounter}`;
    p.lookupRequest = requestId; p.source = source; p.lookupError = undefined; p.degraded = undefined; p.result = undefined; p.definition = null;
    renderPopup();
    // 查询意图：紧凑卡即 hover 路径（永不触发 AI 兜底）；展开后 /
    // 主动打开的卡片按主动查词处理（background 缺省 active）。
    const r = await send<OnlineLookupResult>({
      type: 'lookup',
      snapshot: p.snapshot,
      source,
      intent: p.compact ? 'hover' : 'active',
      requestId,
    });
    if (p.lookupRequest !== requestId) return;
    p.lookupRequest = undefined;
    if (r?.ok) {
      p.result = r.result;
      p.degraded = r.degraded;
      p.definition = r.result.kind === 'dictionary' ? r.result.entry.senses[0]?.definition ?? null : r.result.text;
      await backfill(p);
    } else p.lookupError = r && !r.ok ? r.error : 'network';
    if (pinned === p) renderPopup();
  }

  async function explainContext(): Promise<void> {
    if (!pinned || pinned.aiRequest) return;
    const p = pinned;
    p.aiRequest = `lookup-${Date.now()}-${++requestCounter}`; p.aiError = undefined;
    renderPopup();
    const r = await send<LookupResult>({ type: 'explainContext', snapshot: p.snapshot, requestId: p.aiRequest });
    p.aiRequest = undefined;
    if (r?.ok) {
      p.explanation = { kind: 'ai-context', source: r.provider === 'deepseek' ? 'deepseek' : 'ai', provider: r.provider, model: r.model, text: [r.definition, r.note].filter(Boolean).join('\n'), sentence: p.snapshot.sentence, neighbors: p.snapshot.source === 'video' ? p.snapshot.neighbors : undefined };
      await backfill(p);
    } else p.aiError = r && !r.ok ? r.error : 'network';
    if (pinned === p) renderPopup();
  }

  async function toggleSave(): Promise<void> {
    if (!pinned || pinned.saving || pinned.checkingSaved) return;
    const p = pinned;
    if (p.vaultId === undefined) {
      await querySavedContext();
      if (pinned !== p || p.vaultId === undefined || p.savedContextId !== null) return;
    }
    p.saving = true;
    p.saveError = false;
    renderPopup();
    if (p.savedContextId !== null) {
      const r = await send<{ ok: boolean }>({
        type: 'deleteVocabContext', contextId: p.savedContextId, vaultId: p.vaultId,
      }).catch(() => undefined);
      p.saving = false;
      if (r?.ok) p.savedContextId = null;
      else p.saveError = true;
      if (pinned === p) renderPopup();
      return;
    }
    let r: SaveResult | BgcError | undefined;
    try { r = await send<SaveResult | BgcError>({
      type: 'save',
      snapshot: p.snapshot,
      vaultId: p.vaultId,
      result: p.result,
      explanation: p.explanation,
    }); } catch { r = undefined; }
    p.saving = false;
    if (r && r.ok) {
      p.savedContextId = r.contextId;
      // The save reply already confirms the local database write.
      void backfill(p);
      if (pinned !== p) return;
      renderPopup();
      const button = document.getElementById(POPUP_ID)?.shadowRoot?.querySelector<HTMLButtonElement>('.save');
      if (button) animateBookmark(button);
    } else {
      p.saveError = true;
      if (pinned === p) renderPopup();
    }
  }

  // ---- 开 / 关 -----------------------------------------------------------------

  function closePopup(silent = false): void {
    document.getElementById(POPUP_ID)?.remove();
    // A saved or saving context still needs this lookup's result after the card closes.
    const lookup = pinned && pinned.savedContextId === null && !pinned.saving ? pinned.lookupRequest : undefined;
    for (const requestId of [lookup, pinned?.aiRequest]) if (requestId) void send({ type: 'cancelOnline', requestId });
    const cb = pinned?.onClose;
    pinned = null;
    if (!silent) cb?.();
  }

  document.addEventListener('pointerdown', e => {
    if (!pinned) return;
    const path = e.composedPath();
    const switchingWord = path.some(n => n instanceof Element && n.matches('.w,[data-word]'));
    if (!switchingWord && !(pinned.anchor && path.includes(pinned.anchor)) && !path.includes(document.getElementById(POPUP_ID)!)) closePopup();
  }, true);
  document.addEventListener('pd-popup-outside', e => {
    const at = (e as CustomEvent<{at?:number}>).detail?.at;
    if (at === undefined || at >= openedAt) closePopup();
  });
  window.addEventListener('message', e => {
    const frame = document.getElementById(POPUP_ID)?.shadowRoot?.querySelector<HTMLIFrameElement>('.lookup-media iframe');
    if (!frame || e.source !== frame.contentWindow || e.origin !== playerUrl.split('/').slice(0, 3).join('/')) return;
    if (e.data?.type === 'pd-audio-close') closePopup();
    if (e.data?.type === 'pd-audio-size') {
      frame.style.height = `${e.data.height}px`;
      applyDragPos(frame.closest<HTMLDivElement>('.card')!);
    }
  });
  window.addEventListener('resize', () => { const card = document.getElementById(POPUP_ID)?.shadowRoot?.querySelector<HTMLDivElement>('.card'); if (card) applyDragPos(card); });
  document.addEventListener('scroll', () => {
    if (!pinned?.anchor) return;
    const card = document.getElementById(POPUP_ID)?.shadowRoot?.querySelector<HTMLDivElement>('.card');
    if (card) applyDragPos(card);
  }, true);

  document.addEventListener('keydown', (e) => {
    const root = document.getElementById(POPUP_ID)?.shadowRoot;
    if (e.key === 'Escape' && root && !root.querySelector('.ui-action-menu:popover-open,select:open')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      closePopup();
    }
  }, true);

  return {
    open(args: PopupOpenArgs): void {
      openedAt = performance.timeOrigin + performance.now();
      if (pinned) closePopup(true);
      anchorRect = null;
      pinned = {
        snapshot: args.snapshot,
        anchor: args.anchor, compact: args.compact,
        subLine: args.subLine,
        onClose: args.onClose,
        onContinueAsk: args.onContinueAsk,
        savedContextId: null,
        checkingSaved: true,
        definition: null,
        note: undefined,
        lookupError: undefined,
      };
      void querySavedContext();
      void requestLookup();
    },
    isCompact() { return !!pinned?.compact; },
    expand() { if (pinned) { pinned.compact = false; renderPopup(); } },
    close(silent) {
      closePopup(silent);
    },
    isOpen() {
      return pinned !== null;
    },
    host() {
      return document.getElementById(POPUP_ID);
    },
  };
}
