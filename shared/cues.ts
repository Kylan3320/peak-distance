// 字幕显示 / 翻译调度的纯逻辑（M2）。
// youtube.content.ts 与 tools/regress.ts 共用：currentTime 定位、ASR 滚动
// 重复消除、翻译预取窗口都在这里离线回归。

import type { Cue } from './protocol';
import { segmentWords } from './tokenize';
import { normalizeExpressionInLanguage } from './languages';

/**
 * 按显示条目计词次；位置去重，不猜词形。
 * M11：提供轨道语言时按该语言分词与规范化（与点击查词、标记同一边界）；
 * 缺省沿用英文正则（迁移前调用方兼容）。
 */
export function cueWords(cues: Cue[], lang?: string): { word: string; count: number; positions: number[] }[] {
  const words = new Map<string, { word: string; count: number; positions: number[] }>();
  const keyOf = (w: string) => (lang ? normalizeExpressionInLanguage(w, lang) : w.toLowerCase());
  cues.forEach((cue, index) => {
    const tokens = lang
      ? segmentWords(cue.text, lang).map((s) => s.text)
      : Array.from(cue.text.matchAll(/[A-Za-z][A-Za-z'’-]*/g), (m) => m[0]);
    for (const token of tokens) {
      const key = keyOf(token);
      const item = words.get(key) ?? { word: token, count: 0, positions: [] };
      item.count++;
      if (item.positions.at(-1) !== index) item.positions.push(index);
      words.set(key, item);
    }
  });
  return [...words.values()];
}

export function cueEnd(cues: Cue[], index: number): number {
  const cue = cues[index];
  return cue ? Math.min(cue.start + cue.dur, cues[index + 1]?.start ?? Infinity) : Infinity;
}

/** 平台译文缓存随显示分组规则更新；原始轨道身份与历史收藏不变。 */
export const DISPLAY_CUE_VERSION = 2;

export function sameDisplayCues(a: Cue[], b: Cue[]): boolean {
  return a.length === b.length && a.every((cue, i) => {
    const other = b[i]!;
    return cue.start === other.start && cue.dur === other.dur && cue.text === other.text;
  });
}

/** 只在完整 cue 之间合并；无法确认句末的尾部按源 cue 输出。 */
export function groupDisplayCues(cues: Cue[], lang: string): Cue[] {
  return groupCueUnits(cues, lang).cues;
}

/** 同一源列表派生两个视图；成员索引在分组时记录，不按时间猜归属。 */
export function buildSubtitleViews(rawCues: Cue[], kind: 'manual' | 'asr', lang: string): {
  cues: Cue[]; fragments: Cue[]; fragmentGroups: number[];
} {
  const fragments = kind === 'asr' ? normalizeAsrCues(rawCues) : rawCues;
  return { ...groupCueUnits(fragments, lang), fragments };
}

function groupCueUnits(cues: Cue[], lang: string): { cues: Cue[]; fragmentGroups: number[] } {
  const segmenter = new Intl.Segmenter(lang || undefined, { granularity: 'sentence' });
  const separator = /^(zh|ja)(-|$)/i.test(lang) ? '' : ' ';
  const out: Cue[] = [];
  const fragmentGroups: number[] = [];
  let pending: Cue[] = [];
  const flushOriginal = () => {
    for (const cue of pending) { fragmentGroups.push(out.length); out.push(cue); }
    pending = [];
  };
  const join = (items: Cue[]) => items.map(c => c.text).join(separator);
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i]!;
    if (pending.length && cue.start - (pending.at(-1)!.start + pending.at(-1)!.dur) > 1500) flushOriginal();
    pending.push(cue);
    // Segmenter 的输入结束也是边界；必须先看到真实句末标点。
    if (!/[.!?。！？]["'”’»」』）)\]]*$/.test(cue.text)) continue;
    const text = join(pending);
    const next = cues[i + 1];
    if (/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr))\.["'”’]*$/i.test(text)) continue;
    if (/\d\.$/.test(text) && /^\d/.test(next?.text ?? '')) continue;
    if (/\b[A-Za-z]\.$/.test(text) && /^[A-Za-z]\./.test(next?.text ?? '')) continue;
    const probe = next ? text + separator + next.text : text;
    const boundary = [...segmenter.segment(probe)].some(part => part.index + part.segment.trimEnd().length === text.length);
    if (!boundary) continue;
    for (const _cue of pending) fragmentGroups.push(out.length);
    if (pending.length === 1) out.push(cue);
    else {
      const start = pending[0]!.start;
      out.push({ start, dur: pending.reduce((end, c) => Math.max(end, c.start + c.dur), start) - start,
        lastOff: pending.reduce((end, c) => Math.max(end, c.lastOff), start), text });
    }
    pending = [];
  }
  flushOriginal();
  return { cues: out, fragmentGroups };
}

/** 跨多个短片段的整句译文不能重复贴到每个播放器片段；歧义项交给常规回退。 */
export function alignFragmentTranslatedCues(fragments: Cue[], translated: Cue[]): Cue[] {
  const unambiguous = translated.filter(target => {
    let owners = 0;
    for (const fragment of fragments) {
      const overlap = Math.min(fragment.start + fragment.dur, target.start + target.dur) - Math.max(fragment.start, target.start);
      if (overlap > 0 && overlap >= Math.min(fragment.dur, target.dur) * 0.25 && ++owners > 1) return false;
    }
    return owners === 1;
  });
  return alignTranslatedCues(fragments, unambiguous);
}

/** 后台字幕翻译仍用数字 ID；两个视图占不相交的域，相同全文只发一次。 */
export function buildCueTranslationBatch(groups: Cue[], fragments: Cue[], groupIndices: number[], fragmentIndices: number[]): {
  items: { id: number; text: string }[];
  targets: { view: 'groups' | 'fragments'; index: number; id: number }[];
} {
  const items: { id: number; text: string }[] = [];
  const targets: { view: 'groups' | 'fragments'; index: number; id: number }[] = [];
  const byText = new Map<string, number>();
  const add = (cue: Cue, index: number, view: 'groups' | 'fragments', proposedId: number) => {
    const id = byText.get(cue.text) ?? proposedId;
    if (!byText.has(cue.text)) { byText.set(cue.text, id); items.push({ id, text: cue.text }); }
    targets.push({ view, index, id });
  };
  for (const index of groupIndices) add(groups[index]!, index, 'groups', index);
  for (const index of fragmentIndices) add(fragments[index]!, index, 'fragments', groups.length + index);
  return { items, targets };
}

/**
 * ASR 滚动重复消除与片段合并（保留来源时间）：
 * json3 自动字幕的相邻事件常为“同一句的逐步增长”（后者是前者的前缀延伸
 * 且时间相连）。把这种链合并成一条：start 用链首，dur 延伸到链尾，
 * text 用最长的一条，lastOff 用链尾。
 * 人工字幕本身不滚动，逐条返回（无代价地走同一函数）。
 */
export function normalizeAsrCues(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    const prev = out[out.length - 1];
    if (
      prev &&
      c.text.startsWith(prev.text) &&
      c.text !== prev.text &&
      c.start <= prev.lastOff + 1500 // 时间相连才算同一条滚动
    ) {
      const end = Math.max(prev.start + prev.dur, c.start + c.dur, c.lastOff);
      out[out.length - 1] = {
        start: prev.start,
        dur: end - prev.start,
        text: c.text,
        lastOff: Math.max(prev.lastOff, c.lastOff),
        zh: c.zh ?? prev.zh,
      };
      continue;
    }
    if (prev && c.text === prev.text && c.start < prev.start + prev.dur + 100) {
      // 完全相同的相邻重复：只延伸时长
      const end = Math.max(prev.start + prev.dur, c.start + c.dur);
      out[out.length - 1] = { ...prev, dur: end - prev.start, zh: c.zh ?? prev.zh };
      continue;
    }
    out.push(c);
  }
  return out;
}

/** 独立轨道按时间交集对齐；滚动译文保留最长文本，不按数组下标配对。 */
export function alignTranslatedCues(english: Cue[], chinese: Cue[]): Cue[] {
  return english.map(cue => {
    const matches = chinese.filter(c => {
      const overlap = Math.min(cue.start + cue.dur, c.start + c.dur) - Math.max(cue.start, c.start);
      return overlap > 0 && overlap >= Math.min(cue.dur, c.dur) * 0.25;
    });
    const parts: string[] = [];
    for (const c of matches) {
      const previous = parts.at(-1);
      if (previous && c.text.startsWith(previous)) parts[parts.length - 1] = c.text;
      else if (!parts.includes(c.text)) parts.push(c.text);
    }
    return { ...cue, zh: parts.join(' ') || undefined };
  });
}

/**
 * currentTime（毫秒）→ 当前句下标：最后一条 start <= t 且 t < start + dur。
 * 边界外（句间空隙）返回 -1。要求 cues 已按 start 升序。
 */
export function cueIndexAt(cues: Cue[], tMs: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid]!;
    if (c.start <= tMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found >= 0) {
    const c = cues[found]!;
    if (tMs < c.start + c.dur) return found;
    return -1;
  }
  return -1;
}

/**
 * 翻译预取窗口：以当前句为中心的前后若干条（按下标 = 字幕 ID）。
 * 返回去重升序的下标列表；count 为 0 或当前句为 -1 时返回空。
 */
export function buildTranslateWindow(
  count: number,
  current: number,
  before: number,
  after: number,
): number[] {
  if (current < 0 || count <= 0) return [];
  const from = Math.max(0, current - before);
  const to = Math.min(count - 1, current + after);
  const ids: number[] = [];
  for (let i = from; i <= to; i++) ids.push(i);
  return ids;
}

/** 毫秒 → m:ss / h:mm:ss（字幕栏与侧栏显示用）。 */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (x: number) => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}
