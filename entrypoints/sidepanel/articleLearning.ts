import { sourceKeyOf, statusIdFromXUrl, type SourceDescriptor } from '@/shared/chat';
import { scopeEntries, buildReviewQueue } from '@/shared/review';
import { effectiveEntryLanguage } from '@/shared/languages';
import type { EntryView } from '@/shared/messages';
import type { KnowledgeRecord } from '@/shared/knowledge';
import { message, setText, languageLabel, setLocalizedAttribute, type UiText } from '@/shared/i18n';
import type { SelectionSnapshot } from '@/shared/panel';
import { knowledgeRow } from './knowledgeView';
import { choiceMenu, iconButton } from '@/shared/uiControls';

export function collectionTab(category: string, label: UiText, count: number, selected: boolean, select: () => void): HTMLButtonElement {
  const button = document.createElement('button'); button.dataset.category = category;
  const caption = document.createElement('span'); setText(caption,label);
  const counter = document.createElement('span'); counter.className = 'article-count'; counter.textContent = String(count);
  button.append(caption,counter); button.setAttribute('aria-pressed', String(selected)); button.onclick = select;
  return button;
}

export type LearningCategory = 'vocab' | 'knowledge';
export interface ArticleLearningSnapshot { source: SourceDescriptor | null; category: LearningCategory; language: string; pinned: boolean }
export function articleSource(url: string, title: string): SourceDescriptor | null {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (/(^|\.)(x\.com|twitter\.com)$/.test(parsed.hostname)) {
      const statusId = statusIdFromXUrl(url);
      return statusId ? { sourceType: 'x', sourceKey: sourceKeyOf({ sourceType: 'x', statusId }), title, url } : null;
    }
    return { sourceType: 'article', sourceKey: sourceKeyOf({ sourceType: 'article', url }), title, url };
  } catch { return null; }
}

export function createArticleLearning(mount: HTMLElement, actions: {
  send: <T>(message: unknown) => Promise<T>;
  entry: (entry: EntryView, vaultId: string | null) => HTMLElement;
  review: (state: ArticleLearningSnapshot) => void;
  translate: (snapshot: SelectionSnapshot) => void;
  title: (source: SourceDescriptor | null) => void;
  changed: () => void;
}) {
  let state: ArticleLearningSnapshot = { source: null, category: 'vocab', language: 'all', pinned: false };
  let signature = '', generation = 0;
  let notice:{sourceKey:string;text:UiText}|null=null;
  async function update(source: SourceDescriptor | null, selection: SelectionSnapshot | null) {
    const version = ++generation, captured = structuredClone({...state, source: state.pinned ? state.source : source});
    const [vocab, knowledge] = await Promise.all([
      actions.send<{ ok: boolean; entries: EntryView[];vaultId:string|null }>({ type: 'listEntries' }),
      actions.send<{ ok: boolean; records: KnowledgeRecord[]; vaultId: string | null }>({ type: 'listKnowledge' }),
    ]);
    if (version !== generation) return;
    if(vocab?.ok&&knowledge?.ok&&vocab.vaultId!==knowledge.vaultId)return;
    const next = JSON.stringify([captured, selection, vocab, knowledge]);
    if (next === signature) { actions.title(state.source); return; }
    // Keep an open editor and unsaved notes intact during polling; mutations refresh after completion.
    if (mount.querySelector('.knowledge-editor,.note-editor') || [...mount.querySelectorAll('textarea')].some(t => t === document.activeElement)) return;
    const sameSource = state.source?.sourceKey === captured.source?.sourceKey;
    const expanded = new Set(sameSource ? [...mount.querySelectorAll<HTMLElement>('.entry:has(.entry-expand[aria-expanded=true])')].map(row=>row.dataset.key) : []);
    const knowledgeExpanded = new Set(sameSource ? [...mount.querySelectorAll<HTMLDetailsElement>('.knowledge-row[open]')].map(row=>row.dataset.id) : []);
    const selectionExpanded = sameSource && !!mount.querySelector('.selection-area details[open]');
    const filterFocused = sameSource && !!document.activeElement?.closest('.article-filter');
    state = captured;
    signature = next; mount.replaceChildren();
    actions.title(captured.source);
    if (!captured.source) {
      const empty = document.createElement('p'); setText(empty, message('请打开文章或 X 帖子查看本篇学习记录')); mount.append(empty); return;
    }
    if (selection && articleSource(selection.url, selection.title)?.sourceKey === captured.source.sourceKey) {
      const temporary = document.createElement('section'); temporary.className = 'selection-area';
      const details = document.createElement('details'); details.open = selectionExpanded;
      const label = document.createElement('summary'); setText(label, message('最近选区'));
      const full = document.createElement('p'); full.className = 'selection-full'; full.textContent = selection.text;
      details.append(label,full);
      const preview = document.createElement('p'); preview.className = 'selection-preview'; preview.textContent = selection.text;
      const translate = iconButton('translate',message('翻译选区')); translate.onclick = () => actions.translate(selection);
      temporary.append(details,translate,preview); mount.append(temporary);
    }
    if (!vocab?.ok || !knowledge?.ok) { const error = document.createElement('p'); setText(error, message('加载失败，请重试')); const retry = document.createElement('button'); setText(retry,message('重试'));
      retry.onclick = () => { signature=''; void update(source,selection); };
      mount.append(error,retry); signature = ''; return; }
    const allEntries = scopeEntries(vocab.entries, { sourceKey: captured.source.sourceKey });
    const allKnowledge = knowledge.records.filter(k => k.source.sourceKey === captured.source!.sourceKey);
    const entries = scopeEntries(allEntries, { language: captured.language === 'all' ? undefined : captured.language });
    const records = allKnowledge.filter(k => captured.language === 'all' || k.language === captured.language);
    const toolbar = document.createElement('div'); toolbar.className = 'article-tools';
    for (const [category, key, count] of [['vocab', '生词', entries.length], ['knowledge', '知识点', records.length]] as const) {
      toolbar.append(collectionTab(category,message(key),count,captured.category===category,() => {
        state.category = category; signature = ''; void update(source, selection); actions.changed();
      }));
    }
    const languageCounts = new Map<string,number>();
    const languages = captured.category==='vocab' ? allEntries.map(entry=>effectiveEntryLanguage(entry) ?? 'und') : allKnowledge.map(record=>record.language);
    for (const language of languages) languageCounts.set(language,(languageCounts.get(language) ?? 0)+1);
    if (captured.language!=='all'&&!languageCounts.has(captured.language)) languageCounts.set(captured.language,0);
    const language = choiceMenu('globe',captured.language==='all' ? message('语言筛选') : message('语言筛选：{language}',{language:languageLabel(captured.language)}),[
      {value:'all',label:message('全部语言'),count:languages.length},
      ...[...languageCounts.keys()].sort().map(value=>({value,label:languageLabel(value),count:languageCounts.get(value)})),
    ],captured.language,value=>{state.language=value;signature='';void update(source,selection);actions.changed();});
    language.wrap.classList.add('article-filter');
    language.trigger.setAttribute('aria-pressed',String(captured.language!=='all'));
    language.wrap.hidden = !languageCounts.size;
    toolbar.append(language.wrap);
    const review = iconButton('review',message('复习本篇'));
    review.hidden = captured.category === 'vocab' ? !buildReviewQueue(entries).length : !records.length;
    review.onclick = () => actions.review(structuredClone(captured)); toolbar.append(review); mount.append(toolbar);
    if(filterFocused&&!language.wrap.hidden)language.trigger.focus({preventScroll:true});
    if(notice?.sourceKey===captured.source.sourceKey){const feedback=document.createElement('p');feedback.className='hint';feedback.setAttribute('role','status');setText(feedback,notice.text);mount.append(feedback);}
    if (captured.category === 'vocab') for (const entry of entries) {
      const row = actions.entry(entry,knowledge.vaultId);
      if (expanded.has(entry.key)) row.querySelector<HTMLButtonElement>('.entry-expand')?.click();
      mount.append(row);
    } else for (const record of records) {
      const row = knowledgeRow(record,knowledge.vaultId,actions.send,()=>{signature='';void update(source,selection);});
      row.open = knowledgeExpanded.has(record.id);
      mount.append(row);
    }
    if (!(captured.category === 'vocab' ? entries.length : records.length)) {
      const empty = document.createElement('div'); empty.className = 'article-empty';
      const text = document.createElement('p');
      const filtered = captured.language !== 'all' && (captured.category === 'vocab' ? allEntries.length : allKnowledge.length) > 0;
      setText(text, message(filtered ? '没有匹配的学习记录' : captured.category === 'vocab' ? '在本篇查词后收藏表达，即可在此查看。' : '附加本篇材料提问后，可将回答保存为独立知识点。')); empty.append(text);
      if (filtered) { const clear = document.createElement('button'); setText(clear,message('清除语言筛选')); clear.onclick = () => { state.language = 'all'; signature = ''; void update(source,selection); actions.changed(); }; empty.append(clear); }
      mount.append(empty);
    }
  }
  return { update, snapshot: () => structuredClone(state), restore: (saved: ArticleLearningSnapshot) => { generation++; state = structuredClone(saved); signature = ''; }, follow: () => { generation++; state.pinned = false; }, invalidate: () => { signature = ''; }, reset: () => { generation++;signature='';notice=null;state={source:null,category:'vocab',language:'all',pinned:false};mount.replaceChildren(); } };
}
