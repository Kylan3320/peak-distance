import { sourceKeyOf, statusIdFromXUrl, type SourceDescriptor } from '@/shared/chat';
import { scopeEntries, buildReviewQueue } from '@/shared/review';
import { effectiveEntryLanguage } from '@/shared/languages';
import type { EntryView } from '@/shared/messages';
import type { KnowledgeRecord } from '@/shared/knowledge';
import { message, setText, languageLabel, setLocalizedAttribute, type UiText } from '@/shared/i18n';
import type { SelectionSnapshot } from '@/shared/panel';
import { knowledgeRow } from './knowledgeView';
import { iconButton, uiIcon } from '@/shared/uiControls';

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
    if (next === signature) return;
    // Keep an open editor and unsaved notes intact during polling; mutations refresh after completion.
    if (mount.querySelector('.knowledge-editor,.note-editor') || [...mount.querySelectorAll('textarea')].some(t => t === document.activeElement)) return;
    state = captured;
    signature = next; mount.replaceChildren();
    const heading = document.createElement('h1'); heading.textContent = captured.source?.title || ''; if (!heading.textContent) setText(heading, message('当前内容')); mount.append(heading);
    if (!captured.source) { const empty = document.createElement('p'); setText(empty, message('请打开文章或 X 帖子查看本篇学习记录')); mount.append(empty); return; }
    const sourceLink = document.createElement('a'); sourceLink.className = 'source article-source';
    sourceLink.textContent = new URL(captured.source.url).hostname; sourceLink.href = captured.source.url;
    sourceLink.title = captured.source.url; sourceLink.setAttribute('aria-label',captured.source.url);
    sourceLink.target = '_blank'; sourceLink.rel = 'noopener'; sourceLink.insertAdjacentHTML('beforeend',uiIcon('external')); mount.append(sourceLink);
    if (selection && articleSource(selection.url, selection.title)?.sourceKey === captured.source.sourceKey) {
      const temporary = document.createElement('section'); temporary.className = 'selection-area';
      const details = document.createElement('details');
      const label = document.createElement('summary'); setText(label, message('最近选区'));
      const full = document.createElement('p'); full.className = 'selection-full'; full.textContent = selection.text;
      details.append(label,full);
      const preview = document.createElement('p'); preview.className = 'selection-preview'; preview.textContent = selection.text;
      const translate = iconButton('translate',message('翻译选区')); translate.onclick = () => actions.translate(selection);
      temporary.append(details,translate,preview); mount.append(temporary);
    }
    if (!vocab?.ok || !knowledge?.ok) { const error = document.createElement('p'); setText(error, message('加载失败，请重试')); mount.append(error); signature = ''; return; }
    const allEntries = scopeEntries(vocab.entries, { sourceKey: captured.source.sourceKey });
    const allKnowledge = knowledge.records.filter(k => k.source.sourceKey === captured.source!.sourceKey);
    const entries = scopeEntries(allEntries, { language: captured.language === 'all' ? undefined : captured.language });
    const records = allKnowledge.filter(k => captured.language === 'all' || k.language === captured.language);
    const toolbar = document.createElement('div'); toolbar.className = 'article-tools';
    for (const [category, key, count] of [['vocab', '生词', entries.length], ['knowledge', '知识点', records.length]] as const) {
      const b = document.createElement('button'); b.dataset.category = category;
      const caption = document.createElement('span'); setText(caption,message(key));
      const counter = document.createElement('span'); counter.className = 'article-count'; counter.textContent = String(count);
      b.append(caption,counter); b.setAttribute('aria-pressed', String(captured.category === category));
      b.onclick = () => { state.category = category; signature = ''; void update(source, selection); actions.changed(); }; toolbar.append(b);
    }
    const language = document.createElement('select'); setLocalizedAttribute(language, 'aria-label', message('原文语言'));
    const langs = new Set(captured.category === 'vocab' ? allEntries.map(e => effectiveEntryLanguage(e) ?? 'und') : allKnowledge.map(k => k.language));
    if (captured.language !== 'all') langs.add(captured.language);
    for (const lang of ['all', ...[...langs].sort()]) { const option = document.createElement('option'); option.value = lang; setText(option, lang === 'all' ? message('全部语言') : languageLabel(lang)); language.append(option); }
    language.value = captured.language; language.hidden = !langs.size;
    language.onchange = () => { state.language = language.value; signature = ''; void update(source, selection); actions.changed(); }; toolbar.append(language);
    const review = iconButton('review',message('复习本篇'));
    review.hidden = captured.category === 'vocab' ? !buildReviewQueue(entries).length : !records.length;
    review.onclick = () => actions.review(structuredClone(captured)); toolbar.append(review); mount.append(toolbar);
    if(notice?.sourceKey===captured.source.sourceKey){const feedback=document.createElement('p');feedback.className='hint';feedback.setAttribute('role','status');setText(feedback,notice.text);mount.append(feedback);}
    if (captured.category === 'vocab') for (const entry of entries) mount.append(actions.entry(entry,knowledge.vaultId));
    else for (const record of records) mount.append(knowledgeRow(record, knowledge.vaultId, actions.send, () => {
      signature = ''; void update(source, selection);
    }));
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
