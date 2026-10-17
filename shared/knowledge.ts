import { buildSegments, CHAT_MATERIAL_BUDGET_CHARS, parseAnswerCitations, snapshotChars, type ChatRecord, type MaterialBlock, type SourceDescriptor } from './chat';
import { vaultRecordJson } from './vault';

/** Self-contained learning material. Origin is for deduplication, never for reading. */
export interface KnowledgeRecord {
  id: string;
  title: string;
  body: string;
  language: string;
  source: SourceDescriptor;
  quotes: MaterialBlock[];
  origin: { chatId: string; messageId: string };
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
