// M11 学习库：完整聊天会话与材料快照的 Markdown 往返（spec 4.5）。
// 会话一份（对话/<标题>-<id短码>.md），材料每版本一份（材料/<chatId>-v<N>.md）。
// 受管内容：消息按“## 消息 N · 角色”分节，元数据行（- 键：值）+ 空行 + 正文；
// 生成状态原样保留（另一浏览器不把 streaming 改成中断）。
// 个人笔记由词卡/句子的“我的笔记”承载；会话文件不含 key/草稿/未提交引用。

import type { ChatMessageRecord, ChatRecord, MaterialSnapshotRecord, QuoteRef } from '@/shared/chat';
import type { VaultChatRecord } from '@/shared/vault';

function fmValue(v: string | number): string {
  const s = String(v);
  return s === '' || /["\n\r:]/.test(s) || s !== s.trim() ? JSON.stringify(s) : s;
}

const MSG_RE = /^## 消息 (\d+) · (user|assistant)(?:\n|$)/;
const META_RE = /^- ([^：]+)：(.*)$/;
// 正文防碰撞：正文行若形如消息标题（split 的切分前缀，不限角色），行首加零宽空格；
// 解析重建正文时剥掉，保证往返无损（零宽空格对 Obsidian 不可见）。
const ZWSP = '\u200B';

function escapeMessageText(text: string): string {
  return text.replace(/^(?=## 消息 \d+ · )/gm, ZWSP);
}

function unescapeMessageText(text: string): string {
  return text.replace(/(^|\n)\u200B/g, '$1');
}

function readSource(raw: string): ChatRecord['source'] {
  const source = JSON.parse(raw);
  if (source === null) return null;
  if (!source || !['article','youtube','x'].includes(source.sourceType) ||
      ['sourceKey','title','url'].some(key => typeof source[key] !== 'string')) throw new Error('format: source');
  return source;
}

export function serializeChatRecord(record: VaultChatRecord): string {
  const lines: string[] = [
    '---',
    `id: ${fmValue(record.id)}`,
    `title: ${fmValue(record.title)}`,
    `sourceType: ${fmValue(record.source?.sourceType ?? '')}`,
    `sourceUrl: ${fmValue(record.source?.url ?? '')}`,
    `source: ${fmValue(JSON.stringify(record.source))}`,
    `activeSnapshotVersion: ${record.activeSnapshotVersion ?? 0}`,
    `updatedAt: ${record.updatedAt}`,
    '---',
    '',
    `# ${record.title}`,
    '',
  ];
  if (record.source?.video) {
    const v = record.source.video;
    lines.push(`来源轨道：${v.videoId} · ${v.trackLang} · ${v.trackKind}`, '');
  }
  const versions = record.snapshots.map((s) => `${s.version}`).join(', ');
  lines.push(`材料版本：${versions || '无'}`, '');
  record.messages.forEach((m, i) => {
    lines.push(`## 消息 ${i + 1} · ${m.role}`);
    lines.push(`- 标识：${m.id}`);
    if (m.requestId) lines.push(`- 请求：${m.requestId}`);
    lines.push(`- 时间：${new Date(m.at).toISOString()}`);
    if (m.turnId) lines.push(`- 轮次：${m.turnId}`);
    if (m.state) lines.push(`- 状态：${m.state}`);
    if (m.errorKind) lines.push(`- 错误：${m.errorKind}`);
    if (m.snapshotVersion !== undefined) lines.push(`- 材料：v${m.snapshotVersion}${m.segmentIndex !== undefined ? ` 段 ${m.segmentIndex}` : ''}`);
    if (m.scopeLabel) lines.push(`- 范围：${m.scopeLabel}`);
    if (m.retained) lines.push(`- 保留：是`);
    if (m.quote) {
      lines.push(`- 引用：${JSON.stringify(m.quote)}`);
    }
    lines.push('');
    lines.push(escapeMessageText(m.text));
    lines.push('');
  });
  return lines.join('\n');
}

export interface ParsedChatDocument {
  id: string;
  title: string;
  sourceType: 'youtube' | 'article' | 'x' | null;
  sourceUrl: string;
  sourceVideo?: import('@/shared/chat').SourceDescriptor['video'];
  source?: ChatRecord['source'];
  activeSnapshotVersion?: number | null;
  updatedAt: number;
  messages: ChatMessageRecord[];
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try { return String(JSON.parse(t)); } catch { return t.slice(1, -1); }
  }
  return t;
}

export function parseChatDocument(text: string): ParsedChatDocument | { error: 'format' } {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) return { error: 'format' };
  const fm: Record<string, string> = {};
  for (const line of fmMatch[1]!.split('\n')) {
    const m = line.match(/^([a-zA-Z]+): ?(.*)$/);
    if (m) fm[m[1]!] = unquote(m[2]!);
  }
  if (!fm.id) return { error: 'format' };
  const body = text.slice(fmMatch[0].length);
  const messages: ChatMessageRecord[] = [];
  const sections = body.split(/\n(?=## 消息 \d+ · )/);
  for (const section of sections) {
    const head = section.match(MSG_RE);
    if (!head) continue;
    const role = head[2] as 'user' | 'assistant';
    const rest = section.slice(head[0].length).replace(/^\n/, '');
    const lines = rest.split('\n');
    let i = 0;
    const meta: Record<string, string> = {};
    for (; i < lines.length; i++) {
      const mm = lines[i]!.match(META_RE);
      if (!mm) break;
      meta[mm[1]!] = mm[2]!;
    }
    const bodyText = unescapeMessageText(lines.slice(i).join('\n')).trim();
    if (!bodyText && !Object.keys(meta).length) continue;
    const msg: ChatMessageRecord = {
      id: meta['标识'] ?? `${fm.id}:${head[1]}`,
      role,
      turnId: meta['轮次'] ?? '',
      text: bodyText,
      at: meta['时间'] ? Date.parse(meta['时间']) || 0 : 0,
    };
    if (meta['请求']) msg.requestId = meta['请求'];
    if (meta['状态']) msg.state = meta['状态'] as ChatMessageRecord['state'];
    if (meta['错误']) msg.errorKind = meta['错误'];
    if (meta['材料']) {
      const v = meta['材料'].match(/^v(\d+)(?: 段 (\d+))?/);
      if (v) {
        msg.snapshotVersion = Number(v[1]);
        if (v[2] !== undefined) msg.segmentIndex = Number(v[2]);
      }
    }
    if (meta['范围']) msg.scopeLabel = meta['范围'];
    if (meta['保留'] === '是') msg.retained = true;
    if (meta['引用']) {
      const raw = meta['引用'];
      if (raw.startsWith('{')) {
        try {
          const quote = JSON.parse(raw) as QuoteRef;
          if (!Array.isArray(quote.blockIds) || !quote.blockIds.every(id => typeof id === 'string')) return { error: 'format' };
          msg.quote = quote;
        } catch { return { error: 'format' }; }
      } else if (raw.includes('｜')) {
        // 新分隔符全角竖线：blocks ｜ 表达式 ｜ 备注（表达式槽可为空；备注含竖线时保留）
        const parts = raw.split('｜');
        const expr = (parts[1] ?? '').trim();
        const note = parts.slice(2).join('｜').trim();
        msg.quote = {
          blockIds: (parts[0] ?? '').trim().split(/\s+/).filter(Boolean),
          ...(expr ? { expression: expr } : {}),
          ...(note ? { note } : {}),
        };
      } else {
        // 旧文件按 " · " 解析（历史行为：表达式并入备注）
        const [blocks, ...notes] = raw.split(' · ');
        msg.quote = { blockIds: (blocks ?? '').split(/\s+/).filter(Boolean), note: notes.join(' · ') || undefined };
      }
    }
    messages.push(msg);
  }
  const videoLine = body.match(/^来源轨道：(\S+) · (\S+) · (\S+)$/m);
  const sourceType = fm.sourceType as ParsedChatDocument['sourceType'];
  let source: ChatRecord['source'] | undefined;
  if (fm.source !== undefined) {
    try { source = readSource(fm.source); } catch { return { error: 'format' }; }
  }
  return {
    id: fm.id,
    title: fm.title || '(无标题)',
    sourceType: sourceType ?? null,
    sourceUrl: fm.sourceUrl ?? '',
    source,
    activeSnapshotVersion: fm.activeSnapshotVersion === undefined ? undefined : Number(fm.activeSnapshotVersion) || null,
    sourceVideo: videoLine
      ? { videoId: videoLine[1]!, trackId: '', trackKind: videoLine[3] as 'manual' | 'asr', trackLang: videoLine[2]! }
      : undefined,
    updatedAt: Number(fm.updatedAt) || 0,
    messages,
  };
}

/** 材料快照：每版本一份，不可变（外部只读，不回写语义字段）。 */
export function materialIdOf(chatId: string, version: number): string {
  return `${chatId}::v${version}`;
}

export function serializeMaterialSnapshot(chatId: string, snapshot: MaterialSnapshotRecord): string {
  const lines = ['---', `id: ${fmValue(materialIdOf(chatId, snapshot.version))}`, `chat: ${fmValue(chatId)}`, `version: ${snapshot.version}`, `label: ${fmValue(snapshot.label)}`, `source: ${fmValue(JSON.stringify(snapshot.source))}`, `createdAt: ${snapshot.createdAt}`, '---', '', `# ${snapshot.label}`, ''];
  for (const b of snapshot.blocks) {
    const time = b.startMs !== undefined ? `（${b.startMs}–${b.endMs ?? ''} ms）` : '';
    lines.push(`## ${b.id}${time}`, '', b.text, '');
  }
  return lines.join('\n');
}

export function parseMaterialDocument(text: string): { chatId: string; version: number; snapshot: MaterialSnapshotRecord } | { error: 'format' } {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) return { error: 'format' };
  const fm: Record<string, string> = {};
  for (const line of fmMatch[1]!.split('\n')) {
    const m = line.match(/^([a-zA-Z]+): ?(.*)$/);
    if (m) fm[m[1]!] = unquote(m[2]!);
  }
  if (!fm.chat || !fm.version) return { error: 'format' };
  if (!Number.isSafeInteger(Number(fm.version)) || Number(fm.version) < 1) return { error: 'format' };
  let source: MaterialSnapshotRecord['source'] | undefined;
  if (fm.source !== undefined) {
    try {
      const parsed = readSource(fm.source);
      if (!parsed) return { error: 'format' };
      source = parsed;
    } catch { return { error: 'format' }; }
  }
  const body = text.slice(fmMatch[0].length);
  const blocks = [];
  for (const section of body.split(/\n(?=## p\d+)/)) {
    const head = section.match(/^## (p\d+)(?:（(\d+)?–(\d+)? ms）)?/);
    if (!head) continue;
    const content = section.slice(head[0].length).replace(/^\n+/, '').trim();
    blocks.push({
      id: head[1]!,
      text: content,
      ...(head[2] !== undefined && head[2] !== '' ? { startMs: Number(head[2]), endMs: head[3] ? Number(head[3]) : undefined } : {}),
    });
  }
  if (!blocks.length || blocks.some(block => !block.text) || new Set(blocks.map(block => block.id)).size !== blocks.length) return { error: 'format' };
  return {
    chatId: fm.chat,
    version: Number(fm.version),
    snapshot: {
      source: source ?? { sourceType: 'article', sourceKey: '', title: fm.label ?? '', url: fm.sourceUrl ?? '' },
      version: Number(fm.version),
      createdAt: Number(fm.createdAt) || 0,
      label: fm.label ?? '',
      blocks,
    },
  };
}
