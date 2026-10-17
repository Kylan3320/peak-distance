import { sourceKeyOf, statusIdFromXUrl, type SourceDescriptor } from '@/shared/chat';
import { scopeEntries } from '@/shared/review';
import { effectiveEntryLanguage } from '@/shared/languages';
import type { EntryView } from '@/shared/messages';
import type { KnowledgeRecord } from '@/shared/knowledge';
import { message, setText, languageLabel, setLocalizedAttribute, type UiText } from '@/shared/i18n';
import type { SelectionSnapshot } from '@/shared/panel';
import { appendKnowledgeBody, knowledgeEditor } from './knowledgeView';

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
    if (mount.querySelector('.knowledge-editor') || [...mount.querySelectorAll('textarea')].some(t => t === document.activeElement)) return;
    state = captured;
    signature = next; mount.replaceChildren();
    const heading = document.createElement('h1'); heading.textContent = captured.source?.title || ''; if (!heading.textContent) setText(heading, message('当前内容')); mount.append(heading);
    if (!captured.source) { const empty = document.createElement('p'); setText(empty, message('请打开文章或 X 帖子查看本篇学习记录')); mount.append(empty); return; }
    const sourceLink = document.createElement('a'); sourceLink.className = 'source'; sourceLink.textContent = captured.source.url; sourceLink.href = captured.source.url; sourceLink.target = '_blank'; sourceLink.rel = 'noopener'; mount.append(sourceLink);
    const toolbar = document.createElement('div'); toolbar.className = 'article-tools';
    const button = (label: string, click: () => void) => { const b = document.createElement('button'); setText(b, message(label)); b.onclick = click; toolbar.append(b); return b; };
    for (const [category, label] of [['vocab', '生词'], ['knowledge', '知识点']] as const) {
      const b = button(label, () => { state.category = category; signature = ''; void update(source, selection); actions.changed(); });
      b.setAttribute('aria-pressed', String(captured.category === category)); b.className = captured.category === category ? '' : 'ghost';
    }
    const allEntries = scopeEntries(vocab?.entries ?? [], { sourceKey: captured.source.sourceKey });
    const allKnowledge = (knowledge?.records ?? []).filter(k => k.source.sourceKey === captured.source!.sourceKey);
    const language = document.createElement('select'); setLocalizedAttribute(language, 'aria-label', message('原文语言'));
    const langs = new Set(captured.category === 'vocab' ? allEntries.map(e => effectiveEntryLanguage(e) ?? 'und') : allKnowledge.map(k => k.language));
    if (captured.language !== 'all') langs.add(captured.language);
    for (const lang of ['all', ...[...langs].sort()]) { const option = document.createElement('option'); option.value = lang; setText(option, lang === 'all' ? message('全部语言') : languageLabel(lang)); language.append(option); }
    language.value = captured.language;
    language.onchange = () => { state.language = language.value; signature = ''; void update(source, selection); actions.changed(); }; toolbar.append(language);
    button('复习本篇', () => actions.review(structuredClone(captured))).className='primary';
    mount.append(toolbar);
    if (!vocab?.ok || !knowledge?.ok) { const error = document.createElement('p'); setText(error, message('加载失败，请重试')); mount.append(error); signature = ''; return; }
    const entries = scopeEntries(allEntries, { language: captured.language === 'all' ? undefined : captured.language });
    const records = allKnowledge.filter(k => captured.language === 'all' || k.language === captured.language);
    const count = document.createElement('p'); count.className = 'hint'; setText(count, message('共 {count} 条', { count: captured.category === 'vocab' ? entries.length : records.length })); mount.append(count);
    if(notice?.sourceKey===captured.source.sourceKey){const feedback=document.createElement('p');feedback.className='hint';feedback.setAttribute('role','status');setText(feedback,notice.text);mount.append(feedback);}
    if (captured.category === 'vocab') for (const entry of entries) mount.append(actions.entry(entry,knowledge.vaultId));
    else for (const record of records) {
      const row = document.createElement('details'); row.className = 'knowledge-row';
      const summary = document.createElement('summary'); summary.textContent = record.title; row.append(summary);
      const origin = document.createElement('p'); origin.className = 'hint'; origin.textContent = record.source.title || record.source.url; row.append(origin);
      appendKnowledgeBody(row, record);
      const status = document.createElement('p'); status.className = 'hint'; status.setAttribute('role', 'status');
      const edit = document.createElement('button'); edit.className = 'ghost'; setText(edit, message('编辑'));
      edit.onclick = () => { if (row.querySelector('form')) return; knowledgeEditor(row, record, async (title, body) => {
        const result = await actions.send<{ ok: boolean }>({ type: 'updateKnowledge', id: record.id, title, body, vaultId: knowledge.vaultId });
        if (!result?.ok) return false;
        notice={sourceKey:record.source.sourceKey,text:message('已保存在本机，待写入学习库')};
        signature = ''; queueMicrotask(() => void update(source, selection)); return true;
      }); };
      const remove = document.createElement('button'); remove.className = 'ghost'; setText(remove, message('删除知识点'));
      remove.onclick = async () => {
        if (remove.dataset.confirm !== 'yes') { remove.dataset.confirm = 'yes'; setText(remove, message('确认删除知识点')); return; }
        remove.disabled = true;
        const result = await actions.send<{ ok: boolean }>({ type: 'deleteKnowledge', id: record.id, vaultId: knowledge.vaultId });
        if (result?.ok) { notice={sourceKey:record.source.sourceKey,text:message('已删除知识点')};signature = ''; void update(source, selection); } else { remove.disabled = false; setText(status, message('删除失败，请重试')); }
      };
      row.append(edit, remove, status); mount.append(row);
    }
    if (!(captured.category === 'vocab' ? entries.length : records.length)) {
      const empty = document.createElement('p'); empty.className = 'empty'; setText(empty, message(captured.category === 'vocab' ? '在本篇查词后收藏表达，即可在此查看。' : '附加本篇材料提问后，可将回答保存为独立知识点。')); mount.append(empty);
    }
    if (selection && articleSource(selection.url, selection.title)?.sourceKey === captured.source.sourceKey) {
      const temporary = document.createElement('details'); temporary.className = 'selection-area';
      const label = document.createElement('summary'); setText(label, message('最近选区')); const text = document.createElement('p'); text.textContent = selection.text;
      const translate = document.createElement('button'); setText(translate, message('翻译选区')); translate.onclick = () => actions.translate(selection); temporary.append(label, text, translate); mount.append(temporary);
    }
  }
  return { update, snapshot: () => structuredClone(state), restore: (saved: ArticleLearningSnapshot) => { generation++; state = structuredClone(saved); signature = ''; }, follow: () => { generation++; state.pinned = false; }, invalidate: () => { signature = ''; }, reset: () => { generation++;signature='';notice=null;state={source:null,category:'vocab',language:'all',pinned:false};mount.replaceChildren(); } };
}
