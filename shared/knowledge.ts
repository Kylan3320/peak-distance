import { buildSegments, CHAT_MATERIAL_BUDGET_CHARS, parseAnswerCitations, snapshotChars, type ChatRecord, type MaterialBlock, type SourceDescriptor } from './chat';
import type { SelectionSnapshot } from './panel';
import { isLanguageTag, normalizeLangTag } from './languages';
import { sourceKeyOf, statusIdFromXUrl } from './chat';
import { vaultRecordJson } from './vault';

/** Self-contained learning material. Origin is for deduplication, never for reading. */
export interface KnowledgeRecord {
  id: string;
  title: string;
  body: string;
  language: string;
  source: SourceDescriptor;
  quotes: MaterialBlock[];
  origin: { type?: 'answer'; chatId: string; messageId: string } | TranslationOrigin;
  createdAt: number;
  updatedAt: number;
}

export function knowledgeFromAnswer(chat: ChatRecord, messageId: string): Omit<KnowledgeRecord, 'id' | 'createdAt' | 'updatedAt'> | null {
  const answer = chat.messages.find(m => m.id === messageId && m.role === 'assistant');
  if (!answer?.text.trim() || !['done', 'stopped'].includes(answer.state ?? '')) return null;
  const question = chat.messages.find(m => m.role === 'user' && m.turnId === answer.turnId);
  const snapshot = chat.snapshots.find(s => s.version === question?.snapshotVersion);
  if (!question || !snapshot || snapshot.source.sourceType === 'youtube' || !/^https?:\/\//.test(snapshot.source.url)) return null;
  const blocks = snapshotChars(snapshot.blocks) <= CHAT_MATERIAL_BUDGET_CHARS ? snapshot.blocks
    : buildSegments(snapshot.blocks, snapshot.source.sourceType)[question.segmentIndex ?? 0]?.blocks ?? [];
  const cited = new Set(parseAnswerCitations(answer.text).flatMap(t => t.type === 'cite' ? [t.id] : []));
  return {
    title: question.text, body: answer.text, language: 'und', source: structuredClone(snapshot.source),
    quotes: structuredClone(blocks.filter(b => cited.has(b.id))), origin: { chatId: chat.id, messageId },
  };
}

export function mergeKnowledge(base: KnowledgeRecord | null, local: KnowledgeRecord, remote: KnowledgeRecord):
  { kind: 'merged'; value: KnowledgeRecord } | { kind: 'conflict'; fields: { field: string; local: unknown; remote: unknown }[] } {
  const value = { ...local };
  const fields: { field: string; local: unknown; remote: unknown }[] = [];
  // Timestamps are informational. Only a shared base can establish independent edits.
  for (const key of ['title', 'body', 'language', 'source', 'quotes', 'origin', 'createdAt'] as const) {
    const same = (a: unknown, b: unknown) => vaultRecordJson(a) === vaultRecordJson(b);
    if (same(local[key], remote[key]) || base && same(remote[key], base[key])) continue;
    if (base && same(local[key], base[key])) Object.assign(value, { [key]: remote[key] });
    else fields.push({ field: key, local: local[key], remote: remote[key] });
  }
  value.updatedAt = Math.max(local.updatedAt, remote.updatedAt);
  return fields.length ? { kind: 'conflict', fields } : { kind: 'merged', value };
}

export interface TranslationOrigin {
  type: 'translation';
  identity: string;
  text: string;
  translation?: string;
  sourceMode: string;
  targetLang: string;
  service: import('./translationService').TranslationService;
  position?: SelectionSnapshot['position'];
  bodyEdited?: boolean;
}
export const normalizedTranslationText = (text: string) => text.replace(/\r\n?/g, '\n').normalize('NFC').trim();
export function selectionSource(snapshot: SelectionSnapshot): SourceDescriptor | null {
  try {
    const url = new URL(snapshot.source?.url ?? snapshot.url);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const title = snapshot.source?.title || snapshot.title;
    if (snapshot.position) {
      const p = snapshot.position;
      return { sourceType: 'youtube', sourceKey: `yt:${p.videoId}`, title,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(p.videoId)}&t=${Math.floor(p.startMs / 1000)}s`,
        video: { videoId: p.videoId, trackId: p.trackId, trackKind: p.trackKind, trackLang: p.trackLang } };
    }
    if (/(^|\.)(x\.com|twitter\.com)$/.test(url.hostname)) {
      const statusId = statusIdFromXUrl(url.href);
      return statusId ? { sourceType: 'x', sourceKey: sourceKeyOf({ sourceType: 'x', statusId }), title, url: url.href } : null;
    }
    return { sourceType: 'article', sourceKey: sourceKeyOf({ sourceType: 'article', url: url.href }), title, url: url.href };
  } catch { return null; }
}
export function translationIdentity(snapshot: SelectionSnapshot, sourceMode: string, targetLang: string): string {
  const source = selectionSource(snapshot), p = snapshot.position;
  return JSON.stringify([source?.sourceKey, p ? [p.videoId, p.trackId, p.startMs, p.endMs] : null, normalizedTranslationText(snapshot.text), sourceMode, targetLang]);
}
export function translationBody(origin: TranslationOrigin): string {
  return origin.text + (origin.translation ? `\n\n${origin.translation}` : '');
}
export function knowledgeFromTranslation(snapshot: SelectionSnapshot, sourceMode: string, targetLang: string, translation?: string, detectedLang?: string, service: TranslationOrigin['service'] = 'google-gtx'): Omit<KnowledgeRecord, 'id' | 'createdAt' | 'updatedAt'> {
  const source = selectionSource(snapshot);
  if (!source) throw new Error('invalid translation source');
  const origin: TranslationOrigin = { type: 'translation', identity: translationIdentity(snapshot, sourceMode, targetLang),
    text: snapshot.text, sourceMode, targetLang, service, ...(translation ? { translation } : {}), ...(snapshot.position ? { position: structuredClone(snapshot.position) } : {}) };
  const language = sourceMode !== 'auto' ? sourceMode : detectedLang;
  return { title: Array.from(snapshot.text.replace(/\s+/g, ' ').trim()).slice(0, 80).join(''), body: translationBody(origin),
    language: language && isLanguageTag(language) ? normalizeLangTag(language) : 'und', source, origin, quotes: [] };
}
