// A collection is one Markdown file; each record reuses the existing document format.
// YAML fences are visible in Obsidian, and record headings sit one level below the book.
import { knowledgeBodyEnvelope } from './knowledgeFormat';

export type CollectionKind = 'vocab' | 'sentence' | 'knowledge';
export const COLLECTION_FILES = { vocab: '生词本.md', sentence: '句子.md', knowledge: '知识点.md' } as const;

export interface CollectionDocument {
  prefix: string;
  documents: string[];
}

export function parseCollection(text: string, kind: CollectionKind): CollectionDocument {
  const normalized = text.replace(/\r\n?/g, '\n');
  const separator = new RegExp(`^<!-- peak-distance:${kind} -->[ \\t]*$`, 'gm');
  const parts: string[] = [];
  let from = 0, marker: RegExpExecArray | null;
  while ((marker = separator.exec(normalized))) {
    parts.push(normalized.slice(from, marker.index));
    from = separator.lastIndex;
    if (kind === 'knowledge') {
      const envelope = knowledgeBodyEnvelope(normalized.slice(from));
      const next = separator.exec(normalized);
      if (next && next.index < from + envelope.start) throw new Error(`format: ${COLLECTION_FILES[kind]}`);
      separator.lastIndex = from + envelope.end;
    }
  }
  parts.push(normalized.slice(from));
  const prefix = parts.shift()!;
  if (!prefix.startsWith(`<!-- peak-distance:collection ${kind} -->`)) throw new Error(`format: ${COLLECTION_FILES[kind]}`);
  const checkOrphanRecords = (body: string, hasKnowledgeBody = false) => {
    const envelope = hasKnowledgeBody ? knowledgeBodyEnvelope(body) : null;
    if (envelope && body.slice(envelope.end).trim()) throw new Error(`format: ${COLLECTION_FILES[kind]}`);
    const outside = envelope ? body.slice(0, envelope.start) : body;
    for (const match of outside.matchAll(/^```yaml\n([\s\S]*?)\n```/gm)) {
      if (/^id:/m.test(match[1]!) && /^language:/m.test(match[1]!)) throw new Error(`format: missing record separator in ${COLLECTION_FILES[kind]}`);
    }
  };
  checkOrphanRecords(prefix);
  const documents = parts.map(part => {
    const match = part.match(/^\s*```yaml\n([\s\S]*?)\n```\n([\s\S]*)$/);
    if (!match) throw new Error(`format: ${COLLECTION_FILES[kind]}`);
    checkOrphanRecords(match[2]!, kind === 'knowledge');
    const body = match[2]!.replace(/^(#{2,}) /gm, (_line, hashes: string) => `${hashes.slice(1)} `);
    return `---\n${match[1]}\n---\n${body}`;
  });
  return { prefix, documents };
}

export function serializeCollection(collection: CollectionDocument, kind: CollectionKind): string {
  const parts = collection.documents.map(document => {
    const match = document.replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) throw new Error(`format: ${COLLECTION_FILES[kind]}`);
    const body = match[2]!.replace(/^(#+) /gm, (_line, hashes: string) => `#${hashes} `);
    return `<!-- peak-distance:${kind} -->\n\`\`\`yaml\n${match[1]}\n\`\`\`\n${body.trim()}\n`;
  });
  return [collection.prefix.trimEnd(), ...parts].join('\n\n') + '\n';
}

export function emptyCollection(kind: CollectionKind): CollectionDocument {
  return { prefix: `<!-- peak-distance:collection ${kind} -->\n# ${kind === 'vocab' ? '生词本' : kind === 'sentence' ? '句子' : '知识点'}\n`, documents: [] };
}
