// MAIN 与隔离世界共用的字幕解析、表示、定位和翻译纯逻辑。

import type { Cue, LearningCue, PlaybackInterval, SourceFragment, SubtitleFragment, SubtitleViews } from './protocol';
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

/** 平台译文缓存随表示规则更新；轨道身份与历史收藏不变。 */
export const DISPLAY_CUE_VERSION = 3;

/** JSON3 的词段偏移和换人标记转换到规范化后的字符坐标。 */
export function parseJson3(json: any): SourceFragment[] {
  const cues: SourceFragment[] = [];
  if (!Array.isArray(json?.events)) return cues;
  let pendingSpeaker = false;
  for (const ev of json.events) {
    if (!Array.isArray(ev?.segs)) continue;
    const start = typeof ev.tStartMs === 'number' ? ev.tStartMs : 0;
    const dur = typeof ev.dDurationMs === 'number' ? ev.dDurationMs : 0;
    let raw = '';
    const timed: { from: number; to: number; time: number }[] = [];
    for (const seg of ev.segs) {
      if (typeof seg?.utf8 !== 'string') continue;
      if (seg.utf8.trim() && Number.isFinite(seg.tOffsetMs) && seg.tOffsetMs >= 0) {
        timed.push({ from: raw.length, to: raw.length + seg.utf8.length, time: start + seg.tOffsetMs });
      }
      raw += seg.utf8;
    }
    let text = '', lastOff = start, nextTimed = 0;
    const anchors: NonNullable<SourceFragment['anchors']> = [];
    const speakerBreaks: number[] = [];
    for (const match of raw.matchAll(/(^|\s)>{2,}\s*|\S+|\s/g)) {
      if (match[1] !== undefined) {
        if (match[1] && text && !text.endsWith(' ')) text += ' ';
        pendingSpeaker = true;
        continue;
      }
      const token = match[0];
      if (!token.trim()) {
        if (text && !text.endsWith(' ')) text += ' ';
        continue;
      }
      if (pendingSpeaker) { speakerBreaks.push(text.length); pendingSpeaker = false; }
      const from = match.index, to = from + token.length;
      while (nextTimed < timed.length && timed[nextTimed]!.from < to) {
        const word = timed[nextTimed++]!;
        if (word.to <= from) continue;
        lastOff = word.time;
        anchors.push({ offset: text.length + Math.max(0, word.from - from), time: word.time });
      }
      text += token;
    }
    text = text.trimEnd();
    if (!text) continue;
    cues.push({ start, dur, text, lastOff,
      ...(anchors.length && { anchors }),
      ...(speakerBreaks.length && { speakerBreaks }),
      ...(Number.isInteger(ev.wWinId) && { windowId: ev.wWinId }),
    });
  }
  return cues;
}

export function buildSubtitleViews(rawCues: SourceFragment[], kind: 'manual' | 'asr', lang: string): SubtitleViews {
  const fragments = kind === 'asr' ? normalizeAsrCues(rawCues) :
    rawCues.map((cue, i) => ({ ...cue, firstEvent: i, lastEvent: i }));
  const separator = /^(zh|ja)(-|$)/i.test(lang) ? '' : ' ';
  const spans: { from: number; to: number }[] = [];
  const speakerBreaks: number[] = [];
  let offset = 0;
  for (const fragment of fragments) {
    const from = offset;
    const to = from + fragment.text.length;
    spans.push({ from, to });
    for (const boundary of fragment.speakerBreaks ?? []) speakerBreaks.push(from + boundary);
    offset = to + separator.length;
  }
  const text = fragments.map(fragment => fragment.text).join(separator);
  const segmenter = new Intl.Segmenter(lang || undefined, { granularity: 'sentence' });
  const cues: LearningCue[] = [];
  let firstFragment = 0;
  const trimRange = (from: number, to: number) => {
    const part = text.slice(from, to);
    return [from + part.length - part.trimStart().length, from + part.trimEnd().length] as const;
  };
  function add(from: number, to: number) {
    while (spans[firstFragment]!.to <= from) firstFragment++;
    let lastFragment = firstFragment;
    while (spans[lastFragment]!.to < to) lastFragment++;
    cues.push({ text: text.slice(from, to), from, to, firstFragment, lastFragment,
      firstOffset: from - spans[firstFragment]!.from, lastOffset: to - spans[lastFragment]!.from,
      interval: -1, start: 0, dur: 0, lastOff: 0,
    });
  }
  let runStart = 0;
  for (const runEnd of [...speakerBreaks, text.length]) {
    if (runStart >= runEnd) continue;
    const run = text.slice(runStart, runEnd);
    let pending = runStart;
    for (const part of segmenter.segment(run)) {
      const suffix = part.segment.trimEnd();
      const end = part.index + suffix.length;
      const next = part.index + part.segment.length;
      if (!/[.!?。！？]["'”’»」』）)\]]*$/.test(suffix)) continue;
      if (/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr)\.["'”’]*$/i.test(suffix)) continue;
      if (/\d\.$/.test(suffix) && /\d/.test(run[next] ?? '')) continue;
      if (/\b[A-Za-z]\.$/.test(suffix) && /^[A-Za-z]\./.test(run.slice(next, next + 2))) continue;
      const [from, to] = trimRange(pending, runStart + end);
      add(from, to);
      pending = runStart + end;
    }
    const [from, to] = trimRange(pending, runEnd);
    let tail = from;
    while (tail < to) {
      while (spans[firstFragment]!.to <= tail) firstFragment++;
      const end = Math.min(to, spans[firstFragment]!.to);
      add(tail, end);
      tail = Math.max(end, spans[firstFragment + 1]?.from ?? end);
    }
    runStart = runEnd;
  }
  return { cues, fragments, intervals: buildPlaybackIntervals(cues, fragments) };
}

function buildPlaybackIntervals(cues: LearningCue[], fragments: SourceFragment[]): PlaybackInterval[] {
  const intervals: PlaybackInterval[] = [];
  cues.forEach((cue, i) => {
    const fragment = fragments[cue.firstFragment]!;
    const last = fragments[cue.lastFragment]!;
    const previous = intervals.at(-1);
    const anchor = cue.firstOffset === 0 ? fragment.start :
      fragment.anchors?.find(a => a.offset === cue.firstOffset && a.time >= fragment.start && a.time < fragment.start + fragment.dur)?.time;
    if (!previous || (anchor !== undefined && anchor > previous.start)) {
      const start = anchor ?? fragment.start;
      if (previous) previous.dur = Math.min(previous.dur, start - previous.start);
      intervals.push({ start, dur: last.start + last.dur - start, firstCue: i, lastFragment: cue.lastFragment });
    } else {
      previous.dur = last.start + last.dur - previous.start;
      previous.lastFragment = cue.lastFragment;
    }
    cue.interval = intervals.length - 1;
  });
  for (const cue of cues) {
    const interval = intervals[cue.interval]!;
    cue.start = interval.start;
    cue.dur = interval.dur;
    cue.lastOff = fragments[cue.lastFragment]!.lastOff;
  }
  return intervals;
}

/** 仅复用同源、唯一且完整的事件译文。独立译文轨道只用于播放器。 */
export function alignLearningTranslations({ cues, fragments }: SubtitleViews, translated: Cue[], raw: Cue[] = fragments): Cue[] {
  const key = (cue: Cue) => `${cue.start}:${cue.dur}`;
  const byTime = new Map<string, string | undefined>();
  for (const cue of translated) {
    const time = key(cue);
    byTime.set(time, byTime.has(time) ? undefined : cue.text);
  }
  const sourceCounts = new Map<string, number>();
  for (const fragment of raw) {
    const time = key(fragment);
    sourceCounts.set(time, (sourceCounts.get(time) ?? 0) + 1);
  }
  return cues.map(cue => {
    if (cue.firstOffset !== 0 || cue.lastOffset !== fragments[cue.lastFragment]!.text.length) return cue;
    const parts = fragments.slice(cue.firstFragment, cue.lastFragment + 1).map(fragment =>
      fragment.firstEvent !== fragment.lastEvent || sourceCounts.get(key(fragment)) !== 1 ? undefined : byTime.get(key(fragment)));
    return parts.every(Boolean) ? { ...cue, zh: parts.join(' ') } : cue;
  });
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

/** 同一窗口的重叠前缀可视为滚动更新。已有词段时间优先区分再次实读。 */
export function normalizeAsrCues(cues: SourceFragment[]): SubtitleFragment[] {
  const out: SubtitleFragment[] = [];
  for (const [index, cue] of cues.entries()) {
    const prev = out.at(-1);
    const sameWindow = prev && prev.windowId === cue.windowId && !cue.speakerBreaks?.length;
    const overlaps = prev && cue.start < prev.start + prev.dur;
    const suffix = prev ? cue.text.slice(prev.text.length) : '';
    const extendsText = prev && cue.text.startsWith(prev.text) &&
      (!suffix || /^[\s\p{P}]/u.test(suffix) || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(prev.text));
    if (!sameWindow || !overlaps || !extendsText) {
      out.push({ ...cue, firstEvent: index, lastEvent: index });
      continue;
    }
    const origin = prev.anchors?.[0];
    const matchingOffset = origin && cue.anchors?.find(a => a.offset === origin.offset);
    if (origin && matchingOffset ? matchingOffset.time === origin.time : suffix || cue.start === prev.start) {
      const end = Math.max(prev.start + prev.dur, cue.start + cue.dur);
      const anchors = [...prev.anchors ?? [], ...(cue.anchors ?? []).filter(a => a.offset >= prev.text.length)];
      out[out.length - 1] = { ...prev, dur: end - prev.start, text: cue.text,
        lastOff: Math.max(prev.lastOff, cue.lastOff), zh: cue.zh ?? prev.zh, lastEvent: index, ...(anchors.length && { anchors }) };
    } else out.push({ ...cue, firstEvent: index, lastEvent: index });
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
export function cueIndexAt(cues: Pick<Cue, 'start' | 'dur'>[], tMs: number): number {
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
