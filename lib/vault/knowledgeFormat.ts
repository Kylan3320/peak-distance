import type { KnowledgeRecord } from '@/shared/knowledge';
import { isLanguageTag } from '@/shared/languages';

/** Locate the paired envelope before interpreting record separators or YAML in an answer. */
export function knowledgeBodyEnvelope(text: string): { start: number; bodyStart: number; bodyEnd: number; end: number } {
  const opening = /^<!-- peak-distance:body(?: (\d+))? -->[ \t]*\n/m.exec(text);
  if (!opening) throw new Error('format: knowledge body');
  const suffix = opening[1] === undefined ? '' : ` ${opening[1]}`;
  const bodyStart = opening.index + opening[0].length;
  const closing = new RegExp(`^<!-- peak-distance:end-body${suffix} -->[ \\t]*$`, 'gm');
  closing.lastIndex = bodyStart;
  let end = closing.exec(text);
  if (!end) throw new Error('format: knowledge body');
  if (!suffix) {
    // Old answers could quote end-body literally; keep the last close before another record.
    let later: RegExpExecArray | null;
    while ((later = closing.exec(text))) {
      const between = text.slice(end.index + end[0].length, later.index);
      if (/^<!-- peak-distance:(?:knowledge|body(?: \d+)?) -->[ \t]*$/m.test(between)) break;
      end = later;
    }
  }
  if (end.index <= bodyStart || new RegExp(`^<!-- peak-distance:body${suffix} -->[ \\t]*$`, 'm').test(text.slice(bodyStart, end.index))) {
    throw new Error('format: knowledge body');
  }
  return { start: opening.index, bodyStart, bodyEnd: end.index - 1, end: end.index + end[0].length };
}

export function serializeKnowledge(record: KnowledgeRecord): string {
  const { body, ...metadata } = record;
  let suffix = '';
  if (/^<!-- peak-distance:/m.test(body)) {
    let counter = 0;
    while (body.includes(`<!-- peak-distance:body ${counter} -->`) || body.includes(`<!-- peak-distance:end-body ${counter} -->`)) counter++;
    suffix = ` ${counter}`;
  }
  return `---\n${Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n# 知识点\n\n${record.quotes.map(q => `> [${q.id}] ${q.text.replace(/\n/g, '\n> ')}`).join('\n\n')}\n\n<!-- peak-distance:body${suffix} -->\n${body}\n<!-- peak-distance:end-body${suffix} -->\n`;
}

export function parseKnowledge(text: string): KnowledgeRecord {
  const match = text.replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('format: knowledge');
  const metadata = Object.fromEntries(match[1]!.split('\n').map(line => {
    const pair = line.match(/^(\w+): (.*)$/);
    if (!pair) throw new Error('format: knowledge metadata');
    return [pair[1]!, JSON.parse(pair[2]!)];
  }));
  const envelope = knowledgeBodyEnvelope(match[2]!);
  if (match[2]!.slice(envelope.end).trim()) throw new Error('format: knowledge body');
  const body = match[2]!.slice(envelope.bodyStart, envelope.bodyEnd);
  const record = { ...metadata, body } as KnowledgeRecord;
  if (typeof record.id !== 'string' || !record.id || typeof record.title !== 'string' || !record.title.trim() || !body.trim() || !isLanguageTag(record.language)
    || typeof record.source?.sourceKey !== 'string' || !record.source.sourceKey || !/^https?:\/\//.test(record.source.url) || typeof record.source.title !== 'string'
    || !['article', 'x'].includes(record.source.sourceType) || typeof record.origin?.chatId !== 'string' || !record.origin.chatId || typeof record.origin.messageId !== 'string' || !record.origin.messageId
    || !Array.isArray(record.quotes) || !record.quotes.every(q => typeof q.id === 'string' && typeof q.text === 'string')
    || !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)) throw new Error('format: knowledge');
  return record;
}
