import { t as tr, localize, onDisplayLanguageChange, initDisplayLanguage, getDisplayLocale , message, setText, setLocalizedAttribute, languageLabel, type UiText } from '@/shared/i18n';
import '@/shared/theme.css';
import { mountSettings } from '@/shared/settingsView';
import { createYoutubeWorkspace, type WorkspaceState } from '@/shared/youtubeWorkspace';
import { isPanelView, panelStateKey, panelTransportFailure, type SelectionSnapshot, type PanelFrameState } from '@/shared/panel';
import { createTranslationPopup } from '@/shared/translationPopup';
import { createLookupPopup } from '@/shared/lookupPopup';
import { shadowSelection, classifyRangeIn, clampRangeToElement } from '@/shared/selection';
import { buildMarkBuckets } from '@/shared/marker';
import { effectiveEntryLanguage, isRtlLanguage, langDisplayName, normalizeLangTag } from '@/shared/languages';
import { segmentWords } from '@/shared/tokenize';
import { materialFromCandidate, type SelectionCandidate } from '@/shared/chat';
import { CHAT_ADD_ICON, CHAT_ADD_BUTTON_STYLE } from '@/shared/brand';
// 侧栏三个视图：生词本（词条 / 上下文 / 词形关联管理）、字幕（当前标签页
// 视频的原文列表 + 译文 + 播放控制）、复习（原句回忆，无 AI 调用）。
// 数据全部来自 background 的 IndexedDB；vocab-changed 广播后刷新。
// 字幕控制消息经 tabs.sendMessage 直达当前标签页，携带 videoId 防串页。

import type { EntryView, SubViewState, ChatSourceInfo } from '@/shared/messages';
import { videoContextUrl, blankExpression, generalMeaning, VOCAB_STATUS_LABEL, type LearningResult, type SavedSentence, type VocabStatus } from '@/shared/vocab';
import { buildReviewQueue, refreshQueue, scopeEntries, type LearningScope, type ReviewItem } from '@/shared/review';
import { createArticleLearning, articleSource, type ArticleLearningSnapshot, type LearningCategory } from './articleLearning';
import { appendKnowledgeBody } from './knowledgeView';
import type { KnowledgeRecord } from '@/shared/knowledge';
import { vaultRecordJson } from '@/shared/vault';
import type { SourceDescriptor } from '@/shared/chat';
import { fmtClock } from '@/shared/cues';
import {
  attachSelectionCandidate,
  chatViewEnter,
  chatViewLeave,
  initChatView,
  subtitleAskAi,
  saveDraft,
  snapshotChat,restoreChat,setChatActive,type ChatViewSnapshot,
} from './chatView';

function send<T>(msg: unknown): Promise<T> {
  return new Promise((resolve) => {
    const failed = (error: unknown) => {
      console.warn('[pd] panel transport failed', { type: (msg as {type?:string}).type, reason: panelTransportFailure(error) });
      resolve(undefined as T);
    };
    try {
      const pending = browser.runtime.sendMessage(msg, (r: unknown) => {
        const error = browser.runtime.lastError;
        if (error) failed(error.message); else resolve(r as T);
      }) as unknown as Promise<unknown> | undefined;
      void pending?.catch(failed);
    } catch (error) { failed(error); }
  });
}

function tabSend<T>(tabId: number, msg: unknown): Promise<T | null> {
  return new Promise((resolve) => {
    browser.tabs.sendMessage(tabId, msg, (r: unknown) => {
      void browser.runtime.lastError;
      resolve((r as T) ?? null);
    });
  });
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string | UiText,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) setText(n,text);
  return n;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ---- 视图切换 -------------------------------------------------------------------

let currentView = '';
let previousView = 'list';
let panelWindow = -1;
let floating = false;
let panelTabId=-1;
let activePanel=true;
let inVideoFullscreen=false;
let ready = false;
let panelDocumentId = '';
let workspaceInitialized = false;
let workspaceFailureStage = '';
const workspaceVersion = browser.runtime.getManifest().version;
function workspaceFailed(stage: string, error: unknown) {
  workspaceFailureStage = stage; ready = false;
  console.warn('[pd] workspace initialization failed', { stage, documentId: panelDocumentId, version: workspaceVersion, reason: error instanceof Error ? error.name : 'unknown-error' });
  feedback(message('工作区暂不可用，请使用浮动外壳的重试入口'));
}
browser.runtime.onMessage.addListener((m: unknown, _sender, reply) => {
  if ((m as {type?:string}).type !== 'pd-workspace-status') return;
  const phase: PanelFrameState['phase'] = !document.getElementById('views') ? 'document-empty'
    : workspaceFailureStage ? 'failed' : !workspaceInitialized ? 'loading' : ready ? 'ready' : 'standby';
  reply({ ok: phase === 'ready' || phase === 'standby', phase, documentId: panelDocumentId, version: workspaceVersion, reason: workspaceFailureStage || undefined } satisfies PanelFrameState);
});
let savedScroll: Record<string,number> = {};
interface ReturnedVideo {state:SubViewState;tabId:number;workspace:ReturnType<typeof videoWorkspace.snapshot>}
const returnedVideoSnapshot=(video:ReturnedVideo|null)=>video?{...video,state:{...video.state,cues:[]}}:null;
let returnedVideo:ReturnedVideo|null=null;
let restoreReturnedVideo=false;
let libraryId:string|null=null;
interface ReviewSession extends LearningScope { vaultId?:string|null;category: LearningCategory; source?: SourceDescriptor; returnTo: 'list' | 'article' | 'video'; article?: ArticleLearningSnapshot; video?: ReturnedVideo }
interface PanelSnapshot {vaultId?:string|null;view?:string;previousView?:string;search?:string;reviewQueue?:ReviewItem[];reviewIdx?:number;revealed?:boolean;definitionRevealed?:boolean;reviewSession?:ReviewSession;knowledgeQueue?:KnowledgeRecord[];article?:ArticleLearningSnapshot;returnedVideo?:ReturnedVideo|null;scroll?:Record<string,number>;video?:{tab?:string;follow?:boolean;top?:number};chat?:ChatViewSnapshot}
const settingsView=mountSettings(document.getElementById('settings-body')!);
const selectionPopup=createTranslationPopup(send);
const lookupPopup=createLookupPopup({send});
let hoveredWord:HTMLElement|null=null;
let wordTimer:ReturnType<typeof setTimeout>|undefined;
let closeTimer:ReturnType<typeof setTimeout>|undefined;
let lookupTarget='';
const currentMain=()=>document.getElementById('view-'+currentView);
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
const feedback=(text:string|UiText, transient=false)=>{
  clearTimeout(feedbackTimer);
  const n=document.getElementById('panel-feedback')!;n.hidden=!text;setText(n,text);
  if(transient)feedbackTimer=setTimeout(()=>{n.hidden=true;setText(n,'');},4000);
};
async function persistPanel() {
  if(!ready || !activePanel || panelWindow<0)return;
  savedScroll[currentView]=currentMain()?.scrollTop??0;
  await browser.storage.session.set({[panelStateKey(panelWindow)]:{vaultId:libraryId,view:currentView,previousView,search:(document.getElementById('search') as HTMLInputElement).value,reviewQueue,reviewIdx,revealed,definitionRevealed,reviewSession,knowledgeQueue,article:articleLearning.snapshot(),returnedVideo:returnedVideoSnapshot(returnedVideo),scroll:savedScroll,video:videoWorkspace.snapshot(),chat:snapshotChat()}});
}


function switchView(view: string): void {
  if (view === currentView) return;
  feedback('');
  lookupPopup.close();closeLangMenu();document.getElementById('panel-selection-actions')?.remove();
  const prev = currentView;
  subsPollGeneration++;
  if (prev === 'subs' && view !== 'review') {articleLearning.follow();returnedVideo=null;}
  if (prev === 'chat' && view !== 'chat') chatViewLeave();
  savedScroll[prev]=currentMain()?.scrollTop??0;
  if(view==='settings' && prev!=='settings')previousView=prev||'list';
  currentView = view;
  history.replaceState(null,'',`#${view}`);
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#views button')) {
    btn.classList.toggle('active', btn.dataset.view === (view==='review'&&reviewSession.returnTo!=='list'?'subs':['list','sentences','review'].includes(view)?'list':view));
  }
  document.getElementById('view-sentences')!.hidden = view !== 'sentences';
  document.getElementById('view-list')!.hidden = view !== 'list';
  document.getElementById('view-subs')!.hidden = view !== 'subs';
  document.getElementById('view-review')!.hidden = view !== 'review';
  document.getElementById('view-chat')!.hidden = view !== 'chat';
  document.getElementById('view-settings')!.hidden = view !== 'settings';
  document.getElementById('library-tools')!.hidden = !['list','sentences'].includes(view);
  document.querySelectorAll<HTMLButtonElement>('.library-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  currentMain()?.scrollTo(0,savedScroll[view]??0);
  document.getElementById('search-combo')!.style.display = view === 'list' ? '' : 'none';
  // 侧栏各视图共用同一连接；显式停止或窗口关闭才停止生成
  if (view === 'chat') chatViewEnter();
  if (view === 'list') void refresh();
  if (view === 'subs') pollSubs();
  if (view === 'sentences') void refreshSentences();
  if (view === 'review') {if(reviewQueue.length||knowledgeQueue.length){renderReview();void refreshReviewQueue();}else void startReview();}
  if (view === 'settings')void settingsView.refresh();
  void persistPanel();
}

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  btn.addEventListener('click', () => { if (btn.dataset.view === 'review') beginReview({category:'vocab', returnTo:'list', language: localStorage.getItem('blc-lang-filter') === 'all' ? undefined : localStorage.getItem('blc-lang-filter') ?? undefined}); else switchView(btn.dataset.view!); });
}

document.getElementById('open-settings')!.addEventListener('click', () => switchView('settings'));
document.getElementById('settings-back')!.addEventListener('click', () => switchView(previousView));
document.getElementById('panel-mode')!.addEventListener('click',async()=>{
  if(floating&&inVideoFullscreen){feedback(message('退出视频全屏后可使用固定侧栏'));return;}
  // Native sidePanel.open must run before the first await in the click handler.
  const nativeOpen=floating?browser.sidePanel.open({windowId:panelWindow}).then(()=>true,()=>false):Promise.resolve(false);
  lookupPopup.close();
  await saveDraft(true);await persistPanel();
  const r=await send<{ok:boolean;error?:string}>({type:'panelSwitch',mode:floating?'fixed':'floating',nativeOpened:await nativeOpen});
  if(!r?.ok)feedback(message(r?.error??'切换失败，请重试'));
});
document.getElementById('panel-close')!.addEventListener('click',async()=>{lookupPopup.close();await persistPanel();setChatActive(false);activePanel=false;ready=false;const r=await send<{ok:boolean}>({type:'panelClose'});if(!r?.ok){activePanel=true;ready=true;setChatActive(true);feedback(message('关闭失败，请重试'));}});
document.addEventListener('pointerdown',()=>void send({type:'panelOutsideClick',at:performance.timeOrigin+performance.now()}),true);
document.addEventListener('click',()=>setTimeout(()=>void persistPanel(),0));
// 滚动以帧率触发，尾沿节流到 ≥400ms 一次持久化；点击路径保持立即
let scrollPersistQueued=false,scrollPersistAt=0;
document.addEventListener('scroll',()=>{
  if(scrollPersistQueued)return;
  scrollPersistQueued=true;
  setTimeout(()=>{scrollPersistQueued=false;scrollPersistAt=Date.now();void persistPanel();},Math.max(0,scrollPersistAt+400-Date.now()));
},true);


async function refreshSentences(): Promise<void> {
  const r = await send<{ ok:boolean; sentences:SavedSentence[] }>({ type:'listSentences' });
  if (currentView !== 'sentences') return;
  const body = document.getElementById('sentences-list')!; body.replaceChildren();
  if (!r?.ok) { body.append(el('p', 'empty', message('读取失败，请重新打开句子页重试'))); return; }
  if (!r.sentences.length) body.append(el('p', 'empty', message('还没有收藏的字幕句子')));
  for (const saved of r.sentences) {
    const card = el('article', 'entry'); card.append(el('p', 'sentence', saved.text));
    if (saved.zh) card.append(el('p', 'definition', saved.zh));
    const meta = el('div', 'meta');
    const link = el('a', 'source', `${saved.title} · ${fmtClock(saved.video.startMs)}`);
    link.href = videoContextUrl(saved.video.videoId, saved.video.startMs); link.target = '_blank'; link.rel = 'noopener'; meta.append(link);
    const remove = el('button', 'delete', message('取消收藏'));
    remove.addEventListener('click', async () => {
      const result = await send<{ ok:boolean }>({ type:'deleteSentence', id:saved.id });
      if (!result?.ok) setText(remove, message('删除失败，重试'));
    });
    meta.append(remove); card.append(meta); body.append(card);
  }
}

// ---- 生词本 ----------------------------------------------------------------------

function renderContextMeta(c: EntryView['contexts'][number]): HTMLElement {
  const meta = el('div', 'meta');
  const src = el('a', 'source');
  src.href = c.url;
  src.target = '_blank';
  src.rel = 'noopener';
  if (c.sourceType === 'video' && c.video) {
    src.textContent = `YouTube · ${fmtClock(c.video.startMs)}`;
    setLocalizedAttribute(src,'title',message('{title} · {language} ({kind})',{title:c.title,language:languageLabel(c.video.trackLang),kind:message(c.video.trackKind==='asr'?'自动':'人工')}));
  } else {
    setText(src, hostOf(c.url) || message('打开来源'));
    src.title = c.title || c.url;
  }
  meta.appendChild(src);
  const type = el(
    'span',
    'src-type',
    c.sourceType === 'video' ? message('视频字幕') : message('网页'),
  );
  meta.appendChild(type);
  meta.appendChild(el('time', 'time', fmtTime(c.createdAt)));
  if(c.sourceType!=='video') {
    const locate=el('button','ghost',message('定位原句')),status=el('span','hint');status.setAttribute('role','status');
    let noticeTimer: ReturnType<typeof setTimeout> | undefined;
    locate.onclick=async()=>{
      clearTimeout(noticeTimer);
      setText(status,message(await locateSavedText(c.url,c.sentence)?'已定位到原文':'页面已变化，显示保存的原文'));
      noticeTimer=setTimeout(()=>setText(status,''),4000);
    };
    meta.append(locate,status);
  }
  return meta;
}

async function locateSavedText(url:string,text:string):Promise<boolean> {
  const source=articleSource(url,'');if(!source)return false;
  for(const tab of await browser.tabs.query({currentWindow:true})) {
    if(typeof tab.id!=='number')continue;
    const info=await tabSend<ChatSourceInfo>(tab.id,{type:'blc-chat-source'});
    if(info?.source?.sourceKey!==source.sourceKey)continue;
    const result=await tabSend<{found:boolean}>(tab.id,{type:'blc-chat-locate',text});
    if(result?.found){await browser.tabs.update(tab.id,{active:true});return true;}
  }
  return false;
}

function meaningSource(result: LearningResult): UiText {
  const source = result.kind === 'dictionary' ? (result.entry.source === 'youdao' ? '有道' : '剑桥英汉')
    : result.kind === 'translation' ? '翻译' : 'AI 释义';
  return message('{source} · {text}', {source: message('一般释义参考'), text: message(source)});
}

function renderEntry(entry: EntryView, vaultId: string | null, scoped = false): HTMLElement {
  const card = el('article', 'entry');
  card.dataset.key = entry.key;

  const head = el('div', 'entry-head');
  const expr = el('h2', 'expr', entry.expression);
  const entryLang = effectiveEntryLanguage(entry);
  if (entryLang && isRtlLanguage(entryLang)) expr.dir = 'rtl';
  head.appendChild(expr);
  const kind = el('span', 'kind', entry.kind === 'word' ? message('词') : message('短语'));
  head.appendChild(kind);
  // 语言徽标：缺失（迁移前旧记录）不显示，不冒充任何语言
  if (entryLang) {
    const chip = el('span', 'kind', languageLabel(entryLang));
    chip.title = entryLang;
    head.appendChild(chip);
  }

  const sel = el('select', 'status') as HTMLSelectElement;
  for (const s of ['saved', 'learning', 'known'] as const) {
    const opt = el('option', undefined, message(VOCAB_STATUS_LABEL[s]));
    opt.value = s;
    if (entry.status === s) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', async () => {
    const r = await send<{ ok: boolean }>({
      type: 'setStatus',
      key: entry.key,
      status: sel.value as VocabStatus,
      vaultId,
    });
    if (!r?.ok) sel.value = entry.status;
  });
  head.appendChild(sel);

  const del = el('button', 'delete', message('删除'));
  del.addEventListener('click', async () => {
    if (!confirm(tr('删除「{expression}」及其 {count} 条上下文？', {expression:entry.expression,count:entry.contexts.length}))) return;
    await send({ type: 'deleteEntry', key: entry.key, vaultId });
    // vocab-changed 广播会触发刷新
  });
  if (!scoped) head.appendChild(del);
  card.appendChild(head);

  const first=entry.contexts[0];
  const contextual=first?.explanation?.text ?? first?.definition;
  const reference=generalMeaning(first?.result);
  const meaning=scoped ? contextual || reference : reference || first?.definition;
  if(meaning){
    if(scoped&&!contextual&&first?.result)card.append(el('p','hint',meaningSource(first.result)));
    card.append(el('p','entry-preview',!scoped&&first?.result?.kind==='ai-definition'?meaning.split('\n')[0]:meaning));
  }
  else if(scoped)card.append(el('p','hint',message('未保存释义')));
  if(scoped && first){card.append(el('p','sentence',first.sentence),renderContextMeta(first));}

  // 个人笔记（学习库“我的笔记”同源；就地编辑，正常保存给就近状态）
  const noteBox = el('details', 'note-box');
  if (entry.note) noteBox.open = true;
  const noteSummary = el('summary', undefined, entry.note ? message('我的笔记') : message('添加笔记'));
  noteBox.appendChild(noteSummary);
  const noteArea = document.createElement('textarea');
  noteArea.value = entry.note ?? '';
  setLocalizedAttribute(noteArea, 'placeholder', message('写下自己的理解'));
  setLocalizedAttribute(noteArea, 'aria-label', message('{expression} 我的笔记', {expression:entry.expression}));
  const noteState = el('p', 'hint');
  const noteSave = el('button', 'ghost', message('保存笔记'));
  noteSave.addEventListener('click', async () => {
    noteSave.disabled = true;
    const r = await send<{ ok: boolean }>({ type: 'setNote', key: entry.key, note: noteArea.value, vaultId });
    noteSave.disabled = false;
    setText(noteState, r?.ok ? message('已保存') : message('保存失败，请重试'));
    if (r?.ok) setText(noteSummary, noteArea.value.trim() ? message('我的笔记') : message('添加笔记'));
  });
  const noteRow = el('div', 'note-actions');
  noteRow.append(noteSave, noteState);
  noteBox.append(noteArea, noteRow);
  card.appendChild(noteBox);

  // 词形关联：查看 + 移除错误关联
  if (!scoped && entry.forms.length) {
    const forms = el('div', 'forms');
    forms.appendChild(el('span', 'form-label', message('词形关联：')));
    for (const f of entry.forms) {
      const chip = el('span', 'form-chip');
      chip.appendChild(document.createTextNode(f));
      const rm = el('button', undefined, '×');
      setLocalizedAttribute(rm, 'title', message('移除词形关联「{form}」', {form:f}));
      rm.addEventListener('click', async () => {
        await send({ type: 'removeForm', key: entry.key, form: f, vaultId });
      });
      chip.appendChild(rm);
      forms.appendChild(chip);
    }
    card.appendChild(forms);
  }

  const details=el('details','entry-details');const summary=el('summary',undefined,message('原句与详情'));details.append(summary);
  for (const c of entry.contexts) {
    const box = el('div', 'context');
    box.appendChild(renderContextMeta(c));
    box.appendChild(el('p', 'sentence', c.sentence));
    if(scoped && c.result)box.append(el('p','hint',message('一般释义参考')));
    if (c.result?.kind === 'dictionary') {
      const result = c.result;
      const sense = result.entry.senses[result.selectedSense ?? 0];
      if (sense) box.appendChild(el('p', 'definition', message('{source} · {text}',{source:message(result.entry.source==='youdao'?'有道':'剑桥英汉'),text:`${sense.partOfSpeech??''} ${sense.definition}`})));
    } else if (c.result?.kind === 'translation') box.appendChild(el('p', 'definition', message('{source} · {text}',{source:message('翻译'),text:c.result.text})));
    else if (c.result?.kind === 'ai-definition') box.appendChild(el('p', 'definition', message('{source} · {text}',{source:message('AI 释义'),text:c.result.text})));
    if (c.explanation) box.appendChild(el('p', 'definition', message('{source} · {text}',{source:message('AI 语境解释'),text:c.explanation.text})));
    else if (c.definition) box.appendChild(el('p', 'definition', message('{source} · {text}',{source:message('已存语境释义'),text:c.definition})));
    else if(scoped)box.append(el('p','hint',message('未保存释义')));
    details.appendChild(box);
  }
  card.append(details);
  return card;
}

let listGeneration = 0;
async function refresh(): Promise<void> {
  const generation = ++listGeneration;
  const list = document.getElementById('list')!;
  const q = (document.getElementById('search') as HTMLInputElement).value;
  const r = await send<{ ok: boolean; entries?: EntryView[]; vaultId: string | null }>({
    type: 'listEntries',
    query: q || undefined,
  });
  if (currentView !== 'list' || generation !== listGeneration) return;
  list.textContent = '';
  if (!r?.ok || !r.entries) {
    list.appendChild(el('div', 'empty', message('加载失败，请重试')));
    return;
  }
  // 语言筛选：全部 / 待确认 / 出现过的语言（记住选择，spec 3.4）。
  // 合并到搜索行：globe 图标菜单 + 可清除 chip（规格见 design/lang-filter-mockup.html 方案 B）
  const langs = [...new Set(r.entries.map((e) => effectiveEntryLanguage(e)).filter((l): l is string => !!l))].sort();
  let filter = localStorage.getItem('blc-lang-filter') ?? 'all';
  if (filter !== 'all' && filter !== 'und' && !langs.includes(filter)) {
    filter = 'all'; // 存储语言已不存在（词条删除等）：回退全部并回写
    localStorage.setItem('blc-lang-filter', 'all');
  }
  renderLangControls(filter, langs, r.entries);
  const filtered = filter === 'all' ? r.entries : r.entries.filter((e) => effectiveEntryLanguage(e) === filter);
  if (filtered.length === 0) {
    list.appendChild(
      el('div', 'empty', q ? message('没有匹配的表达') : filter !== 'all' ? message('该语言暂无词条') : message('还没有收藏的表达。在网页上选中一个词或短语，点击“查词”开始。')),
    );
    return;
  }
  for (const e of filtered) list.appendChild(renderEntry(e, r.vaultId));
  currentMain()?.scrollTo(0,savedScroll[currentView]??0);
}

document.getElementById('search')!.addEventListener('input', () => void refresh());

// ---- 语言筛选（globe 菜单 + 可清除 chip） ----------------------------------------

const LANG_CHECK_SVG = '<svg class="check" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10.5 4 4 8-9"/></svg>';

function langMenuOpen(): boolean {
  return !document.getElementById('lang-menu')!.hidden;
}

function closeLangMenu(focusButton = false): void {
  document.getElementById('lang-menu')!.hidden = true;
  const btn = document.getElementById('lang-filter')!;
  btn.setAttribute('aria-expanded', 'false');
  if (focusButton) btn.focus();
}

function setLangFilter(value: string): void {
  localStorage.setItem('blc-lang-filter', value);
  void refresh();
}

/** 筛选值驱动 UI：chip 文案/显隐、globe 高亮与圆点、菜单项与计数（计数按语言过滤前的 entries）。 */
function renderLangControls(filter: string, langs: string[], entries: EntryView[]): void {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const l = effectiveEntryLanguage(e) ?? '';
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const active = filter !== 'all';
  const label = active ? languageLabel(filter) : '';
  const btn = document.getElementById('lang-filter')!;
  btn.classList.toggle('on', active);
  setLocalizedAttribute(btn, 'title', active ? message('语言筛选：{language}', {language:label}) : message('语言筛选'));
  setLocalizedAttribute(btn,'aria-label',active ? message('语言筛选：{language}',{language:label}) : message('语言筛选'));
  document.getElementById('lang-chip')!.hidden = !active;
  if (active) setText(document.getElementById('lang-chip-label')!,label);
  const menu = document.getElementById('lang-menu')!;
  menu.textContent = '';
  const item = (value: string, text: string | UiText, count: number) => {
    const b = el('button', filter === value ? 'cur' : undefined);
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(filter === value));
    b.innerHTML = LANG_CHECK_SVG;
    b.append(el('span', undefined, text), el('span', 'cnt', String(count)));
    b.addEventListener('click', () => {
      closeLangMenu();
      setLangFilter(value);
    });
    menu.appendChild(b);
  };
  item('all', message('全部语言'), entries.length);
  item('und', message('待确认'), counts.get('und') ?? 0);
  for (const l of langs) if (l !== 'und') item(l, languageLabel(l), counts.get(l) ?? 0);
}

document.getElementById('lang-filter')!.addEventListener('click', () => {
  if (langMenuOpen()) closeLangMenu();
  else {
    document.getElementById('lang-menu')!.hidden = false;
    document.getElementById('lang-filter')!.setAttribute('aria-expanded', 'true');
  }
});
document.getElementById('lang-chip-clear')!.addEventListener('click', () => setLangFilter('all'));
document.addEventListener('pointerdown', (e) => {
  if (langMenuOpen() && !e.composedPath().includes(document.getElementById('search-combo')!)) closeLangMenu();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && langMenuOpen()) {
    e.preventDefault();
    closeLangMenu(true);
  }
});

// ---- 字幕视图（当前标签页的视频） ---------------------------------------------------

let subsState: SubViewState | null = null;
let subsPollGeneration=0;
let subsTabId: number | null = null;
let cachedVideo: WorkspaceState | null=null;
// 字幕视图轮询分快慢路径：快路径（1s）只做 blc-sub-get 与译文/当前句/提示的
// 轻量更新，签名不变直接跳过；慢路径（视频身份变化立即，平时 ≥5s 一次，或
// vocab/sentences 广播置脏）才做三连 IDB 拉取与 statuses/sentences/entries 重建。
let subsLibraryDirty=true;
let subsLibraryAt=0;
const SUBS_LIBRARY_INTERVAL_MS=5000;
let subsSignatureCached='';
const subsSignature=(s:SubViewState)=>`${s.videoId}:${s.trackId}:${s.cues.length}:${s.currentIndex}:${s.cues.reduce((n,c)=>n+(c.zh?1:0),0)}:${s.notice}:${s.chineseVisible!==false}`;
function rebuildCachedVideo(state:SubViewState,library?:{cues?:WorkspaceState['cues'];statuses:WorkspaceState['statuses'];sentences:WorkspaceState['sentences'];entries:WorkspaceState['entries']}):WorkspaceState{
  const cues=library?.cues??(cachedVideo&&cachedVideo.videoId===state.videoId&&cachedVideo.videoRef.trackId===state.trackId&&cachedVideo.cues.length===state.cues.length
    ?cachedVideo.cues
    :state.cues.map(c=>({start:c.startMs,dur:c.endMs-c.startMs,text:c.text,lastOff:0})));
  return {videoId:state.videoId,videoRef:{videoId:state.videoId,trackId:state.trackId,trackKind:state.trackKind==='asr'?'asr':'manual',trackLang:state.trackLang,startMs:0},
    trackLang:state.trackLang||undefined,
    cues,current:state.currentIndex,translations:new Map(state.cues.filter(c=>c.zh).map(c=>[c.id,c.zh!])),
    statuses:library?.statuses??cachedVideo?.statuses??new Map<string,string>(),
    sentences:library?.sentences??cachedVideo?.sentences??[],
    entries:library?.entries??cachedVideo?.entries??[],
    notice:state.notice,chinese:state.chineseVisible!==false};
}
const videoWorkspace=createYoutubeWorkspace({
  bindWords:host=>{
    const events=host.shadowRoot!;
    let selectedAt=0;
    // 字幕列表选区：单词/短语/句段/跨字幕项统一分类；原文行以外（译文、控件）不取
    const rowIndexOf=(node:Node|null|undefined):number|null=>{
      const element=node instanceof Element?node:node?.parentElement??null;
      const row=element?.closest('[data-cue]');
      return row?Number(row.getAttribute('data-cue')):null;
    };
    const enOf=(index:number):Element|null=>events.querySelector(`[data-cue="${index}"] .en`);
    function listSelectionInfo(selection:{text:string;range:Range}):{
      kind:'word'|'phrase'|'sentence'|'cross-cue';raw:string;expression:string|null;
      firstIndex:number;count:number;hasWord:boolean;rect:DOMRect;
    }|null{
      const startIndex=rowIndexOf(selection.range.startContainer);
      const endIndex=rowIndexOf(selection.range.endContainer);
      if(startIndex===null&&endIndex===null)return null;
      const first=startIndex??endIndex!;
      const last=endIndex??startIndex!;
      if(first===last){
        const en=enOf(first);
        if(!en)return null;
        const clamped=clampRangeToElement(selection.range,en);
        const raw=clamped.toString().replace(/\s+/g,' ').trim();
        if(!raw)return null;
        const lang=((cachedVideo?.trackLang||subsState?.trackLang)||'en').split('-')[0]!;
        // 分类与有效表达的统一计算（shared/selection.ts 的 classifyRangeIn）
        const cls=classifyRangeIn(en,clamped,lang);
        if(!cls)return null;
        return {kind:cls.kind,raw,expression:cls.expression,firstIndex:first,count:1,hasWord:cls.hasWord,rect:selection.range.getBoundingClientRect()};
      }
      // 跨字幕项：实际选择的原文（按行收窄到 .en，不含译文/控件文字）
      const parts:string[]=[];
      for(let i=Math.min(first,last);i<=Math.max(first,last);i++){
        const en=enOf(i);
        if(!en)continue;
        const clamped=clampRangeToElement(selection.range,en);
        const part=clamped.toString().replace(/\s+/g,' ').trim();
        if(part)parts.push(part);
      }
      const raw=parts.join(' ').trim();
      if(!raw)return null;
      return {kind:'cross-cue',raw,expression:null,firstIndex:Math.min(first,last),count:Math.abs(last-first)+1,hasWord:false,rect:selection.range.getBoundingClientRect()};
    }
    function listSelectionCandidate(info:{kind:'word'|'phrase'|'sentence'|'cross-cue';raw:string;expression:string|null;firstIndex:number;count:number}):SelectionCandidate|null{
      const state=subsState;
      if(!state?.videoId||!state.trackId||subsTabId===null)return null;
      const source:SelectionCandidate['source']={
        sourceType:'youtube',
        sourceKey:`yt:${state.videoId}`,
        title:state.title||state.videoId,
        url:`https://www.youtube.com/watch?v=${state.videoId}`,
        video:{videoId:state.videoId,trackId:state.trackId,trackKind:state.trackKind==='asr'?'asr':'manual',trackLang:state.trackLang},
      };
      const cue=state.cues[info.firstIndex];
      if(info.kind==='cross-cue'){
        return {at:Date.now(),pageUrl:source.url,text:info.raw,kind:'cross-cue',expression:null,source,
          crossFromMs:cue?.startMs??0,crossCount:info.count};
      }
      if(!cue)return null;
      return {at:Date.now(),pageUrl:source.url,text:info.raw,kind:info.kind,
        expression:info.kind==='sentence'?null:info.expression,
        lang:state.trackLang||undefined,source,
        cue:{index:info.firstIndex,text:cue.text,startMs:cue.startMs,endMs:cue.endMs}};
    }
    document.addEventListener('mouseup',e=>{
      if(currentView!=='subs'||e.composedPath().some(n=>n instanceof Element&&n.matches('#panel-selection-actions,#blc-lookup-popup,#pd-translation')))return;
      const selection=shadowSelection(events);
      if(!selection||!subsState)return;
      const info=listSelectionInfo(selection);
      if(!info)return;
      selectedAt=Date.now();e.stopPropagation();
      document.getElementById('panel-selection-actions')?.remove();
      const buttons=el('div','selection-actions');buttons.id='panel-selection-actions';
      const rect=info.rect;buttons.style.left=Math.max(8,Math.min(rect.left,innerWidth-220))+'px';buttons.style.top=Math.min(rect.bottom+4,innerHeight-44)+'px';
      const selectedVideo=subsState.videoId,selectedCue=subsState.cues[info.firstIndex];
      const candidate=listSelectionCandidate(info);
      if(candidate)void send({type:'selectionCandidateSet',tabId:subsTabId??undefined,candidate});
      // 词/短语翻译用补全/清洗后的有效表达；句段/跨行保持实际选文
      const snapshot={text:info.expression??info.raw,title:subsState.title,url:videoContextUrl(selectedVideo,selectedCue?.startMs??0)};
      // 分类表：word=查词+对话；phrase=查词+翻译+对话；sentence/cross-cue=翻译+对话
      if(info.kind!=='word'){
        const translate=el('button',undefined,message('翻译'));translate.onmousedown=e=>e.preventDefault();translate.onclick=()=>{buttons.remove();selectionPopup.open(snapshot,rect);};buttons.append(translate);
      }
      if((info.kind==='word'||info.kind==='phrase')&&info.hasWord&&info.raw.length<=200){
        const lookup=el('button',undefined,message('查词'));lookup.onmousedown=e=>e.preventDefault();lookup.onclick=()=>{buttons.remove();if(subsState?.videoId===selectedVideo)void videoAction('lookup',info.firstIndex,info.expression??info.raw);};buttons.append(lookup);
      }
      const chat=el('button','blc-chat-add');setLocalizedAttribute(chat, 'title', message('添加到对话'));setLocalizedAttribute(chat, 'aria-label', message('添加到对话'));chat.innerHTML=CHAT_ADD_ICON;
      chat.onmousedown=e=>e.preventDefault();
      chat.onclick=()=>{buttons.remove();if(candidate)void attachSelectionCandidate(candidate,{tabId:subsTabId??undefined});};
      buttons.append(chat);
      const close=el('button',undefined,'×');setLocalizedAttribute(close, 'aria-label', message('关闭选区操作'));close.onclick=()=>buttons.remove();buttons.append(close);document.body.append(buttons);
    });
    const wordOf=(e:Event)=>(e.composedPath()[0] as Element)?.closest?.('.w') as HTMLElement|null;
    const openWord=(word:HTMLElement,compact:boolean)=>openPanelWord(word.textContent??'',Number(word.closest('[data-cue]')?.getAttribute('data-cue')),word,compact);
    events.addEventListener('pointerover',e=>{const word=wordOf(e);if((e as PointerEvent).buttons||!word||word===hoveredWord||(lookupPopup.isOpen()&&!lookupPopup.isCompact()))return;clearTimeout(wordTimer);clearTimeout(closeTimer);wordTimer=setTimeout(()=>{if(!getSelection()?.toString()){hoveredWord=word;openWord(word,true);}},180);});
    events.addEventListener('pointerdown',()=>{clearTimeout(wordTimer);});
    events.addEventListener('pointerout',()=>{clearTimeout(wordTimer);closeTimer=setTimeout(()=>{if(lookupPopup.isCompact()){lookupPopup.close();hoveredWord=null;}},220);});
    events.addEventListener('click',e=>{if(Date.now()-selectedAt<500||getSelection()?.toString())return;const w=wordOf(e);if(!w)return;clearTimeout(wordTimer);clearTimeout(closeTimer);if(w===hoveredWord&&lookupPopup.isOpen()){if(lookupPopup.isCompact())lookupPopup.expand();else lookupPopup.close();}else{hoveredWord=w;openWord(w,false);}});
    events.addEventListener('focusin',e=>{const w=wordOf(e);if(w&&w!==hoveredWord){hoveredWord=w;openWord(w,true);}});
    events.addEventListener('keydown',e=>{const key=e as KeyboardEvent,w=wordOf(e);if(w&&(key.key==='Enter'||key.key===' ')){key.preventDefault();hoveredWord=w;openWord(w,false);}});
  },
  words:(parent,text)=>{const lang=((cachedVideo?.trackLang||subsState?.trackLang)||'en').split('-')[0]!;let last=0;for(const s of segmentWords(text,lang)){if(s.start>last)parent.append(document.createTextNode(text.slice(last,s.start)));const w=el('span','w',s.text);w.tabIndex=0;w.setAttribute('role','button');w.style.userSelect='text';parent.append(w);last=s.end;}if(last<text.length)parent.append(document.createTextNode(text.slice(last)));},
  seek:(i,play)=>void videoAction('seek',i,undefined,play),lookup:(word,i,anchor)=>openPanelWord(word,i,anchor,false),
  save:i=>void videoAction('save',i),remove:id=>void send({type:'deleteSentence',id}),
  ask:i=>{if(subsState?.cues[i])void subtitleAskAi(subsState,subsState.cues[i]!);},open:view=>{
    if(view==='review' && subsState?.videoId && subsTabId!==null)beginReview({ category:'vocab', sourceKey:`yt:${subsState.videoId}`, language:normalizeLangTag(subsState.trackLang||'und'), returnTo:'video', video:{state:{...subsState,cues:[]},tabId:subsTabId,workspace:videoWorkspace.snapshot()}, source:{sourceType:'youtube',sourceKey:`yt:${subsState.videoId}`,title:subsState.title,url:videoContextUrl(subsState.videoId,0)} });
    else switchView(view);
  },
  status:(key,status)=>void send({type:'setStatus',key,status}).then(()=>pollSubs()),
},document.getElementById('video-workspace')!);
const articleLearning = createArticleLearning(document.getElementById('web-selection')!, {
  send, entry: (entry,vaultId) => renderEntry(entry, vaultId,true), translate: snapshot => selectionPopup.open(snapshot), changed: () => void persistPanel(),
  review: article => beginReview({ category: article.category, sourceKey:article.source?.sourceKey, source:article.source ?? undefined, language:article.language==='all'?undefined:article.language, returnTo:'article', article }),
});
function openPanelWord(word:string,index:number,anchor:HTMLElement,compact:boolean) {
  const state=subsState,tabId=subsTabId,cue=state?.cues[index];
  if(!state||tabId===null||!cue)return;
  if(lookupTarget!==`${tabId}:${state.videoId}`)lookupPopup.close();
  lookupTarget=`${tabId}:${state.videoId}`;
  const token=crypto.randomUUID();
  let closed=false;
  const resume=()=>void tabSend(tabId,{type:'pd-video-action',videoId:state.videoId,index,action:'resumeLookup',token});
  void tabSend(tabId,{type:'pd-video-action',videoId:state.videoId,index,action:'pauseLookup',token}).then(()=>{if(closed)resume();});
  lookupPopup.open({snapshot:{source:'video',expression:word,sentence:cue.text,title:state.title,lang:state.trackLang||undefined,video:{videoId:state.videoId,trackId:state.trackId,trackKind:state.trackKind==='asr'?'asr':'manual',trackLang:state.trackLang,startMs:cue.startMs}},anchor,compact,subLine:`YouTube · ${fmtClock(cue.startMs)}`,onContinueAsk:()=>void subtitleAskAi(state,cue),onClose:()=>{closed=true;resume();}});
  const card=lookupPopup.host()?.shadowRoot?.querySelector('.card');card?.addEventListener('pointerenter',()=>clearTimeout(closeTimer));card?.addEventListener('pointerleave',()=>{closeTimer=setTimeout(()=>{if(lookupPopup.isCompact()){lookupPopup.close();hoveredWord=null;}},220);});
}
async function videoAction(action:string,index:number,word?:string,play?:boolean) {
  if(subsTabId===null||!subsState?.videoId)return;
  const r=await tabSend<{ok:boolean}>(subsTabId,{type:'pd-video-action',action,index,word,play,videoId:subsState.videoId});
  if(!r?.ok)feedback(message('视频操作失败，请回到原视频重试'));
  else await pollSubs();
}
async function refreshSubsLibrary(state:SubViewState):Promise<void> {
  subsLibraryAt=Date.now();subsLibraryDirty=false;
  const [vocab,saved,index]=await Promise.all([send<{ok:boolean;entries:EntryView[]}>({type:'listEntries'}),send<{ok:boolean;sentences:SavedSentence[]}>({type:'listSentences'}),send<{ok:boolean;items:import('@/shared/vocab').VocabIndexItem[]}>({type:'vocabIndex'})]);
  if(currentView!=='subs'||subsState!==state)return;
  const stable=<T>(old:T,next:T):T=>JSON.stringify(old)===JSON.stringify(next)?old:next;
  const cues=state.cues.map(c=>({start:c.startMs,dur:c.endMs-c.startMs,text:c.text,lastOff:0}));
  cachedVideo=rebuildCachedVideo(state,{
    cues:cachedVideo?.videoId===state.videoId?stable(cachedVideo.cues,cues):cues,
    statuses:buildMarkBuckets(index?.items??[]).get((state.trackLang||'en').split('-')[0]!)?.statusByKey??new Map<string,string>(),
    sentences:stable(cachedVideo?.sentences??[],saved?.sentences??[]),entries:stable(cachedVideo?.entries??[],vocab?.entries??[])});
  videoWorkspace.update(cachedVideo);
}
async function pollSubs():Promise<void> {
  if(currentView!=='subs'||!activePanel)return;
  const generation=++subsPollGeneration;
  const pinned=articleLearning.snapshot();
  if(pinned.pinned){document.getElementById('video-workspace')!.hidden=true;document.getElementById('web-selection')!.hidden=false;await articleLearning.update(pinned.source,null);return;}
  const videoReturn=returnedVideo;
  if(videoReturn){
    const live=await tabSend<SubViewState>(videoReturn.tabId,{type:'blc-sub-get'});
    if(currentView!=='subs'||returnedVideo!==videoReturn||generation!==subsPollGeneration)return;
    if(live?.videoId===videoReturn.state.videoId&&live.trackId===videoReturn.state.trackId)videoReturn.state=live;
    subsTabId=videoReturn.tabId;subsState=videoReturn.state;
    document.getElementById('video-workspace')!.hidden=false;document.getElementById('web-selection')!.hidden=true;
    if(!cachedVideo||subsLibraryDirty||Date.now()-subsLibraryAt>=SUBS_LIBRARY_INTERVAL_MS)await refreshSubsLibrary(subsState);
    if(currentView!=='subs'||returnedVideo!==videoReturn||generation!==subsPollGeneration)return;
    if(restoreReturnedVideo){videoWorkspace.restore(videoReturn.workspace);restoreReturnedVideo=false;}
    else videoReturn.workspace=videoWorkspace.snapshot();return;
  }
  const tab=(await browser.tabs.query({active:true,currentWindow:true}))[0];
  if(typeof tab?.id!=='number')return;
  const id=tab.id;
  const st=await tabSend<SubViewState>(id,{type:'blc-sub-get'});
  if(currentView!=='subs'||generation!==subsPollGeneration)return;
  const switched=subsTabId!==id||subsState?.videoId!==st?.videoId;
  if(switched){lookupPopup.close();selectionPopup.close();document.getElementById('panel-selection-actions')?.remove();}
  // 换轨道不清浮层，但词表按轨道语言分桶，也算身份变化要重建
  if(switched||(subsState?.trackId??'')!==(st?.trackId??''))subsLibraryDirty=true;
  subsTabId=id;subsState=st?.type==='blc-sub-state'?st:null;
  document.getElementById('video-workspace')!.hidden=!subsState?.videoId;
  const web=document.getElementById('web-selection')!;web.hidden=!!subsState?.videoId;
  if(!subsState?.videoId){
    const r=await send<{ok:boolean;snapshot:SelectionSnapshot|null}>({type:'getSelectionSnapshot'});
    if(currentView!=='subs'||generation!==subsPollGeneration)return;
    const info=await tabSend<ChatSourceInfo>(id,{type:'blc-chat-source'});
    if(currentView!=='subs'||generation!==subsPollGeneration)return;
    await articleLearning.update(info?.source??null,r?.snapshot??null);
    return;
  }
  const state=subsState;
  const signature=subsSignature(state);
  if(subsLibraryDirty||Date.now()-subsLibraryAt>=SUBS_LIBRARY_INTERVAL_MS){
    await refreshSubsLibrary(state);
    if(currentView!=='subs'||subsState!==state)return;
    subsSignatureCached=signature;
    return;
  }
  if(cachedVideo&&subsSignatureCached===signature)return;
  subsSignatureCached=signature;
  cachedVideo=rebuildCachedVideo(state);
  videoWorkspace.update(cachedVideo);
}
setInterval(()=>void pollSubs(),1000);
browser.tabs.onActivated.addListener(()=>void pollSubs());
async function control(action:'seek'|'togglePlay'|'replay'|'next'|'prev',timeMs?:number):Promise<void>{if(subsTabId!==null&&subsState?.videoId){await tabSend(subsTabId,{type:'blc-sub-control',videoId:subsState.videoId,action,timeMs});await pollSubs();}}

// 快捷键：输入框 / 编辑区 / 弹窗内不截获
document.addEventListener('keydown', (e) => {
  if (currentView !== 'subs' || !subsState?.videoId) return;
  const t = e.target as HTMLElement | null;
  if (
    t &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' ||
      t.isContentEditable)
  ) {
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'j') void control('next');
  else if (k === 'k') void control('prev');
  else if (k === 'r') void control('replay');
  else return;
  e.preventDefault();
});

// ---- 复习视图（M4：原句回忆，无 AI） -------------------------------------------------

let reviewQueue: ReviewItem[] = [];
let knowledgeQueue: KnowledgeRecord[] = [];
let reviewSession: ReviewSession = { category: 'vocab', returnTo: 'list' };
let reviewIdx = 0;
let revealed = false;
let definitionRevealed = false;
let reviewOperation = 0;

function moveReview(index: number) {
  reviewIdx = index;
  revealed = false;
  definitionRevealed = false;
  renderReview();
}

function shuffleReview() {
  const queue: (ReviewItem | KnowledgeRecord)[] = reviewSession.category === 'knowledge' ? knowledgeQueue : reviewQueue;
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j]!, queue[i]!];
  }
  moveReview(0);
}

function beginReview(session: ReviewSession) {
  reviewSession = {...structuredClone(session),vaultId:libraryId}; reviewQueue = []; knowledgeQueue = []; reviewIdx = 0; revealed = false; definitionRevealed = false;
  if(currentView==='review')void startReview();else switchView('review');
}
function exitReview() {
  if (reviewSession.returnTo === 'article' && reviewSession.article) articleLearning.restore({ ...reviewSession.article, pinned: true });
  if(reviewSession.returnTo==='video' && reviewSession.video){returnedVideo=structuredClone(reviewSession.video);restoreReturnedVideo=true;}
  switchView(reviewSession.returnTo === 'list' ? 'list' : 'subs');
}

async function startReview(): Promise<void> {
  const operation=++reviewOperation, session=reviewSession;
  if(session.vaultId===undefined)session.vaultId=libraryId;
  if(session.category==='knowledge') {
    const r=await send<{ok:boolean;records:KnowledgeRecord[];vaultId:string|null}>({type:'listKnowledge'});
    if(currentView!=='review'||operation!==reviewOperation)return;
    if(!r?.ok){feedback(message('加载失败，请重试'));return;}
    if(r.vaultId!==session.vaultId){void checkLearningLibrary();return;}
    knowledgeQueue=r.records.filter(k=>(!session.sourceKey||k.source.sourceKey===session.sourceKey)&&(!session.language||k.language===session.language));
    moveReview(0);return;
  }
  const r = await send<{ ok: boolean; entries?: EntryView[];vaultId:string|null }>({ type: 'listEntries' });
  if (currentView !== 'review'||operation!==reviewOperation) return;
  if(!r?.ok||!r.entries){feedback(message('加载失败，请重试'));return;}
  if(r.vaultId!==session.vaultId){void checkLearningLibrary();return;}
  if(!session.language) {
    const body=document.getElementById('review-body')!;body.replaceChildren(el('p',undefined,message('请选择一种语言开始复习')));
    for(const lang of [...new Set(scopeEntries(r.entries,session).map(e=>effectiveEntryLanguage(e)??'und'))].sort()) {
      const button=el('button','ghost',languageLabel(lang));button.onclick=()=>{session.language=lang;void startReview();};body.append(button);
    }
    const back=el('button','ghost',message('退出复习'));back.onclick=exitReview;body.append(back);void persistPanel();return;
  }
  reviewQueue = buildReviewQueue(r.entries,session);
  moveReview(0);
}

function renderReview(): void {
  if (currentView !== 'review') return;
  const body = document.getElementById('review-body')!;
  body.textContent = '';
  const knowledge=reviewSession.category==='knowledge';
  const length=knowledge?knowledgeQueue.length:reviewQueue.length;
  const scope=el('p','hint');scope.append(el('span',undefined,message(knowledge?'知识点':'生词')));
  if(reviewSession.source)scope.append(document.createTextNode(` · ${reviewSession.source.title || reviewSession.source.url}`));
  if(reviewSession.language){scope.append(document.createTextNode(' · '));scope.append(el('span',undefined,languageLabel(reviewSession.language)));}
  body.append(scope);
  void persistPanel();

  const backBtn = () => {
    const b = el('button', 'ghost', message(reviewSession.returnTo==='list'?'返回生词本':'返回当前内容'));
    b.addEventListener('click', exitReview);
    return b;
  };

  if (!length) {
    body.appendChild(
      el('div', 'empty', message(knowledge?'本范围内没有知识点':'没有可复习的词条。收藏的 saved / learning 词条会出现在这里。')),
    );
    const row = el('div', 'review-actions');
    row.appendChild(backBtn());
    body.appendChild(row);
    return;
  }
  const navigation = el('div', 'review-navigation');
  const previous = el('button', 'ghost', message('上一条'));
  previous.disabled = reviewIdx === 0;
  previous.onclick = () => moveReview(reviewIdx - 1);
  const jump = el('select');
  setLocalizedAttribute(jump, 'aria-label', message('跳转题目'));
  if (reviewIdx >= length) {
    const placeholder = el('option', undefined, message('跳转题目'));
    placeholder.value = ''; placeholder.disabled = true; jump.append(placeholder);
  }
  for (let index = 0; index < length; index++) {
    const option = el('option', undefined, `${index + 1} / ${length}`);
    option.value = String(index); jump.append(option);
  }
  jump.value = reviewIdx >= length ? '' : String(reviewIdx);
  jump.onchange = () => moveReview(Number(jump.value));
  const next = el('button', 'ghost', message('下一条'));
  next.disabled = reviewIdx >= length;
  next.onclick = () => moveReview(reviewIdx + 1);
  const shuffle = el('button', 'ghost', message('打乱顺序'));
  shuffle.disabled = length < 2; shuffle.onclick = shuffleReview;
  navigation.append(previous, jump, next, shuffle); body.append(navigation);
  if (reviewIdx >= length) {
    body.appendChild(el('div', 'empty', message('本轮复习完成 🎉')));
    const row = el('div', 'review-actions');
    const again = el('button', undefined, message('再来一轮'));
    again.addEventListener('click', () => void startReview());
    row.appendChild(again);
    row.appendChild(backBtn());
    body.appendChild(row);
    return;
  }

  if(knowledge) {
    const item=knowledgeQueue[reviewIdx]!;
    body.append(el('p','review-progress',`${reviewIdx+1} / ${length}`),el('h2',undefined,item.title));
    if(revealed)appendKnowledgeBody(body,item);
    const actions=el('div','review-actions');
    const reveal=el('button',undefined,message('揭示'));reveal.onclick=()=>{revealed=true;renderReview();};
    const source=el('a','source',message('返回来源'));source.href=item.source.url;source.target='_blank';source.rel='noopener';
    if(!revealed)actions.append(reveal);
    actions.append(source,backBtn());body.append(actions);return;
  }
  const it = reviewQueue[reviewIdx]!;
  const prog = el('div', 'review-progress');
  setText(prog,message('{index} / {count} · {status}',{index:reviewIdx+1,count:reviewQueue.length,status:message(VOCAB_STATUS_LABEL[it.status])}));
  body.appendChild(prog);

  const card = el('div', 'review-card');
  const { text, count } = blankExpression(it.sentence, it.expression);
  const sentence = el('p', 'sentence', count ? text : it.sentence);
  if (!count) setLocalizedAttribute(sentence, 'title', message('（原句中未找到该表达的精确匹配）'));
  card.appendChild(sentence);

  const meta = el('div', 'review-meta');
  const src = el('a', 'source');
  src.href = it.url;
  src.target = '_blank';
  src.rel = 'noopener';
  src.textContent =
    it.sourceType === 'video' && it.video
      ? `YouTube · ${fmtClock(it.video.startMs)}`
      : hostOf(it.url);
  src.title = it.title;
  meta.appendChild(src);
  meta.appendChild(el('time', 'time', fmtTime(it.createdAt)));
  card.appendChild(meta);

  if (revealed) {
    const rv = el('div', 'review-reveal');
    rv.appendChild(el('div', 'word', it.expression));
    card.appendChild(rv);
  }
  const annotation = el('div', 'review-annotation');
  if (definitionRevealed) {
    const meaning = it.definition || generalMeaning(it.reference);
    if (!it.definition && meaning && it.reference) annotation.append(el('p', 'hint', meaningSource(it.reference)));
    annotation.append(meaning ? el('p', 'definition', meaning) : el('div', 'no-def', message('未保存释义')));
  } else {
    const revealMeaning = el('button', 'ghost', message('显示释义'));
    revealMeaning.onclick = () => { definitionRevealed = true; renderReview(); };
    annotation.append(revealMeaning);
  }
  card.append(annotation);

  const actions = el('div', 'review-actions');
  if (!revealed) {
    const reveal = el('button', undefined, message('显示单词'));
    reveal.addEventListener('click', () => {
      revealed = true;
      renderReview();
    });
    actions.appendChild(reveal);
  } else {
    const learn = el('button', 'ghost', message('在学'));
    learn.addEventListener('click', () => void reviewStatus('learning'));
    actions.appendChild(learn);
    const known = el('button', undefined, message('已掌握'));
    known.addEventListener('click', () => void reviewStatus('known'));
    actions.appendChild(known);
    const back = el('button', 'ghost', message('返回来源'));
    back.addEventListener('click', () => {
      if(it.sourceType==='video')window.open(it.url, '_blank', 'noopener');
      else void locateSavedText(it.url,it.sentence).then(found=>feedback(message(found?'已定位到原文':'页面已变化，显示保存的原文'),true));
    });
    actions.appendChild(back);
  }
  const exit = el('button', 'ghost', message('退出复习'));
  exit.addEventListener('click', exitReview);
  actions.appendChild(exit);
  card.appendChild(actions);
  body.appendChild(card);
}

async function reviewStatus(status: VocabStatus): Promise<void> {
  const it = reviewQueue[reviewIdx];
  if (!it) return;
  const session=reviewSession;
  // Advance before the broadcast can rebuild the queue around the following card.
  revealed = false;
  definitionRevealed = false;
  reviewIdx++;
  renderReview();
  const r=await send<{ok:boolean}>({ type: 'setStatus', key: it.key, status, vaultId:session.vaultId });
  if(!r?.ok&&session===reviewSession){reviewIdx=Math.max(0,reviewQueue.findIndex(item=>item.key===it.key));feedback(message('保存失败，请重试'));renderReview();}
}

// 词条被删除 / 改状态后队列及时更新（保持位置）
async function refreshReviewQueue(): Promise<void> {
  if (currentView !== 'review') return;
  const session=reviewSession;
  if(session.category==='knowledge') {
    const r=await send<{ok:boolean;records:KnowledgeRecord[];vaultId:string|null}>({type:'listKnowledge'});
    if(currentView!=='review'||session!==reviewSession||!r?.ok)return;
    if(r.vaultId!==session.vaultId){void checkLearningLibrary();return;}
    const done=knowledgeQueue.length>0&&reviewIdx>=knowledgeQueue.length;
    const key=knowledgeQueue[reviewIdx]?.id;
    const old=knowledgeQueue[reviewIdx];
    const following=knowledgeQueue.slice(reviewIdx+1).map(item=>item.id),previousIndex=reviewIdx;
    const order = new Map(knowledgeQueue.map((item,index)=>[item.id,index]));
    knowledgeQueue=r.records.filter(k=>(!session.sourceKey||k.source.sourceKey===session.sourceKey)&&(!session.language||k.language===session.language))
      .sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity));
    let idx=knowledgeQueue.findIndex(k=>k.id===key);
    if(idx<0){const next=following.find(id=>knowledgeQueue.some(k=>k.id===id));idx=next?knowledgeQueue.findIndex(k=>k.id===next):Math.min(previousIndex,knowledgeQueue.length);}
    reviewIdx=done?knowledgeQueue.length:idx;
    if(vaultRecordJson(old)!==vaultRecordJson(knowledgeQueue[reviewIdx]))revealed=false;
    renderReview();return;
  }
  if(!session.language)return;
  const r = await send<{ ok: boolean; entries?: EntryView[];vaultId:string|null }>({ type: 'listEntries' });
  if (currentView !== 'review' ||session!==reviewSession|| !r?.ok || !r.entries) return;
  if(r.vaultId!==session.vaultId){void checkLearningLibrary();return;}
  const done=reviewQueue.length>0&&reviewIdx>=reviewQueue.length;
  const old=reviewQueue[reviewIdx];
  const currentKey = reviewQueue[reviewIdx]?.key ?? null;
  const { queue, currentIndex } = refreshQueue(reviewQueue, currentKey, r.entries, session);
  reviewQueue = queue;
  reviewIdx = done?queue.length:currentIndex;
  if(vaultRecordJson(old)!==vaultRecordJson(reviewQueue[reviewIdx])){revealed=false;definitionRevealed=false;}
  if (reviewIdx >= reviewQueue.length) {revealed=false;definitionRevealed=false;}
  renderReview();
}

// ---- 广播 -----------------------------------------------------------------------

browser.runtime.onMessage.addListener((msg: unknown) => {
  const t = (msg as { type?: string })?.type;
  if (t === 'vocab-changed') {
    articleLearning.invalidate();
    subsLibraryDirty=true;
    if (currentView === 'list') void refresh();
    if (currentView === 'review') void refreshReviewQueue();
    if (currentView === 'subs') void pollSubs();
  }
  if(t==='knowledge-changed') {
    articleLearning.invalidate();
    if(currentView==='subs')void pollSubs();
    if(currentView==='review'&&reviewSession.category==='knowledge')void refreshReviewQueue();
  }
  if(t==='vault-changed')void checkLearningLibrary();
  if (t === 'sentences-changed') {
    subsLibraryDirty=true;
    if (currentView === 'sentences') void refreshSentences();
    if (currentView === 'subs') void pollSubs();
  }
  if (t === 'settings-changed') {
    /* 内容标记开关变化不影响侧栏自身展示 */
  }
});

initChatView({ getActiveView: () => currentView, switchView });
async function checkLearningLibrary() {
  const r=await send<{ok:boolean;records:KnowledgeRecord[];vaultId:string|null}>({type:'listKnowledge'});
  if(!r?.ok||r.vaultId===libraryId)return;
  libraryId=r.vaultId;reviewOperation++;subsPollGeneration++;reviewQueue=[];knowledgeQueue=[];reviewIdx=0;revealed=false;definitionRevealed=false;reviewSession={category:'vocab',returnTo:'list'};
  articleLearning.reset();returnedVideo=null;subsLibraryDirty=true;cachedVideo=null;
  if(currentView==='review')switchView('list');else if(currentView==='subs')void pollSubs();
  void persistPanel();
}
onDisplayLanguageChange(()=>{document.documentElement.lang=getDisplayLocale();localize(document);});

async function boot(){
 await initDisplayLanguage();
 document.documentElement.lang=getDisplayLocale();localize(document);
 const ctx=await send<{ok:boolean;windowId:number;tabId:number;documentId:string;floating:boolean;fullscreen:boolean;active:boolean}>({type:'panelContext'});
 if(!ctx?.ok){workspaceFailed('context',new Error('panel-context-unavailable'));return;}
 panelDocumentId=ctx.documentId;
 const library=await send<{ok:boolean;vaultId:string|null}>({type:'listKnowledge'});libraryId=library?.vaultId??null;
 panelWindow=ctx.windowId;panelTabId=ctx.tabId;floating=ctx.floating;inVideoFullscreen=ctx.fullscreen;
 activePanel=ctx.active;setChatActive(activePanel);
 const mode=document.getElementById('panel-mode')!;setText(mode, floating?message('固定'):message('浮动'));setLocalizedAttribute(mode, 'aria-label', floating?message('切换为固定侧栏'):message('切换为浮动面板'));
 const snapshot=(await browser.storage.session.get(panelStateKey(panelWindow)))[panelStateKey(panelWindow)] as PanelSnapshot|undefined;
 const stored=snapshot?.vaultId===libraryId?snapshot:undefined;
 if(stored){savedScroll=stored.scroll??{};reviewQueue=stored.reviewQueue??[];reviewIdx=stored.reviewIdx??0;revealed=!!stored.revealed;definitionRevealed=!!stored.definitionRevealed;previousView=stored.previousView??'list';(document.getElementById('search') as HTMLInputElement).value=stored.search??'';}
 if(stored?.reviewSession)reviewSession=stored.reviewSession;else reviewQueue=[];
 knowledgeQueue=stored?.knowledgeQueue??[];
 if(stored?.article)articleLearning.restore(stored.article);
 returnedVideo=stored?.returnedVideo??null;
 restoreReturnedVideo=!!returnedVideo;
 const hash=location.hash.slice(1);switchView(isPanelView(hash)?hash:isPanelView(stored?.view)?stored.view:'subs');
 await restoreChat(stored?.chat);
 if(stored?.video){await pollSubs();videoWorkspace.restore(stored.video);}
 // 启动时不由可见性事件打断恢复；就绪后按实际可见性同步聊天状态。
 ready=activePanel;setChatActive(activePanel&&document.visibilityState!=='hidden');document.body.inert=!activePanel;
 workspaceInitialized=true;
 browser.runtime.onMessage.addListener((m:unknown)=>{const v=m as {type?:string;windowId?:number;tabId?:number;mode?:string;view?:unknown;origin?:string;at?:number};if(v.type==='pd-popup-outside'&&v.windowId===panelWindow&&v.origin==='page'){document.dispatchEvent(new CustomEvent('pd-popup-outside',{detail:{at:v.at}}));return;}if(v.type==='pd-panel-closed'&&v.windowId===panelWindow){void restoreChat();return;}if(v.type==='pd-panel-view'&&v.windowId===panelWindow){activePanel=v.mode===(floating?'floating':'fixed')&&(!floating||v.tabId===panelTabId);setChatActive(false);restoreVersion++;ready=false;document.body.inert=true;if(activePanel)void restorePanel(v.view).catch(error=>workspaceFailed('restore',error));}});
 if(floating)void send({type:'panelReady'});
 browser.runtime.onMessage.addListener((m:unknown)=>{const v=m as {type?:string;tabId?:number;fullscreen?:boolean};if(v.type==='pd-panel-fullscreen'&&v.tabId===panelTabId)inVideoFullscreen=!!v.fullscreen;});
}
let restoreVersion=0;
async function restorePanel(view?:unknown) {
  const version=++restoreVersion;
  ready=false;document.body.inert=true;setChatActive(false);
  const snapshot=(await browser.storage.session.get(panelStateKey(panelWindow)))[panelStateKey(panelWindow)] as PanelSnapshot|undefined;
  const s=snapshot?.vaultId===libraryId?snapshot:undefined;
  if(version!==restoreVersion)return;
  if(s) {
    savedScroll=s.scroll??{};previousView=s.previousView??'list';
    reviewQueue=s.reviewQueue??[];reviewIdx=s.reviewIdx??0;revealed=!!s.revealed;definitionRevealed=!!s.definitionRevealed;
    reviewSession=s.reviewSession??{category:'vocab',returnTo:'list'};knowledgeQueue=s.knowledgeQueue??[];
    if(!s.reviewSession)reviewQueue=[];
    if(s.article)articleLearning.restore(s.article);
    returnedVideo=s.returnedVideo??null;
    restoreReturnedVideo=!!returnedVideo;
    (document.getElementById('search') as HTMLInputElement).value=s.search??'';
    if(isPanelView(view))switchView(view);else if(isPanelView(s.view))switchView(s.view);
    if(currentView==='review')renderReview();
    setChatActive(activePanel);await restoreChat(s.chat);
    if(version!==restoreVersion)return;
    if(s.video){await pollSubs();videoWorkspace.restore(s.video);}
    currentMain()?.scrollTo(0,savedScroll[currentView]??0);
  }
  if(version!==restoreVersion)return;
  workspaceFailureStage='';setChatActive(activePanel&&document.visibilityState!=='hidden');ready=true;document.body.inert=false;
}
document.addEventListener('visibilitychange',()=>{if(!ready)return;if(document.visibilityState==='hidden'){void saveDraft(true);void persistPanel();setChatActive(false);}else setChatActive(activePanel);});
void boot().catch(error=>workspaceFailed('boot',error));
