import { applyAppearance } from '@/shared/appearance';
import { t as tr, localize, onDisplayLanguageChange, initDisplayLanguage, getDisplayLocale , message, setText, setLocalizedAttribute, languageLabel, type UiText } from '@/shared/i18n';
import '@/shared/theme.css';
import { mountSettings } from '@/shared/settingsView';
import { createYoutubeWorkspace, type WorkspaceState } from '@/shared/youtubeWorkspace';
import { isPanelView, panelStateKey, panelTransportFailure, type SelectionSnapshot, type PanelFrameState } from '@/shared/panel';
import { createTranslationPopup } from '@/shared/translationPopup';
import { createLookupPopup } from '@/shared/lookupPopup';
import { shadowSelection, classifyRangeIn } from '@/shared/selection';
import { buildMarkBuckets } from '@/shared/marker';
import { effectiveEntryLanguage, isRtlLanguage, langDisplayName, normalizeLangTag } from '@/shared/languages';
import { segmentWords } from '@/shared/tokenize';
import { materialFromCandidate, type SelectionCandidate } from '@/shared/chat';
import { CHAT_ADD_ICON } from '@/shared/brand';
// 侧栏三个视图：生词本（词条 / 上下文 / 词形关联管理）、字幕（当前标签页
// 视频的原文列表 + 译文 + 播放控制）、复习（原句回忆，无 AI 调用）。
// 数据全部来自 background 的 IndexedDB；vocab-changed 广播后刷新。
// 字幕控制消息经 tabs.sendMessage 直达当前标签页，携带 videoId 防串页。

import { choiceMenu, iconButton, learningStatus, uiIcon } from '@/shared/uiControls';
import type { EntryView, SubViewState, ChatSourceInfo, SubtitleRowAction, SubtitleRowOperation, SubtitleRowRef } from '@/shared/messages';
import { videoContextUrl, blankExpression, generalMeaning, VOCAB_STATUS_LABEL, visibleVocabStatus, type LearningResult, type SavedSentence, type VocabStatus } from '@/shared/vocab';
import { buildReviewQueue, refreshQueue, scopeEntries, type LearningScope, type ReviewItem } from '@/shared/review';
import { createArticleLearning, articleSource, type ArticleLearningSnapshot, type LearningCategory } from './articleLearning';
import { appendKnowledgeBody, knowledgeRow } from './knowledgeView';
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
interface PanelSnapshot {settingsAi?:boolean;vaultId?:string|null;view?:string;previousView?:string;search?:string;reviewQueue?:ReviewItem[];reviewIdx?:number;revealed?:boolean;definitionRevealed?:boolean;reviewSession?:ReviewSession;knowledgeQueue?:KnowledgeRecord[];article?:ArticleLearningSnapshot;returnedVideo?:ReturnedVideo|null;scroll?:Record<string,number>;video?:{tab?:string;follow?:boolean;top?:number};chat?:ChatViewSnapshot}
const settingsView=mountSettings(document.getElementById('settings-body')!, {
  active: () => currentView === 'settings' && activePanel,
  tab: async () => floating ? (panelTabId >= 0 ? panelTabId : undefined) : (await browser.tabs.query({active:true,windowId:panelWindow >= 0 ? panelWindow : undefined,currentWindow:panelWindow < 0 ? true : undefined}))[0]?.id,
});
const selectionPopup=createTranslationPopup(send);
let closePanelSelectionActions = () => {document.getElementById('panel-selection-actions')?.remove();};
const lookupPopup=createLookupPopup({send});
let hoveredWord:HTMLElement|null=null;
let wordTimer:ReturnType<typeof setTimeout>|undefined;
let closeTimer:ReturnType<typeof setTimeout>|undefined;
let lookupTarget='';
const currentMain=()=>document.getElementById('view-'+currentView);
const searchInput = document.querySelector<HTMLInputElement>('#search')!;
let listGeneration = 0;
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
  if (view === currentView) {if(view==='knowledge')void refreshKnowledge();return;}
  feedback('');
  lookupPopup.close();document.querySelector<HTMLElement>('#language-filter :popover-open')?.hidePopover();closePanelSelectionActions();
  const prev = currentView;
  subsPollGeneration++;
  if (prev === 'subs' && view !== 'review') {articleLearning.follow();returnedVideo=null;}
  if (prev === 'chat' && view !== 'chat') chatViewLeave();
  savedScroll[prev]=currentMain()?.scrollTop??0;
  if(view==='settings' && prev!=='settings')previousView=prev||'list';
  currentView = view;
  history.replaceState(null,'',`#${view}`);
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#views button')) {
    const selected = btn.dataset.view === (view==='review'&&reviewSession.returnTo!=='list'?'subs':['list','sentences','knowledge','review'].includes(view)?'list':view);
    btn.classList.toggle('active', selected);
    if (selected) btn.setAttribute('aria-current','page'); else btn.removeAttribute('aria-current');
  }
  renderWorkspaceTitle();
  document.getElementById('open-settings')!.setAttribute('aria-pressed',String(view==='settings'));
  document.getElementById('view-sentences')!.hidden = view !== 'sentences';
  document.getElementById('view-list')!.hidden = view !== 'list';
  document.getElementById('view-knowledge')!.hidden = view !== 'knowledge';
  document.getElementById('review-library')!.hidden = view === 'knowledge';
  document.getElementById('view-subs')!.hidden = view !== 'subs';
  document.getElementById('view-review')!.hidden = view !== 'review';
  document.getElementById('view-chat')!.hidden = view !== 'chat';
  document.getElementById('view-settings')!.hidden = view !== 'settings';
  document.getElementById('library-tools')!.hidden = !['list','sentences','knowledge'].includes(view);
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.library-tabs button:not(#review-library)')) {
    const selected = tab.dataset.view===view;
    tab.classList.toggle('active',selected);
    tab.setAttribute('aria-pressed',String(selected));
  }
  currentMain()?.scrollTo(0,savedScroll[view]??0);
  document.getElementById('language-filter')!.hidden = view === 'sentences';
  setLocalizedAttribute(searchInput, 'aria-label', message(view === 'sentences' ? '搜索句子' : view === 'knowledge' ? '搜索知识点标题或正文' : '搜索表达'));
  // 侧栏各视图共用同一连接；显式停止或窗口关闭才停止生成
  if (view === 'chat') chatViewEnter();
  if (['list','sentences','knowledge'].includes(view)) void refresh();
  if (view === 'sentences') (libraryReview as HTMLButtonElement).disabled=false;
  if (view === 'subs') pollSubs();
  if (view === 'review') {if(reviewQueue.length||knowledgeQueue.length){renderReview();void refreshReviewQueue();}else void startReview();}
  if (view === 'settings')void settingsView.refresh();
  void persistPanel();
}

function labelIcon(button: HTMLElement, icon: Parameters<typeof uiIcon>[0], label: UiText) {
  button.innerHTML = uiIcon(icon);
  setLocalizedAttribute(button,'title',label);
  setLocalizedAttribute(button,'aria-label',label);
}

const workspaceTitle = document.getElementById('workspace-title')!;
const workspaceBack = document.getElementById('workspace-back')! as HTMLButtonElement;
function renderWorkspaceTitle() {
  workspaceBack.hidden = currentView !== 'settings' && currentView !== 'review';
  workspaceTitle.classList.toggle('reading-title',currentView==='subs');
  if (currentView === 'review') {
    const scope = reviewSession.source?.title || reviewSession.source?.url;
    setText(workspaceTitle, message('{scope} · {category}', {
      scope: scope || message(reviewSession.returnTo==='list'?'生词本':'当前内容'),
      category: message(reviewSession.category==='knowledge'?'知识点':'生词'),
    }));
    labelIcon(workspaceBack,'back',message(reviewSession.returnTo==='list'?'返回生词本':'返回当前内容'));
  } else {
    const label = currentView==='settings' ? '设置' : currentView==='subs' ? '当前内容' : currentView==='chat' ? '空白对话标题' : '生词本';
    setText(workspaceTitle,message(label));
    if (currentView==='settings') labelIcon(workspaceBack,'back',message('返回'));
  }
}
function renderArticleTitle(source: SourceDescriptor | null) {
  if (currentView !== 'subs' || !document.getElementById('video-workspace')!.hidden) return;
  if (!source) {setText(workspaceTitle,message('当前内容'));return;}
  const old = workspaceTitle.querySelector('a');
  if (old?.href===source.url && old.dataset.sourceTitle===source.title) return;
  const link = el('a','article-source',source.title || message('当前内容'));
  link.href=source.url;link.title=source.url;link.dataset.sourceTitle=source.title;
  link.target='_blank';link.rel='noopener';
  setText(workspaceTitle,'');
  workspaceTitle.append(link);
}
function renderVideoTitle(title: string) {
  if (title) {
    if (workspaceTitle.textContent!==title || workspaceTitle.firstElementChild) setText(workspaceTitle,title);
  } else if (workspaceTitle.getAttribute('data-i18n')!=='当前内容') setText(workspaceTitle,message('当前内容'));
}
workspaceBack.onclick = () => currentView==='review' ? exitReview() : switchView(previousView);

for (const [view,icon,label] of [['subs','article','当前内容'],['list','library','生词本'],['chat','chat','AI 问答']] as const) {
  labelIcon(document.querySelector<HTMLElement>(`#views [data-view="${view}"]`)!,icon,message(label));
}
labelIcon(document.getElementById('open-settings')!,'settings',message('设置'));
labelIcon(document.getElementById('panel-close')!,'close',message('关闭面板'));
document.querySelector('.search-icon')!.innerHTML = uiIcon('search');
const libraryReview = document.getElementById('review-library')!;
libraryReview.innerHTML = uiIcon('review');
setLocalizedAttribute(libraryReview, 'title', message('原句复习'));
setLocalizedAttribute(libraryReview, 'aria-label', message('原句复习'));

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  btn.addEventListener('click', () => { if (btn.dataset.view === 'review') beginReview({category:'vocab', returnTo:'list', language: localStorage.getItem('blc-lang-filter') === 'all' ? undefined : localStorage.getItem('blc-lang-filter') ?? undefined}); else switchView(btn.dataset.view!); });
}

document.getElementById('open-settings')!.addEventListener('click', () => switchView('settings'));
document.getElementById('panel-mode')!.addEventListener('click',async()=>{
  if(floating&&inVideoFullscreen){feedback(message('退出视频全屏后可使用固定侧栏'));return;}
  // Native sidePanel.open must run before the first await in the click handler.
  const nativeOpen=floating?browser.sidePanel.open({windowId:panelWindow}).then(()=>true,()=>false):Promise.resolve(false);
  lookupPopup.close();
  await saveDraft(true);await persistPanel();
  const r=await send<{ok:boolean;error?:string}>({type:'panelSwitch',mode:floating?'fixed':'floating',nativeOpened:await nativeOpen});
  if(!r?.ok)feedback(message(r?.error??'切换失败，请重试'));
});
document.getElementById('panel-close')!.addEventListener('click',async()=>{lookupPopup.close();closePanelSelectionActions();await persistPanel();setChatActive(false);activePanel=false;ready=false;const r=await send<{ok:boolean}>({type:'panelClose'});if(!r?.ok){activePanel=true;ready=true;setChatActive(true);feedback(message('关闭失败，请重试'));}});
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
  const generation = ++listGeneration;
  const r = await send<{ ok:boolean; sentences:SavedSentence[] }>({ type:'listSentences' });
  if (currentView !== 'sentences' || generation !== listGeneration) return;
  const body = document.getElementById('sentences-list')!;
  if (!r?.ok) { body.querySelector('.list-retry')?.remove();body.prepend(retryRow(refreshSentences));return; }
  body.replaceChildren();
  const query = searchInput.value.trim().toLocaleLowerCase();
  const sentences = query ? r.sentences.filter(({ text, zh }) =>
    text.toLocaleLowerCase().includes(query) || zh?.toLocaleLowerCase().includes(query),
  ) : r.sentences;
  if (!sentences.length) {
    const empty = el('div', 'empty');
    empty.append(el('span', undefined, message(query ? '没有匹配的句子' : '还没有收藏的字幕句子')));
    if (query) {
      const clear = el('button', undefined, message('清除搜索'));
      clear.onclick = () => {
        searchInput.value = '';
        searchInput.focus();
        void refreshSentences();
      };
      empty.append(clear);
    }
    body.append(empty);
  }
  for (const saved of sentences) {
    const card = el('article', 'entry'); card.append(el('p', 'sentence', saved.text));
    if (saved.zh) card.append(el('p', 'definition', saved.zh));
    const meta = el('div', 'meta');
    const link = el('a', 'source', `${saved.title} · ${fmtClock(saved.video.startMs)}`);
    link.href = videoContextUrl(saved.video.videoId, saved.video.startMs); link.target = '_blank'; link.rel = 'noopener'; meta.append(link);
    const remove = iconButton('saved', message('取消收藏'));
    remove.classList.add('sentence-bookmark');
    const error=el('span','sentence-save-error');error.hidden=true;error.setAttribute('role','status');
    remove.addEventListener('click', async () => {
      if(remove.disabled)return;remove.disabled=true;remove.setAttribute('aria-busy','true');error.hidden=true;
      const result = await send<{ ok:boolean }>({ type:'deleteSentence', id:saved.id });
      if (!result?.ok) {setText(error, message('删除失败，重试'));error.hidden=false;remove.disabled=false;remove.setAttribute('aria-busy','false');}
    });
    meta.append(remove,error); card.append(meta); body.append(card);
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
    src.textContent = `${c.title || 'YouTube'} · ${fmtClock(c.video.startMs)}`;
    setLocalizedAttribute(src,'title',message('{title} · {language} ({kind})',{title:c.title,language:languageLabel(c.video.trackLang),kind:message(c.video.trackKind==='asr'?'自动':'人工')}));
  } else {
    setText(src, c.title || message('打开来源'));
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
    const locate=iconButton('locate',message('定位原句')),status=el('span','hint locate-state');locate.classList.add('locate');status.setAttribute('role','status');
    let noticeTimer: ReturnType<typeof setTimeout> | undefined;
    locate.onclick=async()=>{
      clearTimeout(noticeTimer);
      setText(status,'');
      if (!await locateSavedText(c.url,c.sentence)) {
        setText(status,message('页面已变化，显示保存的原文'));
        noticeTimer=setTimeout(()=>setText(status,''),4000);
      }
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
  const entryLang = effectiveEntryLanguage(entry);
  const entryLabel = entryLang ? message('{word}（{language}）',{word:entry.expression,language:languageLabel(entryLang)}) : entry.expression;
  const title = el('h2','entry-title');
  const word = el('button','expr',entry.expression);
  word.type='button';
  if (typeof entryLabel === 'string') word.setAttribute('aria-label',entryLabel);
  else setLocalizedAttribute(word,'aria-label',entryLabel);
  if (entryLang && isRtlLanguage(entryLang)) word.dir = 'rtl';
  title.append(word);
  const detail = el('div','entry-details');
  detail.hidden = true;
  const expand = iconButton('expand',message('原句与详情'));
  expand.classList.add('entry-expand');
  const toggle = (open: boolean) => {
    detail.hidden = !open;
    word.setAttribute('aria-expanded',String(open));
    expand.setAttribute('aria-expanded',String(open));
  };
  toggle(false);
  word.onclick = expand.onclick = () => toggle(detail.hidden);
  const statusNotice = el('p','hint entry-status-notice');
  statusNotice.setAttribute('role','status');
  const status = learningStatus(entry.expression,entry.status,async value=>{
    const result=await send<{ok:boolean}>({type:'setStatus',key:entry.key,status:value,vaultId});
    setText(statusNotice,result?.ok ? '' : message('保存失败，请重试'));
    return !!result?.ok;
  });
  head.append(title,status,expand);
  const kind = el('span', 'kind', entry.kind === 'word' ? message('词') : message('短语'));
  const identity = el('div','entry-identity');
  identity.append(kind);
  if (entryLang) identity.append(el('span','kind',languageLabel(entryLang)));
  const noteEdit = iconButton('edit', message('编辑笔记'));

  const del = iconButton('trash', message('删除'));
  del.classList.add('ui-danger');
  del.addEventListener('click', async () => {
    if (!confirm(tr('删除「{expression}」及其 {count} 条上下文？', {expression:entry.expression,count:entry.contexts.length}))) return;
    await send({ type: 'deleteEntry', key: entry.key, vaultId });
    // vocab-changed 广播会触发刷新
  });
  card.append(head,statusNotice);

  const first=entry.contexts[0];
  const contextual=first?.explanation?.text ?? first?.definition;
  const reference=generalMeaning(first?.result);
  const meaning=scoped ? contextual || reference : reference || first?.definition;
  if(meaning){
    if(scoped&&!contextual&&first?.result)card.append(el('p','hint',meaningSource(first.result)));
    card.append(el('p','entry-preview',!scoped&&first?.result?.kind==='ai-definition'?meaning.split('\n')[0]:meaning));
  }
  else if(scoped)card.append(el('p','hint',message('未保存释义')));

  // Existing notes stay readable; editing is an explicit, compact state.
  let savedNote = entry.note ?? '';
  const noteBox = el('div','note-box');
  const noteReading = el('div','note-reading');
  const noteText = el('p','note-text');
  noteReading.append(noteText);
  const noteEditor = el('div'); noteEditor.hidden = true;
  const noteArea = el('textarea'); noteArea.rows = 2;
  setLocalizedAttribute(noteArea, 'placeholder', message('写下自己的理解'));
  setLocalizedAttribute(noteArea, 'aria-label', message('{expression} 我的笔记', {expression:entry.expression}));
  const noteState = el('p', 'hint'); noteState.setAttribute('role', 'status');
  const noteSave = iconButton('check', message('保存笔记')); noteSave.classList.add('note-save');
  const noteCancel = iconButton('close', message('取消'));
  const noteRow = el('div', 'note-actions'); noteRow.append(noteState, noteCancel, noteSave);
  const noteLabel = el('label','note-label');
  noteLabel.append(el('span',undefined,message('我的笔记')),noteArea);
  noteEditor.append(noteLabel,noteRow);
  const sizeNote = () => { noteArea.style.height = 'auto'; noteArea.style.height = `${Math.min(noteArea.scrollHeight,160)}px`; };
  noteArea.oninput = sizeNote;
  const showNote = () => {
    noteText.textContent = savedNote;
    noteBox.hidden = !savedNote;
    noteReading.hidden = !savedNote;
    noteEditor.hidden = true; noteEditor.classList.remove('note-editor');
    setLocalizedAttribute(noteEdit, 'title', message(savedNote ? '编辑笔记' : '添加笔记'));
    setLocalizedAttribute(noteEdit, 'aria-label', message(savedNote ? '编辑笔记' : '添加笔记'));
    noteEdit.setAttribute('aria-expanded','false');
  };
  const editNote = () => {
    if (!noteEditor.hidden) { noteArea.focus(); return; }
    noteArea.value = savedNote; noteReading.hidden = true;
    noteBox.hidden = false;
    noteEditor.hidden = false; noteEditor.classList.add('note-editor');
    noteEdit.setAttribute('aria-expanded','true');
    setText(noteState, ''); sizeNote(); noteArea.focus();
  };
  noteEdit.onclick = editNote;
  noteCancel.onclick = () => { showNote(); noteEdit.focus(); };
  noteSave.onclick = async () => {
    noteSave.disabled = true; noteCancel.disabled = true; noteEdit.disabled = true;
    noteSave.setAttribute('aria-busy','true');
    setText(noteState, message('正在保存…'));
    const note = noteArea.value.trim();
    const r = await send<{ok:boolean}>({type:'setNote', key:entry.key, note, vaultId});
    noteSave.disabled = false; noteCancel.disabled = false; noteEdit.disabled = false;
    noteSave.setAttribute('aria-busy','false');
    if (!r?.ok) { setText(noteState, message('保存失败，请重试')); return; }
    savedNote = note; showNote(); noteEdit.focus();
  };
  showNote(); noteBox.append(noteReading, noteEditor);

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
    detail.append(forms);
  }

  for (const c of entry.contexts) {
    const box = el('div', 'context');
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
    box.appendChild(renderContextMeta(c));
    detail.append(box);
  }
  const tools = el('div','entry-tools');
  tools.append(noteEdit);
  if (!scoped) tools.append(del);
  detail.append(noteBox,identity,tools);
  card.append(detail);
  return card;
}

function retryRow(retry: () => void): HTMLElement {
  const row = el('p','empty list-retry',message('加载失败，请重试'));
  const button = el('button',undefined,message('重试'));
  button.onclick = retry;
  row.append(button);
  return row;
}

async function refresh(): Promise<void> {
  if (currentView === 'knowledge') return refreshKnowledge();
  if (currentView === 'sentences') return refreshSentences();
  const generation = ++listGeneration;
  const list = document.getElementById('list')!;
  const q = (document.getElementById('search') as HTMLInputElement).value;
  const r = await send<{ ok: boolean; entries?: EntryView[]; vaultId: string | null }>({
    type: 'listEntries',
    query: q || undefined,
  });
  if (currentView !== 'list' || generation !== listGeneration) return;
  if (!r?.ok || !r.entries) {
    list.querySelector('.list-retry')?.remove();
    list.prepend(retryRow(refresh));
    return;
  }
  const expanded = new Set([...list.querySelectorAll<HTMLElement>('.entry:has(.entry-expand[aria-expanded=true])')].map(row=>row.dataset.key));
  const scroll = currentMain()?.scrollTop ?? 0;
  list.replaceChildren();
  // 语言筛选：全部 / 待确认 / 出现过的语言（记住选择，spec 3.4）。
  const langs = [...new Set(r.entries.map((e) => effectiveEntryLanguage(e)).filter((l): l is string => !!l))].sort();
  let filter = localStorage.getItem('blc-lang-filter') ?? 'all';
  if (filter !== 'all' && filter !== 'und' && !langs.includes(filter)) {
    filter = 'all'; // 存储语言已不存在（词条删除等）：回退全部并回写
    localStorage.setItem('blc-lang-filter', 'all');
  }
  renderLangControls(filter, langs, r.entries);
  const filtered = filter === 'all' ? r.entries : r.entries.filter((e) => effectiveEntryLanguage(e) === filter);
  (libraryReview as HTMLButtonElement).disabled = !buildReviewQueue(filtered).length;
  if (filtered.length === 0) {
    const empty = el('div', 'empty', q ? message('没有匹配的表达') : filter !== 'all' ? message('该语言暂无词条') : message('还没有收藏的表达。在网页上选中一个词或短语，点击“查词”开始。'));
    if (q || filter!=='all') {
      const clear=el('button',undefined,message('清除语言筛选'));clear.onclick=clearSearch;empty.append(clear);
    }
    list.append(empty);
    return;
  }
  for (const entry of filtered) {
    const row = renderEntry(entry,r.vaultId);
    if (expanded.has(entry.key)) row.querySelector<HTMLButtonElement>('.entry-expand')?.click();
    list.append(row);
  }
  currentMain()?.scrollTo(0,scroll);
}

async function refreshKnowledge(): Promise<void> {
  const generation = ++listGeneration;
  const target = document.getElementById('knowledge-list')!;
  if (target.querySelector('.knowledge-editor')) return;
  const r = await send<{ok:boolean;records:KnowledgeRecord[];vaultId:string|null}>({type:'listKnowledge'});
  if (currentView !== 'knowledge' || generation !== listGeneration || target.querySelector('.knowledge-editor')) return;
  if (!r?.ok) {target.querySelector('.list-retry')?.remove();target.prepend(retryRow(refreshKnowledge));return;}
  const focusKey = `knowledge-focus:${panelWindow}`;
  const requested = (await browser.storage.session.get(focusKey))[focusKey] as {id:string;vaultId:string|null}|undefined;
  if (currentView !== 'knowledge' || generation !== listGeneration) return;
  if (requested) {
    await browser.storage.session.remove(focusKey);
    if (requested.vaultId !== r.vaultId) feedback(message('学习库已切换，请重新打开翻译卡'));
    else if (!r.records.some(k=>k.id===requested.id)) feedback(message('收藏已删除或无法打开'));
    else {(document.getElementById('search') as HTMLInputElement).value='';localStorage.setItem('blc-lang-filter','all');}
  }
  const query = (document.getElementById('search') as HTMLInputElement).value.trim().toLocaleLowerCase();
  const languages = [...new Set(r.records.map(k=>k.language))].sort();
  let filter = localStorage.getItem('blc-lang-filter') ?? 'all';
  if (filter !== 'all' && !languages.includes(filter)) filter = 'all';
  renderLangControls(filter,languages,r.records.map(k=>({key:k.id,language:k.language})));
  const opened = new Set([...target.querySelectorAll<HTMLDetailsElement>('details[open]')].map(n=>n.dataset.id));
  target.replaceChildren();
  for (const record of r.records.filter(k=>(filter==='all'||k.language===filter) && (!query || `${k.title}\n${k.body}`.toLocaleLowerCase().includes(query)))) {
    const row = knowledgeRow(record,r.vaultId,send,()=>void refreshKnowledge());
    row.open = opened.has(record.id) || requested?.vaultId===r.vaultId && requested.id===record.id;
    target.append(row);
    if (row.open && requested?.id===record.id) row.scrollIntoView({block:'nearest'});
  }
  if (!target.children.length) {
    const empty=el('div','empty',message(query || filter!=='all' ? '没有匹配的学习记录' : '暂无知识点，可从翻译卡或问答中收藏。'));
    if (query || filter!=='all') {
      const clear=el('button',undefined,message('清除语言筛选'));clear.onclick=clearSearch;empty.append(clear);
    }
    target.append(empty);
  }
}

searchInput.addEventListener('input', () => void refresh());

// ---- 语言筛选 -------------------------------------------------------------------

function clearSearch() {
  (document.getElementById('search') as HTMLInputElement).value = '';
  localStorage.setItem('blc-lang-filter', 'all');
  void refresh();
}

function renderLangControls(filter: string, langs: string[], entries: {key:string;language?:string}[]): void {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const language = effectiveEntryLanguage(entry) ?? '';
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const label = filter === 'all' ? message('语言筛选') : message('语言筛选：{language}',{language:languageLabel(filter)});
  const choices = [
    {value:'all',label:message('全部语言'),count:entries.length},
    ...[...new Set(['und',...langs])].map(value => ({value,label:languageLabel(value),count:counts.get(value) ?? 0})),
  ];
  const mount = document.getElementById('language-filter')!;
  const focused = mount.contains(document.activeElement);
  const filterMenu = choiceMenu('globe',label,choices,filter,value=>{
    localStorage.setItem('blc-lang-filter',value);
    void refresh();
  });
  filterMenu.trigger.id = 'lang-filter';
  filterMenu.trigger.setAttribute('aria-pressed',String(filter!=='all'));
  mount.replaceChildren(filterMenu.wrap);
  if (focused) filterMenu.trigger.focus({preventScroll:true});
}

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
const subsSignature=(s:SubViewState)=>JSON.stringify([s.videoId,s.trackId,s.generation,s.cues,s.currentIndex,s.notice,s.chineseVisible!==false]);
function rebuildCachedVideo(state:SubViewState,library?:{cues?:WorkspaceState['cues'];statuses:WorkspaceState['statuses'];sentences:WorkspaceState['sentences'];entries:WorkspaceState['entries']}):WorkspaceState{
  const cues=library?.cues??(cachedVideo&&cachedVideo.generation===state.generation&&cachedVideo.cues.length===state.cues.length
    ?cachedVideo.cues
    :state.cues.map(c=>({start:c.startMs,dur:c.endMs-c.startMs,text:c.text,lastOff:0,from:c.from,to:c.to})));
  return {videoId:state.videoId,generation:state.generation,videoRef:{videoId:state.videoId,trackId:state.trackId,trackKind:state.trackKind==='asr'?'asr':'manual',trackLang:state.trackLang,startMs:0},
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
    let bubbleRange:Range|null=null,dismissedRange:Range|null=null;
    const sameRange=(a:Range|null,b:Range|null)=>!!a&&!!b&&a.startContainer===b.startContainer&&a.startOffset===b.startOffset&&a.endContainer===b.endContainer&&a.endOffset===b.endOffset;
    const closeSelection=(dismiss=true)=>{if(dismiss) dismissedRange=(bubbleRange??shadowSelection(events)?.range)?.cloneRange()??null;bubbleRange=null;document.getElementById('panel-selection-actions')?.remove();};
    closePanelSelectionActions=()=>closeSelection();
    const validSelection=()=>currentView==='subs'&&!document.getElementById('video-workspace')!.hidden?shadowSelection(events):null;
    const checkSelection=()=>{
      const current=validSelection();
      if(!current){closeSelection(false);dismissedRange=null;return;}
      if(dismissedRange&&!sameRange(dismissedRange,current.range))dismissedRange=null;
      if(bubbleRange&&(!bubbleRange.startContainer.isConnected||!bubbleRange.endContainer.isConnected||!sameRange(bubbleRange,current.range)))closeSelection(false);
    };
    const outsideSelection=(e:Event)=>{if(e.composedPath().some(n=>n instanceof Element&&n.id==='panel-selection-actions'))return;closeSelection();};
    const escapeSelection=(e:KeyboardEvent)=>{if(e.key==='Escape')closeSelection();};
    const clearSelection=()=>closeSelection();
    document.addEventListener('selectionchange',checkSelection);
    document.addEventListener('pointerdown',outsideSelection,true);
    document.addEventListener('keydown',escapeSelection);
    document.addEventListener('pd-popup-outside',clearSelection);
    host.addEventListener('pd-subtitle-selection-clear',clearSelection);
    const selectionObserver=new MutationObserver(checkSelection);selectionObserver.observe(events,{childList:true,subtree:true});
    // 只读取选区与原文行的交集，排除时间、译文及操作控件。
    const refOf = (node: Node) => {
      const row = (node instanceof Element ? node : node.parentElement)?.closest('[data-cue]');
      return row ? videoWorkspace.rowRef(row) : undefined;
    };
    function listSelectionInfo(range: Range, state: SubViewState) {
      const parts: { ref: SubtitleRowRef; en: Element; range: Range; text: string }[] = [];
      const from = refOf(range.startContainer)?.index ?? 0;
      const to = refOf(range.endContainer)?.index ?? state.cues.length - 1;
      if (range.startContainer.getRootNode() !== events || range.endContainer.getRootNode() !== events) return null;
      for (let i = from; i <= to; i++) {
        const row = events.querySelector('[data-cue="' + i + '"]');
        const en = row?.querySelector('.en');
        const ref = row && videoWorkspace.rowRef(row);
        if (!en || !ref || ref.generation !== state.generation || !range.intersectsNode(en)) continue;
        const clamped = document.createRange();
        clamped.selectNodeContents(en);
        if (range.compareBoundaryPoints(Range.START_TO_START, clamped) > 0) {
          clamped.setStart(range.startContainer, range.startOffset);
        }
        if (range.compareBoundaryPoints(Range.END_TO_END, clamped) < 0) {
          clamped.setEnd(range.endContainer, range.endOffset);
        }
        const text = clamped.toString().trim();
        if (text) parts.push({ ref, en, range: clamped, text });
      }
      const first = parts[0], last = parts.at(-1);
      if (!first || !last) return null;
      const firstIndex = first.ref.index, lastIndex = last.ref.index;
      const rect = range.getBoundingClientRect();
      if (first === last) {
        const cls = classifyRangeIn(first.en, first.range, state.trackLang.split('-')[0] || 'en');
        return cls && { ...cls, raw: first.text, ref: first.ref, firstIndex, lastIndex, count: 1, rect };
      }
      const raw = parts.map((part, i) => (i ? state.cues[part.ref.index]!.joinBefore : '') + part.text).join('');
      return {kind:'cross-cue' as const,raw,expression:null,ref:first.ref,firstIndex,lastIndex,count:parts.length,hasWord:false,rect};
    }
    function listSelectionCandidate(info:{kind:'word'|'phrase'|'sentence'|'cross-cue';raw:string;expression:string|null;firstIndex:number;lastIndex:number;count:number}, state:SubViewState):SelectionCandidate|null{
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
          crossFromMs:cue?.startMs??0,crossToMs:state.cues[info.lastIndex]?.endMs,crossCount:info.count};
      }
      if(!cue)return null;
      return {at:Date.now(),pageUrl:source.url,text:info.raw,kind:info.kind,
        expression:info.kind==='sentence'?null:info.expression,
        lang:state.trackLang||undefined,source,
        cue:{index:info.firstIndex,text:cue.text,startMs:cue.startMs,endMs:cue.endMs}};
    }
    const showSelection=(e:MouseEvent)=>{
      if(currentView!=='subs'||e.composedPath().some(n=>n instanceof Element&&n.matches('#panel-selection-actions,#blc-lookup-popup,#pd-translation')))return;
      const selection=shadowSelection(events);
      const state = subsState, tabId = subsTabId;
      if(!selection||!state||tabId===null||sameRange(dismissedRange,selection.range)){checkSelection();return;}
      const info=listSelectionInfo(selection.range,state);
      if(!info)return;
      selectedAt=Date.now();e.stopPropagation();
      closeSelection(false);bubbleRange=selection.range.cloneRange();
      const buttons=el('div','selection-actions');buttons.id='panel-selection-actions';
      buttons.addEventListener('pointerdown',event=>event.preventDefault());
      const rect=info.rect;
      const selectedVideo=state.videoId,selectedCue=state.cues[info.firstIndex];
      const candidate=listSelectionCandidate(info,state);
      if(candidate)void send({type:'selectionCandidateSet',tabId,candidate});
      // 词/短语翻译用补全/清洗后的有效表达；句段/跨行保持实际选文
      const snapshot:SelectionSnapshot={text:info.raw,title:state.title,url:videoContextUrl(selectedVideo,selectedCue?.startMs??0),source:candidate?.source,sourceLang:state.trackLang||undefined,languageEvidence:'track',position:{videoId:selectedVideo,trackId:state.trackId,trackKind:state.trackKind==='asr'?'asr':'manual',trackLang:state.trackLang||'und',startMs:selectedCue?.startMs??0,endMs:state.cues[info.lastIndex]?.endMs??selectedCue?.endMs??0}};
      // 分类表：word=查词+对话；phrase=查词+翻译+对话；sentence/cross-cue=翻译+对话
      if((info.kind==='word'||info.kind==='phrase')&&info.hasWord&&info.raw.length<=200){
        const lookup=iconButton('lookup',message('查词'));lookup.onclick=()=>{closeSelection();void videoAction(info.ref,{action:'lookup',word:info.expression??info.raw});};buttons.append(lookup);
      }
      if(info.kind!=='word'){
        const translate=iconButton('translate',message('翻译'));translate.onclick=async()=>{closeSelection();if(await validateRow(info.ref))selectionPopup.open(snapshot,rect);};buttons.append(translate);
      }
      const chat=el('button','blc-chat-add');setLocalizedAttribute(chat, 'title', message('添加到对话'));setLocalizedAttribute(chat, 'aria-label', message('添加到对话'));chat.innerHTML=CHAT_ADD_ICON;
      chat.onmousedown=e=>e.preventDefault();
      chat.onclick=async()=>{closeSelection();if(candidate&&await validateRow(info.ref))void attachSelectionCandidate(candidate,{tabId});};
      buttons.append(chat);
      const close=iconButton('close',message('关闭选区操作'));close.onclick=()=>closeSelection();buttons.append(close);document.body.append(buttons);
      const box=buttons.getBoundingClientRect(),below=rect.bottom+6;
      buttons.style.left=Math.max(8,Math.min(rect.left,innerWidth-box.width-8))+'px';
      buttons.style.top=Math.max(8,below+box.height<=innerHeight-8?below:rect.top-box.height-6)+'px';
    };
    document.addEventListener('mouseup',showSelection);
    const wordOf=(e:Event)=>(e.composedPath()[0] as Element)?.closest?.('.w') as HTMLElement|null;
    const openWord = (word: HTMLElement, compact: boolean) => {
      const ref = refOf(word);
      if (ref && word.isConnected) void openPanelWord(word.textContent ?? '', ref, word, compact);
    };
    events.addEventListener('pointerover',e=>{const word=wordOf(e);if((e as PointerEvent).buttons||!word||word===hoveredWord||(lookupPopup.isOpen()&&!lookupPopup.isCompact()))return;clearTimeout(wordTimer);clearTimeout(closeTimer);wordTimer=setTimeout(()=>{if(!getSelection()?.toString()){hoveredWord=word;openWord(word,true);}},180);});
    events.addEventListener('pointerdown',()=>{clearTimeout(wordTimer);});
    events.addEventListener('pointerout',()=>{clearTimeout(wordTimer);closeTimer=setTimeout(()=>{if(lookupPopup.isCompact()){lookupPopup.close();hoveredWord=null;}},220);});
    events.addEventListener('click',e=>{if(Date.now()-selectedAt<500||getSelection()?.toString())return;const w=wordOf(e);if(!w)return;clearTimeout(wordTimer);clearTimeout(closeTimer);if(w===hoveredWord&&lookupPopup.isOpen()){if(lookupPopup.isCompact())lookupPopup.expand();else lookupPopup.close();}else{hoveredWord=w;openWord(w,false);}});
    events.addEventListener('focusin',e=>{const w=wordOf(e);if(w&&w!==hoveredWord){hoveredWord=w;openWord(w,true);}});
    events.addEventListener('keydown',e=>{const key=e as KeyboardEvent,w=wordOf(e);if(w&&(key.key==='Enter'||key.key===' ')){key.preventDefault();hoveredWord=w;openWord(w,false);}});
    return ()=>{closeSelection();selectionObserver.disconnect();document.removeEventListener('selectionchange',checkSelection);document.removeEventListener('pointerdown',outsideSelection,true);document.removeEventListener('keydown',escapeSelection);document.removeEventListener('pd-popup-outside',clearSelection);document.removeEventListener('mouseup',showSelection);host.removeEventListener('pd-subtitle-selection-clear',clearSelection);};
  },
  words:(parent,text)=>{const lang=((cachedVideo?.trackLang||subsState?.trackLang)||'en').split('-')[0]!;let last=0;for(const s of segmentWords(text,lang)){if(s.start>last)parent.append(document.createTextNode(text.slice(last,s.start)));const w=el('span','w',s.text);w.tabIndex=0;w.setAttribute('role','button');w.style.userSelect='text';parent.append(w);last=s.end;}if(last<text.length)parent.append(document.createTextNode(text.slice(last)));},
  seek:(ref,play)=>void videoAction(ref,{action:'seek',play}),lookup:(word,ref,anchor)=>void openPanelWord(word,ref,anchor,false),
  save:ref=>videoAction(ref,{action:'save'}),remove:async id=>{const result=await send<{ok:boolean}>({type:'deleteSentence',id});if(result?.ok){subsLibraryDirty=true;await pollSubs();}return {ok:!!result?.ok};},
  ask:ref=>void askFromRow(ref),open:view=>{
    if(view==='review' && subsState?.videoId && subsTabId!==null)beginReview({ category:'vocab', sourceKey:`yt:${subsState.videoId}`, language:normalizeLangTag(subsState.trackLang||'und'), returnTo:'video', video:{state:{...subsState,cues:[]},tabId:subsTabId,workspace:videoWorkspace.snapshot()}, source:{sourceType:'youtube',sourceKey:`yt:${subsState.videoId}`,title:subsState.title,url:videoContextUrl(subsState.videoId,0)} });
    else switchView(view);
  },
  status:async(key,status)=>{const result=await send<{ok:boolean}>({type:'setStatus',key,status});if(result?.ok)void pollSubs();return !!result?.ok;},
},document.getElementById('video-workspace')!);
const articleLearning = createArticleLearning(document.getElementById('web-selection')!, {
  send, title:renderArticleTitle, entry: (entry,vaultId) => renderEntry(entry, vaultId,true), translate: snapshot => selectionPopup.open(snapshot), changed: () => void persistPanel(),
  review: article => beginReview({ category: article.category, sourceKey:article.source?.sourceKey, source:article.source ?? undefined, language:article.language==='all'?undefined:article.language, returnTo:'article', article }),
});
function rowSnapshot(ref: SubtitleRowRef) {
  const state = subsState, tabId = subsTabId, cue = state?.cues[ref.index];
  if (tabId === null || !state || !cue || ref.generation !== state.generation ||
    ref.videoId !== state.videoId || ref.trackId !== state.trackId || ref.text !== cue.text) return null;
  return { state, tabId, cue };
}
function sendRowAction(tabId: number, ref: SubtitleRowRef, operation: SubtitleRowOperation) {
  const action: SubtitleRowAction = { type: 'pd-video-action', ...ref, ...operation };
  return tabSend<{ok:boolean}>(tabId, action);
}
async function validateRow(ref: SubtitleRowRef) {
  const snapshot = rowSnapshot(ref);
  if (!snapshot || !(await sendRowAction(snapshot.tabId, ref, { action: 'validate' }))?.ok) return null;
  return rowSnapshot(ref);
}
async function askFromRow(ref: SubtitleRowRef) {
  const row = await validateRow(ref);
  if (row) await subtitleAskAi(row.state, row.cue);
}
async function openPanelWord(word: string, ref: SubtitleRowRef, anchor: HTMLElement, compact: boolean) {
  const row = rowSnapshot(ref);
  if (!row) return;
  const { state, tabId, cue } = row;
  if (lookupTarget !== state.generation) lookupPopup.close();
  lookupTarget = state.generation;
  const token = crypto.randomUUID();
  const resume = () => void sendRowAction(tabId, ref, { action: 'resumeLookup', token });
  if (!(await sendRowAction(tabId, ref, { action: 'pauseLookup', token }))?.ok) return;
  if (!anchor.isConnected || !rowSnapshot(ref)) { resume(); return; }
  lookupPopup.open({snapshot:{source:'video',expression:word,sentence:cue.text,title:state.title,lang:state.trackLang||undefined,video:{videoId:state.videoId,trackId:state.trackId,trackKind:state.trackKind==='asr'?'asr':'manual',trackLang:state.trackLang,startMs:cue.startMs}},anchor,compact,subLine:'YouTube · '+fmtClock(cue.startMs),onContinueAsk:()=>void askFromRow(ref),onClose:resume});
  const card=lookupPopup.host()?.shadowRoot?.querySelector('.card');card?.addEventListener('pointerenter',()=>clearTimeout(closeTimer));card?.addEventListener('pointerleave',()=>{closeTimer=setTimeout(()=>{if(lookupPopup.isCompact()){lookupPopup.close();hoveredWord=null;}},220);});
}
async function videoAction(ref: SubtitleRowRef, operation: SubtitleRowOperation) {
  const row = rowSnapshot(ref);
  if (!row) return { ok: false };
  const r = await sendRowAction(row.tabId, ref, operation);
  if (!r?.ok) { if (operation.action !== 'save') feedback(message('视频操作失败，请回到原视频重试')); }
  else { if (operation.action === 'save') subsLibraryDirty = true; await pollSubs(); }
  return { ok: !!r?.ok };
}
async function refreshSubsLibrary(state:SubViewState):Promise<void> {
  subsLibraryAt=Date.now();subsLibraryDirty=false;
  const [vocab,saved,index]=await Promise.all([send<{ok:boolean;entries:EntryView[]}>({type:'listEntries'}),send<{ok:boolean;sentences:SavedSentence[]}>({type:'listSentences'}),send<{ok:boolean;items:import('@/shared/vocab').VocabIndexItem[]}>({type:'vocabIndex'})]);
  if(currentView!=='subs'||subsState!==state)return;
  const stable=<T>(old:T,next:T):T=>JSON.stringify(old)===JSON.stringify(next)?old:next;
  const cues=state.cues.map(c=>({start:c.startMs,dur:c.endMs-c.startMs,text:c.text,lastOff:0,from:c.from,to:c.to}));
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
  if(pinned.pinned){closePanelSelectionActions();document.getElementById('video-workspace')!.hidden=true;document.getElementById('web-selection')!.hidden=false;await articleLearning.update(pinned.source,null);return;}
  const videoReturn=returnedVideo;
  if(videoReturn){
    const live=await tabSend<SubViewState>(videoReturn.tabId,{type:'blc-sub-get'});
    if(currentView!=='subs'||returnedVideo!==videoReturn||generation!==subsPollGeneration)return;
    if(live?.videoId===videoReturn.state.videoId&&live.trackId===videoReturn.state.trackId)videoReturn.state=live;
    subsTabId=videoReturn.tabId;subsState=videoReturn.state;
    renderVideoTitle(subsState.title);
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
  if(switched || subsState?.generation !== st?.generation){
    lookupPopup.close();selectionPopup.close();closePanelSelectionActions();subsLibraryDirty=true;
  }
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
  renderVideoTitle(state.title);
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
    if(!r?.ok){document.getElementById('review-body')!.replaceChildren(retryRow(startReview));return;}
    if(r.vaultId!==session.vaultId){void checkLearningLibrary();return;}
    knowledgeQueue=r.records.filter(k=>(!session.sourceKey||k.source.sourceKey===session.sourceKey)&&(!session.language||k.language===session.language));
    moveReview(0);return;
  }
  const r = await send<{ ok: boolean; entries?: EntryView[];vaultId:string|null }>({ type: 'listEntries' });
  if (currentView !== 'review'||operation!==reviewOperation) return;
  if(!r?.ok||!r.entries){document.getElementById('review-body')!.replaceChildren(retryRow(startReview));return;}
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
  renderWorkspaceTitle();
  if (reviewSession.language) body.append(el('p','hint review-language',languageLabel(reviewSession.language)));
  void persistPanel();

  if (!length) {
    body.appendChild(
      el('div', 'empty', message(knowledge?'本范围内没有知识点':'没有可复习的词条。收藏的 saved / learning 词条会出现在这里。')),
    );
    return;
  }
  const navigation = el('div', 'review-navigation');
  const previous = iconButton('previous',message('上一条'));
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
  const next = iconButton('next',message('下一条'));
  next.disabled = reviewIdx >= length;
  next.onclick = () => moveReview(reviewIdx + 1);
  const shuffle = iconButton('shuffle',message('打乱顺序'));
  shuffle.disabled = length < 2; shuffle.onclick = shuffleReview;
  navigation.append(previous, jump, next, shuffle); body.append(navigation);
  if (reviewIdx >= length) {
    body.appendChild(el('div', 'empty', message('本轮复习完成 🎉')));
    const row = el('div', 'review-actions');
    const again = el('button', undefined, message('再来一轮'));
    again.addEventListener('click', () => void startReview());
    row.appendChild(again);
    body.appendChild(row);
    return;
  }

  if(knowledge) {
    const item=knowledgeQueue[reviewIdx]!;
    body.append(el('h2',undefined,item.title));
    if(revealed)appendKnowledgeBody(body,item);
    const actions=el('div','review-actions');
    const reveal=iconButton('reveal',message('揭示'));reveal.onclick=()=>{revealed=true;renderReview();};
    const source=el('a','source',message('返回来源'));source.href=item.source.url;source.target='_blank';source.rel='noopener';
    if(!revealed)actions.append(reveal);
    labelIcon(source,'external',message('返回来源'));source.classList.add('ui-icon-button');
    actions.append(source);body.append(actions);return;
  }
  const it = reviewQueue[reviewIdx]!;
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
      : it.title;
  if (!src.textContent) setText(src,message('打开来源'));
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
    const revealMeaning = iconButton('reveal',message('显示释义'));
    revealMeaning.onclick = () => { definitionRevealed = true; renderReview(); };
    annotation.append(revealMeaning);
  }
  const actions = el('div', 'review-actions');
  if (!revealed) {
    const reveal = iconButton('reveal',message('显示单词'));
    reveal.addEventListener('click', () => {
      revealed = true;
      renderReview();
    });
    card.append(reveal);
  } else {
    const known = iconButton('known',message('已掌握'));
    known.classList.add('learning-status');
    known.addEventListener('click', () => void reviewStatus('known'));
    actions.appendChild(known);
    const back = iconButton(it.sourceType==='video'?'external':'locate',message('返回来源'));
    back.addEventListener('click', () => {
      if(it.sourceType==='video')window.open(it.url, '_blank', 'noopener');
      else void locateSavedText(it.url,it.sentence).then(found=>feedback(found ? '' : message('页面已变化，显示保存的原文'),!found));
    });
    actions.appendChild(back);
  }
  card.append(annotation,actions);
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
    if (currentView === 'list' && !document.querySelector('#list .note-editor')) void refresh();
    if (currentView === 'review') void refreshReviewQueue();
    if (currentView === 'subs') void pollSubs();
  }
  if(t==='knowledge-changed') {
    if(currentView==='knowledge')void refreshKnowledge();
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

initChatView({ getActiveView: () => currentView, switchView, title: title => setText(workspaceTitle,title), openAiSettings: () => {switchView('settings');settingsView.showAi(true);} });
async function checkLearningLibrary() {
  const r=await send<{ok:boolean;records:KnowledgeRecord[];vaultId:string|null}>({type:'listKnowledge'});
  if(!r?.ok||r.vaultId===libraryId)return;
  libraryId=r.vaultId;videoWorkspace.clearSavedFeedback();reviewOperation++;subsPollGeneration++;reviewQueue=[];knowledgeQueue=[];reviewIdx=0;revealed=false;definitionRevealed=false;reviewSession={category:'vocab',returnTo:'list'};
  articleLearning.reset();returnedVideo=null;subsLibraryDirty=true;cachedVideo=null;
  if(currentView==='review')switchView('list');else if(currentView==='subs')void pollSubs();else if(currentView==='knowledge')void refreshKnowledge();
  void persistPanel();
}
onDisplayLanguageChange(()=>{document.documentElement.lang=getDisplayLocale();localize(document);});

async function boot(){
 applyAppearance(document.documentElement);
 await initDisplayLanguage();
 document.documentElement.lang=getDisplayLocale();localize(document);
 const ctx=await send<{ok:boolean;windowId:number;tabId:number;documentId:string;floating:boolean;fullscreen:boolean;active:boolean}>({type:'panelContext'});
 if(!ctx?.ok){workspaceFailed('context',new Error('panel-context-unavailable'));return;}
 panelDocumentId=ctx.documentId;
 const library=await send<{ok:boolean;vaultId:string|null}>({type:'listKnowledge'});libraryId=library?.vaultId??null;
 panelWindow=ctx.windowId;panelTabId=ctx.tabId;floating=ctx.floating;inVideoFullscreen=ctx.fullscreen;
 activePanel=ctx.active;setChatActive(activePanel);
 const mode=document.getElementById('panel-mode')!,modeLabel=floating?message('切换为固定侧栏'):message('切换为浮动面板');mode.innerHTML=uiIcon(floating?'dock':'float');setLocalizedAttribute(mode,'title',modeLabel);setLocalizedAttribute(mode,'aria-label',modeLabel);
 const snapshot=(await browser.storage.session.get(panelStateKey(panelWindow)))[panelStateKey(panelWindow)] as PanelSnapshot|undefined;
 const stored=snapshot?.vaultId===libraryId?snapshot:undefined;
 if(stored){savedScroll=stored.scroll??{};reviewQueue=stored.reviewQueue??[];reviewIdx=stored.reviewIdx??0;revealed=!!stored.revealed;definitionRevealed=!!stored.definitionRevealed;previousView=stored.previousView??'list';(document.getElementById('search') as HTMLInputElement).value=stored.search??'';}
 if(stored?.reviewSession)reviewSession=stored.reviewSession;else reviewQueue=[];
 knowledgeQueue=stored?.knowledgeQueue??[];
 if(stored?.article)articleLearning.restore(stored.article);
 returnedVideo=stored?.returnedVideo??null;
 restoreReturnedVideo=!!returnedVideo;
 const hash=location.hash.slice(1);switchView(isPanelView(hash)?hash:isPanelView(stored?.view)?stored.view:'subs');
 if(currentView==='settings'&&snapshot?.settingsAi)settingsView.showAi(true);
 await restoreChat(stored?.chat);
 if(stored?.video){await pollSubs();videoWorkspace.restore(stored.video);}
 // 启动时不由可见性事件打断恢复；就绪后按实际可见性同步聊天状态。
 ready=activePanel;setChatActive(activePanel&&document.visibilityState!=='hidden');document.body.inert=!activePanel;
 workspaceInitialized=true;
 browser.runtime.onMessage.addListener((m:unknown)=>{const v=m as {type?:string;windowId?:number;tabId?:number;mode?:string;view?:unknown;origin?:string;at?:number};if(v.type==='pd-popup-outside'&&v.windowId===panelWindow&&v.origin==='page'){document.dispatchEvent(new CustomEvent('pd-popup-outside',{detail:{at:v.at}}));return;}if(v.type==='pd-panel-closed'&&v.windowId===panelWindow){closePanelSelectionActions();void restoreChat();return;}if(v.type==='pd-panel-view'&&v.windowId===panelWindow){activePanel=v.mode===(floating?'floating':'fixed')&&(!floating||v.tabId===panelTabId);closePanelSelectionActions();setChatActive(false);restoreVersion++;ready=false;document.body.inert=true;if(activePanel)void restorePanel(v.view).catch(error=>workspaceFailed('restore',error));}});
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
    if(currentView==='settings'&&s.settingsAi)settingsView.showAi(true);
    if(currentView==='review')renderReview();
    setChatActive(activePanel);await restoreChat(s.chat);
    if(version!==restoreVersion)return;
    if(s.video){await pollSubs();videoWorkspace.restore(s.video);}
    currentMain()?.scrollTo(0,savedScroll[currentView]??0);
  }
  if(version!==restoreVersion)return;
  if(!s && isPanelView(view))switchView(view);
  workspaceFailureStage='';setChatActive(activePanel&&document.visibilityState!=='hidden');ready=true;document.body.inert=false;
}
document.addEventListener('visibilitychange',()=>{if(!ready)return;if(document.visibilityState==='hidden'){closePanelSelectionActions();void saveDraft(true);void persistPanel();setChatActive(false);}else setChatActive(activePanel);});
void boot().catch(error=>workspaceFailed('boot',error));
