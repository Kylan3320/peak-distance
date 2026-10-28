import { t as tr, localize, onDisplayLanguageChange , message, setText, setLocalizedAttribute, type UiText } from './i18n';
import { brandTokens, brandControls } from './brand';
import type { Cue } from './protocol';
import type { Settings } from './settings';
import type { EntryView } from './messages';
import { cueWords, fmtClock } from './cues';
import { sentenceId, type SavedSentence, type VideoRef } from './vocab';
import { normalizeExpressionInLanguage } from './languages';
import { shadowSelection } from './selection';
import { readingIcon, readingIconStyles, animateBookmark, type ReadingIcon } from './readingIcons';

export interface WorkspaceState {
  videoId: string;
  videoRef: VideoRef;
  cues: Cue[];
  current: number;
  translations: Map<number, string>;
  statuses: Map<string, string>;
  sentences: SavedSentence[];
  entries: EntryView[];
  notice: string;
  chinese: boolean;
  /** 当前轨道语言（词次分词与查词边界用；缺省按英文兼容） */
  trackLang?: string;
}

const css = `
  ${brandTokens}:host { display:block;height:100%;min-height:0;color-scheme:light; font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;color:var(--pd-ink); } ${brandControls}
  * { box-sizing:border-box; } [hidden] { display:none!important; }
  button,select { font:inherit; color:inherit; border:1px solid var(--pd-line); background:var(--pd-surface); border-radius:5px; padding:5px 9px; cursor:pointer; }
  button:hover { background:var(--pd-selected); } button:focus-visible,select:focus-visible,.w:focus-visible { outline:2px solid var(--pd-blue); outline-offset:2px; }
  .panel { background:var(--pd-surface); border:1px solid var(--pd-line); border-radius:8px; height:100%; display:flex; flex-direction:column; overflow:hidden; }
  .head,.controls { display:flex; gap:6px; padding:8px; align-items:center; flex-wrap:wrap; border-bottom:1px solid var(--pd-line); }
  .head button { background:transparent; border-color:transparent; } .head button.active { border-bottom-color:var(--pd-blue); color:var(--pd-blue); }
  .head .close { margin-left:auto; } .body { overflow:auto; min-height:0; flex:1; overscroll-behavior:contain; }
  .row { padding:12px; border-bottom:1px solid var(--pd-line); } .row.current { background:var(--pd-selected); box-shadow:inset 3px 0 var(--pd-blue); }
  .en { font-size:16px; overflow-wrap:anywhere; } .zh { color:var(--pd-muted); margin-top:5px; }
  .meta { display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:8px; color:var(--pd-muted); font-size:12px; }
  .meta button { font-size:12px; padding:2px 7px; } .muted { color:var(--pd-muted); padding:12px; }
  .w { cursor:pointer; border-radius:3px; } .w:hover { background:var(--pd-selected); }
  .saved { border-bottom:2px solid var(--pd-blue); } .learning { border-bottom:2px solid var(--pd-gold); } .known { color:var(--pd-muted); }
  .word { font-size:16px; } details { margin-top:8px; } summary { cursor:pointer; color:var(--pd-blue); }
  ${readingIconStyles}
  .save-error {color:#b3261e;font-size:12px;flex-basis:100%}
  ::selection {background:var(--pd-selected);color:var(--pd-ink)}
`;

export function createYoutubeWorkspace(actions: {
  bindWords: (host: HTMLElement) => () => void;
  words: (parent: HTMLDivElement, text: string) => void;
  seek: (index: number, play?: boolean) => void;
  lookup: (word: string, index: number, anchor: HTMLElement) => void;
  save: (index: number) => Promise<{ok:boolean}>;
  remove: (id: string) => Promise<{ok:boolean}>;
  ask: (index: number) => void;
  open: (view: 'list' | 'sentences' | 'review') => void;
  status: (key:string, status:string) => void;
}, mount: HTMLElement) {
  const host = document.createElement('aside'); host.id = 'blc-learning-panel';
  const root = host.attachShadow({ mode: 'open' });
  const unlocalize = onDisplayLanguageChange(()=>localize(root));
  root.innerHTML = `<style>${css}</style><section class="panel" data-i18n-aria-label="视频学习侧栏" aria-label="${tr("视频学习侧栏")}"><div class="head"></div><div class="controls"></div><div class="body"></div></section>`;
  localize(root);
  const head = root.querySelector<HTMLDivElement>('.head')!;
  const controls = root.querySelector<HTMLDivElement>('.controls')!;
  const body = root.querySelector<HTMLDivElement>('.body')!;
  let state: WorkspaceState;
  let follow = true;
  let selectionHeld = false;
  let expectedScrollTop: number | null = null;
  let userScrollUntil = 0;
  let scrollbarDragging = false;
  const scrollPositions = new Map<string, number>();
  let tab = 'subs', renderedTab = '', lastCues: Cue[] | null = null;
  let lastSentences: SavedSentence[] | null = null, lastEntries: EntryView[] | null = null;
  let lastStatuses: Map<string, string> | null = null;
  let lastCurrent = -1;
  let lastIdentity = '';
  const saveButtons = new Map<number, HTMLButtonElement>();
  const pendingSaves = new Set<string>();
  // A real mutation reply can precede a competing library poll. Retain its
  // confirmed state until the library snapshot catches up.
  const confirmedSaves = new Map<string, boolean>();
  const button = (parent: HTMLElement, label: string | UiText, action: () => void) => {
    const b = document.createElement('button'); b.type = 'button'; setText(b,label); b.addEventListener('click', action); parent.append(b); return b;
  };
  const icon = (parent: HTMLElement, name: ReadingIcon, label: UiText, action: () => void) => {
    const b = button(parent, '', action); b.className = 'reading-icon'; b.innerHTML = readingIcon(name);
    setLocalizedAttribute(b, 'title', label); setLocalizedAttribute(b, 'aria-label', label); return b;
  };
  const setScroll = (top: number) => { body.scrollTop = top; expectedScrollTop = body.scrollTop; };
  const identity = () => `${state.videoId}:${state.videoRef.trackId}`;
  const cueId = (index:number) => sentenceId({...state.videoRef,startMs:state.cues[index]!.start},state.cues[index]!.text);
  const storedSaved = (index:number) => state.sentences.some(s => sentenceId(s.video,s.text) === cueId(index));
  const isSaved = (index:number) => confirmedSaves.get(cueId(index)) ?? storedSaved(index);
  function updateSaveButton(index:number, b:HTMLButtonElement) {
    const saved=isSaved(index), busy=pendingSaves.has(cueId(index));
    b.classList.toggle('is-saved',saved); b.disabled=busy; b.setAttribute('aria-busy',String(busy)); b.setAttribute('aria-pressed',String(saved));
    const label=message(busy?'保存中…':saved?'取消收藏':'收藏整句');
    setLocalizedAttribute(b,'title',label);setLocalizedAttribute(b,'aria-label',label);
  }
  async function toggleSave(index:number, b:HTMLButtonElement, error:HTMLElement) {
    const key=cueId(index); if(pendingSaves.has(key))return;
    const wasSaved=isSaved(index), savedIdentity=identity();
    pendingSaves.add(key); error.hidden=true; updateSaveButton(index,b);
    let result:{ok:boolean};try {result=await actions.save(index);}catch {result={ok:false};}
    pendingSaves.delete(key);
    if(identity()!==savedIdentity||!b.isConnected)return;
    if(result.ok) {
      // Awaited persistence is authoritative even before the next library poll.
      if(storedSaved(index)!==!wasSaved)confirmedSaves.set(key,!wasSaved);else confirmedSaves.delete(key);
      b.classList.toggle('is-saved',!wasSaved);b.setAttribute('aria-pressed',String(!wasSaved));
      const label=message(wasSaved?'收藏整句':'取消收藏');setLocalizedAttribute(b,'title',label);setLocalizedAttribute(b,'aria-label',label);
      if(!wasSaved)animateBookmark(b);
    }else {updateSaveButton(index,b);setText(error,message('保存失败，请重试'));error.hidden=false;}
    b.disabled=false;b.setAttribute('aria-busy','false');
  }
  for (const [id, label] of [['subs', message('字幕')], ['words', message('词语')], ['saved', message('已保存〔视频〕')]] as const) {
    const b = button(head, label!, () => { scrollPositions.set(tab, body.scrollTop); tab = id!; render(); }); b.dataset.tab = id;
  }

  icon(controls, 'previous', message('上一句'), () => actions.seek(Math.max(0, state.current - 1)));
  icon(controls, 'replay', message('重播'), () => actions.seek(Math.max(0, state.current), true));
  icon(controls, 'next', message('下一句'), () => actions.seek(Math.min(state.cues.length - 1, state.current + 1)));
  controls.querySelectorAll('button').forEach(b => b.dataset.playback = '');
  const back = icon(controls, 'locate', message('回到当前句'), () => {
    if(shadowSelection(root))getSelection()?.removeAllRanges();
    host.dispatchEvent(new CustomEvent('pd-subtitle-selection-clear'));
    selectionHeld=false; follow=true; highlight(true);
  });
  back.hidden = true;
  body.addEventListener('scroll', () => {
    if(expectedScrollTop!==null&&Math.abs(body.scrollTop-expectedScrollTop)<1){expectedScrollTop=null;return;}
    expectedScrollTop=null;if(tab==='subs'&&(scrollbarDragging||performance.now()<userScrollUntil)){follow=false;back.hidden=false;}
  }, {passive:true});
  const scrollInput=()=>{userScrollUntil=performance.now()+400;};
  for(const event of ['wheel','touchmove'])body.addEventListener(event,scrollInput,{passive:true});
  body.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key))scrollInput();});
  body.addEventListener('pointerdown',e=>{
    const box=body.getBoundingClientRect();
    if(e.target===body&&(e.clientX>=box.left+body.clientLeft+body.clientWidth||e.clientX<box.left+body.clientLeft)){scrollbarDragging=true;scrollInput();}
  });
  const endScrollbar=()=>{if(scrollbarDragging)scrollInput();scrollbarDragging=false;};
  document.addEventListener('pointerup',endScrollbar);
  document.addEventListener('pointercancel',endScrollbar);
  const selectionChanged = () => {
    const inOriginal=(node:Node)=>(node instanceof Element?node:node.parentElement)?.closest('.en');
    const selected=shadowSelection(root), held=!!selected&&!!(inOriginal(selected.range.startContainer)||inOriginal(selected.range.endContainer));
    if(selectionHeld===held)return;selectionHeld=held;
    if(!held&&follow&&state)highlight(true);
  };
  document.addEventListener('selectionchange',selectionChanged);
  const unbindWords=actions.bindWords(host);

  mount.append(host);
  function line(index: number) {
    const cue = state.cues[index]!;
    const row = document.createElement('div'); row.className = 'row'; row.dataset.cue = String(index);
    const en = document.createElement('div'); en.className = 'en'; actions.words(en, cue.text); row.append(en);
    const zh = document.createElement('div'); zh.className = 'zh'; row.append(zh);
    return row;
  }
  function meta(row: HTMLElement) { const el = document.createElement('div'); el.className = 'meta'; row.append(el); return el; }
  function empty(text: string | UiText) { const el = document.createElement('p'); el.className = 'muted'; setText(el,text); body.append(el); }
  function render() {
    if (!state) return;
    head.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    controls.hidden = tab !== 'subs';
    const contentChanged=lastIdentity!==identity()||!lastCues||lastCues.length!==state.cues.length||lastCues.some((cue,i)=>{const next=state.cues[i]!;return cue.start!==next.start||cue.dur!==next.dur||cue.text!==next.text;});
    const rebuild = renderedTab !== tab || contentChanged ||
      (tab === 'saved' && (lastSentences !== state.sentences || lastEntries !== state.entries));
    if (rebuild) {
      const top = renderedTab === tab ? body.scrollTop : scrollPositions.get(tab) ?? 0;
      body.replaceChildren();
      saveButtons.clear();
      if(contentChanged){selectionHeld=false;host.dispatchEvent(new CustomEvent('pd-subtitle-selection-clear'));}
      if (tab === 'subs') {
        if (!state.cues.length) empty(message(state.notice || '正在读取字幕…'));
        state.cues.forEach((cue, i) => {
          const row = line(i), tools = meta(row);
          button(tools, fmtClock(cue.start), () => actions.seek(i)).dataset.playback = '';
          const error=document.createElement('span');error.className='save-error';error.hidden=true;error.setAttribute('role','status');
          const save=icon(tools,'bookmark',message('收藏整句'),()=>void toggleSave(i,save,error));saveButtons.set(i,save);
          save.addEventListener('pointerdown',e=>{if(shadowSelection(root))e.preventDefault();});
          icon(tools, 'ask', message('问 AI'), () => actions.ask(i));tools.append(error); body.append(row);
        });
      } else if (tab === 'words') {
        if (!state.cues.length) empty(message(state.notice || '字幕尚未就绪'));
        for (const item of cueWords(state.cues, state.trackLang || undefined)) {
          const row = document.createElement('div'); row.className = 'row';
          const word = button(row, message('{word} · {count} 次',{word:item.word,count:item.count}), () => { details.open = true; actions.lookup(item.word, item.positions[0]!, word); });
          word.className = 'word'; word.dataset.word = item.word;
          const details = document.createElement('details'), summary = document.createElement('summary'); setText(summary, message('字幕位置')); details.append(summary);
          for (const i of item.positions) {
            const cue = state.cues[i]!, place = meta(details);
            button(place, fmtClock(cue.start), () => actions.seek(i)).dataset.playback = '';
            const lookup = button(place, cue.text, () => actions.lookup(item.word, i, lookup)); lookup.dataset.word = item.word;
          }
          row.append(details); body.append(row);
        }
      } else {
        const nav = document.createElement('div'); nav.className = 'controls'; body.append(nav);
        icon(nav, 'words', message('全部词语'), () => actions.open('list')); icon(nav, 'sentences', message('全部句子'), () => actions.open('sentences')); icon(nav, 'review', message('复习'), () => actions.open('review'));
        let count = 0;
        for (const entry of state.entries) for (const c of entry.contexts.filter(c => c.video?.videoId === state.videoId)) {
          count++;
          const row = document.createElement('div'); row.className = 'row';
          const expr = button(row, entry.expression, () => { const i = state.cues.findIndex(cue => cue.start === c.video?.startMs && cue.text === c.sentence); if (i >= 0) actions.lookup(entry.expression, i, expr); else actions.open('list'); }); expr.dataset.word = entry.expression;
          const status = document.createElement('select'); setLocalizedAttribute(status, 'aria-label', message('{expression} 学习状态',{expression:entry.expression}));
          for (const [value, label] of [['saved',message('已收藏')],['learning',message('在学')],['known',message('已掌握')]] as const) { const option = document.createElement('option'); option.value = value!; setText(option,label!); status.append(option); }
          status.value = entry.status; status.addEventListener('change', () => actions.status(entry.key, status.value)); row.append(status);
          const sentence = document.createElement('div'); sentence.textContent = c.sentence; row.append(sentence);
          const link = document.createElement('a'); link.href = c.url; link.textContent = fmtClock(c.video!.startMs); link.style.color = 'var(--pd-blue)';
          link.dataset.playback = ''; link.addEventListener('click', e => { const i = state.cues.findIndex(cue => cue.start === c.video!.startMs); if (i >= 0) { e.preventDefault(); actions.seek(i); } });
          row.append(link); body.append(row);
        }
        for (const saved of state.sentences.filter(s => s.video.videoId === state.videoId)) {
          count++;
          const row = document.createElement('div'); row.className = 'row';
          const text = document.createElement('div'); text.textContent = saved.text; row.append(text);
          if (saved.zh) { const zh = document.createElement('div'); zh.className = 'zh'; zh.textContent = saved.zh; row.append(zh); }
          const tools = meta(row);
          const link = document.createElement('a'); link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(saved.video.videoId)}&t=${saved.video.startMs / 1000}s`; setText(link,message('{source} · {text}',{source:message('整句'),text:fmtClock(saved.video.startMs)})); link.style.color = 'var(--pd-blue)';
          link.dataset.playback = ''; link.addEventListener('click', e => { const i = state.cues.findIndex(cue => cue.start === saved.video.startMs); if (i >= 0) { e.preventDefault(); actions.seek(i); } });
          tools.append(link);
          const error=document.createElement('span');error.className='save-error';error.hidden=true;error.setAttribute('role','status');
          const remove=icon(tools,'bookmark',message('取消收藏'),async()=>{
            if(remove.disabled)return;remove.disabled=true;remove.setAttribute('aria-busy','true');error.hidden=true;
            let result:{ok:boolean};try {result=await actions.remove(saved.id);}catch {result={ok:false};}
            if(!result.ok){setText(error,message('删除失败，重试'));error.hidden=false;remove.disabled=false;remove.setAttribute('aria-busy','false');}
          });remove.classList.add('is-saved');tools.append(error);body.append(row);
        }
        if (!count) empty(message('本视频还没有收藏。可在词卡保存词语，或在字幕行收藏整句。'));
      }
      setScroll(top);
      renderedTab = tab; lastCues = state.cues; lastSentences = state.sentences; lastEntries = state.entries;
      lastIdentity=identity();
    }
    if (rebuild || lastStatuses !== state.statuses) {
      const lang = (state.trackLang || 'en').split('-')[0]!;
      body.querySelectorAll<HTMLElement>('.w,[data-word]').forEach(el => {
        el.classList.remove('saved', 'learning', 'known');
        const word = el.dataset.word ?? el.textContent ?? '';
        const status = state.statuses.get(normalizeExpressionInLanguage(word, lang));
        if (status) el.classList.add(status);
      });
      lastStatuses = state.statuses;
    }
    const readingTop=body.scrollTop;
    if(!state.cues.length&&(tab==='subs'||tab==='words')){
      const notice=body.querySelector<HTMLElement>(':scope > .muted');
      if(notice)setText(notice,message(state.notice||(tab==='subs'?'正在读取字幕…':'字幕尚未就绪')));
    }
    if (tab === 'subs') body.querySelectorAll<HTMLElement>('[data-cue]').forEach(row => {
      const zh = row.querySelector<HTMLElement>('.zh')!; const value = state.translations.get(Number(row.dataset.cue)) ?? '';
      if (zh.textContent !== value) zh.textContent = value; zh.hidden = !state.chinese || !value;
    });
    if(tab==='subs'){saveButtons.forEach((b,i)=>{const key=cueId(i);if(confirmedSaves.get(key)===storedSaved(i))confirmedSaves.delete(key);updateSaveButton(i,b);});setScroll(readingTop);}
    highlight(rebuild);
  }
  function highlight(force = false) {
    back.hidden = follow;
    if (tab !== 'subs' || (!force && lastCurrent === state.current)) return;
    body.querySelector('.current')?.classList.remove('current');
    const row = body.querySelector<HTMLElement>(`[data-cue="${state.current}"]`); row?.classList.add('current');
    if (row && follow && !selectionHeld) setScroll(body.scrollTop + row.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientHeight / 3);
    lastCurrent = state.current;
  }
  return {
    snapshot: () => ({ tab, follow, top:body.scrollTop }),
    restore(value: {tab?:string;follow?:boolean;top?:number}) { if(value.tab && ['subs','words','saved'].includes(value.tab))tab=value.tab;follow=value.follow!==false;render();setScroll(value.top??0); },
    update(next: WorkspaceState) { state = next; render(); },
    clearSavedFeedback() {confirmedSaves.clear();},
    destroy() {document.removeEventListener('selectionchange',selectionChanged);document.removeEventListener('pointerup',endScrollbar);document.removeEventListener('pointercancel',endScrollbar);unbindWords();unlocalize();host.remove();},
  };
}

export const subtitleFontSize = (size: Settings['subtitleSize']) => size === 'small' ? 23 : size === 'large' ? 34 : 28;
