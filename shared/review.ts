// M4 原句复习的队列构建（纯逻辑，tools/regress.ts 离线回归）。
// 一次会话按词条遍历：每个词条选一条已有上下文，不重复刷同一词条；
// 默认排除 known；语境释义只取当前原句中已保存的（没有则明确显示未保存）。

import type { ContextView, EntryView } from './messages';
import type { LearningResult, VocabStatus } from './vocab';
import { sourceKeyOf, statusIdFromXUrl } from './chat';
import { effectiveEntryLanguage } from './languages';

export interface LearningScope { sourceKey?: string; language?: string }

export function contextSourceKey(context: ContextView): string {
  if (context.video) return sourceKeyOf({ sourceType: 'youtube', videoId: context.video.videoId });
  try {
    const url = new URL(context.url);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (/(^|\.)(x\.com|twitter\.com)$/.test(url.hostname)) {
      const statusId = statusIdFromXUrl(context.url);
      return statusId ? sourceKeyOf({ sourceType: 'x', statusId }) : '';
    }
    return sourceKeyOf({ sourceType: 'article', url: context.url });
  } catch { return ''; }
}

/** Filter contexts before aggregation, shared by preview, count, details and review. */
export function scopeEntries(entries: EntryView[], scope: LearningScope = {}): EntryView[] {
  return entries.filter(e => !scope.language || (effectiveEntryLanguage(e) ?? 'und') === scope.language).map(e => ({
    ...e, contexts: e.contexts.filter(c => !scope.sourceKey || contextSourceKey(c) === scope.sourceKey).sort((a, b) => b.createdAt - a.createdAt),
  })).filter(e => e.contexts.length).sort((a, b) => b.contexts[0]!.createdAt - a.contexts[0]!.createdAt);
}

export interface ReviewItem {
  key: string;
  expression: string;
  status: VocabStatus;
  sentence: string;
  definition: string | null;
  reference?: LearningResult;
  sourceType: 'web' | 'video';
  url: string;
  title: string;
  video: ContextView['video'];
  createdAt: number;
}

export function buildReviewQueue(entries: EntryView[], scope: LearningScope = {}): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const e of scopeEntries(entries, scope)) {
    if (e.status !== 'saved' && e.status !== 'learning') continue; // 默认排除 known
    if (!e.contexts.length) continue;
    const ctx = e.contexts[0]!; // 最新一条
    const definition = ctx.explanation?.text ?? ctx.definition ?? null;
    items.push({
      key: e.key,
      expression: e.expression,
      status: e.status,
      sentence: ctx.sentence,
      definition,
      reference: ctx.result,
      sourceType: ctx.sourceType,
      url: ctx.url,
      title: ctx.title,
      video: ctx.video ?? null,
      createdAt: ctx.createdAt,
    });
  }
  return items;
}

/**
 * 词条变化后重排队列：保持当前位置（按词条键），被删除或改为 known 的
 * 词条从队列移除，新增的 saved / learning 词条追加。
 */
export function refreshQueue(
  queue: ReviewItem[],
  currentKey: string | null,
  entries: EntryView[],
  scope: LearningScope = {},
): { queue: ReviewItem[]; currentIndex: number } {
  const fresh = new Map(buildReviewQueue(entries, scope).map((it) => [it.key, it]));
  const next: ReviewItem[] = [];
  for (const it of queue) {
    const upd = fresh.get(it.key);
    if (upd) {
      next.push(upd);
      fresh.delete(it.key);
    }
  }
  for (const rest of fresh.values()) next.push(rest);
  let idx = currentKey ? next.findIndex((it) => it.key === currentKey) : 0;
  if(idx<0) {
    const previous=queue.findIndex(item=>item.key===currentKey);
    const following=queue.slice(previous+1).find(item=>next.some(fresh=>fresh.key===item.key));
    idx=following?next.findIndex(item=>item.key===following.key):Math.min(Math.max(0,previous),next.length);
  }
  return { queue: next, currentIndex: idx };
}
