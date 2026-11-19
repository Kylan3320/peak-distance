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
export const DISPLAY_CUE_VERSION = 5;

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
  return readingViews(fragments, kind, lang);
}

export async function buildSegmentedSubtitleViews(raw: SourceFragment[], kind: 'manual' | 'asr', lang: string,
  predict: (passages: string[]) => Promise<string[]>): Promise<SubtitleViews & {segmentationFallback?: boolean}> {
  const fragments = kind === 'asr' ? normalizeAsrCues(raw) :
    raw.map((cue, index) => ({ ...cue, firstEvent: index, lastEvent: index }));
  const passages = new Set<string>();
  const baseline = readingViews(fragments, kind, lang, text => { passages.add(text); return undefined; });
  if (!passages.size) return baseline;
  const inputs = [...passages];
  const outputs = await predict(inputs);
  if (outputs.length !== inputs.length) return {...baseline, segmentationFallback: true};
  const predictions = new Map(inputs.map((input, i) => [input, outputs[i]]));
  let incomplete = false;
  const views = readingViews(fragments, kind, lang, text => predictions.get(text), () => { incomplete = true; });
  return incomplete ? {...views, segmentationFallback: true} : views;
}

/** Restore only source offsets. Predicted casing and punctuation never replace the transcript. */
function predictedEnds(source: string, prediction: string): number[] | null {
  const words = [...source.matchAll(/\S+/gu)];
  const out = prediction.trim().split(/\s+/u);
  if (words.length !== out.length) return null;
  const ends: number[] = [];
  const normalize = (word: string) => word.toLowerCase().replace(/[.,!?;:]+$/u, '');
  for (let i = 0; i < words.length; i++) {
    const {0: word, index} = words[i]!;
    if (normalize(word) !== normalize(out[i]!)) return null;
    if (/[.!?]$/u.test(out[i]!) && !/^(?:mr|mrs|ms|dr|prof|sr|jr)\.?$/i.test(word)) ends.push(index + word.length);
  }
  if (ends.at(-1) !== source.length) ends.push(source.length);
  return ends;
}

/** Some English tracks retain sentence punctuation but lose capitalization.
 * Give ICU an equal-length casing hint after an ordinary terminal word. The
 * original text supplies every offset and every displayed character. */
function englishSentenceProbe(run: string): string {
  let followsTerminal = false;
  return run.replace(/\S+/gu, token => {
    const probe = followsTerminal && /^[a-z]/.test(token) ? token[0]!.toUpperCase() + token.slice(1) : token;
    // Initials, dotted acronyms, decimals, ellipses and other ambiguous
    // tokens keep the segmenter's conservative lowercase rule.
    const terminal = /^[\p{Ps}\p{Pi}"']*([a-z]{2,}(?:['’-][a-z]+)*)\.[\p{Pe}\p{Pf}"']*$/iu.exec(token);
    followsTerminal = !!terminal &&
      !/^(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|fig|dept|approx|inc|ltd|corp)$/i.test(terminal[1]!);
    return probe;
  });
}

function readingViews(fragments: SubtitleFragment[], kind: 'manual' | 'asr', lang: string, prediction?: (text: string) => string | undefined,
  markUnaligned?: () => void): SubtitleViews {
  const english = /^en(?:-|$)/i.test(lang);
  const separator = /^(zh|ja)(-|$)/i.test(lang) ? '' : ' ';
  const spans: { from: number; to: number }[] = [];
  const speakerBreaks: number[] = [];
  let offset = 0;
  for (const fragment of fragments) {
    const from = offset;
    const to = from + fragment.text.length;
    spans.push({ from, to });
    for (const boundary of fragment.speakerBreaks ?? []) speakerBreaks.push(from + boundary);
    if (/^\[[^\[\]]{1,64}\]$/u.test(fragment.text)) speakerBreaks.push(from, to);
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
  let provisionalTail = false;
  function emit(from: number, to: number, uncertain: boolean): boolean {
    const source = text.slice(from, to);
    // A verified sentence keeps its complete translation context even when
    // it needs several display lines. Length alone is not a missing boundary.
    // ASR sometimes attaches just one final mark to a whole lower-case passage.
    const sparseAsr = english && kind === 'asr' && /^[a-z]/.test(source) &&
      !/[,;:—!?]/u.test(source.slice(0, -1)) && source.split(/\s+/u).length > 38;
    const predict = english && (uncertain || sparseAsr) && /\s/u.test(source) && !/^\[[^\]]+\]$/u.test(source);
    const result = predict ? prediction?.(source) : undefined;
    const ends = typeof result === 'string' && result ? predictedEnds(source, result) : null;
    if (predict && !ends) markUnaligned?.();
    if (!ends && uncertain) {
      provisionalTail = Boolean(predict && prediction);
      return false;
    }
    let begin = from;
    for (const end of ends ?? [to-from]) {
      const [left, right] = trimRange(begin, from + end);
      if (left < right) add(left, right);
      begin = from + end;
    }
    return true;
  }
  let runStart = 0;
  for (const runEnd of [...speakerBreaks, text.length]) {
    if (runStart >= runEnd) continue;
    const run = text.slice(runStart, runEnd);
    let pending = runStart;
    const probe = english ? englishSentenceProbe(run) : run;
    for (const part of segmenter.segment(probe)) {
      const suffix = run.slice(part.index, part.index + part.segment.length).trimEnd();
      const end = part.index + suffix.length;
      const next = part.index + part.segment.length;
      if (!/\p{Sentence_Terminal}[\p{Pe}\p{Pf}"']*$/u.test(suffix)) continue;
      if (/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr)\.["'”’]*$/i.test(suffix)) continue;
      if (/\d\.$/.test(suffix) && /\d/.test(run[next] ?? '')) continue;
      if (/\b[A-Za-z]\.$/.test(suffix) && /^[A-Za-z]\./.test(run.slice(next, next + 2))) continue;
      const [from, to] = trimRange(pending, runStart + end);
      emit(from, to, false);
      pending = runStart + end;
    }
    const [from, to] = trimRange(pending, runEnd);
    let tail = from < to && emit(from, to, true) ? to : from;
    while (tail < to) {
      while (spans[firstFragment]!.to <= tail) firstFragment++;
      const end = Math.min(to, spans[firstFragment]!.to);
      add(tail, end);
      if (provisionalTail) cues[cues.length-1]!.segmentationFallback = true;
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
    const wordStart = fragment.anchors?.find(a => a.offset === cue.firstOffset && a.time >= fragment.start && a.time < fragment.start + fragment.dur)?.time;
    const newFragment = previous && cues[previous.firstCue]!.firstFragment !== cue.firstFragment;
    const anchor = cue.firstOffset === 0 ? fragment.start : wordStart ?? (newFragment ? fragment.start : undefined);
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

/** 仅复用与学习项一一对应的完整同源事件译文。 */
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
    const fragment = fragments[cue.firstFragment]!;
    if (cue.firstFragment !== cue.lastFragment || cue.firstOffset !== 0 ||
      cue.lastOffset !== fragment.text.length || fragment.firstEvent !== fragment.lastEvent) return cue;
    const time = key(fragment);
    const zh = sourceCounts.get(time) === 1 ? byTime.get(time) : undefined;
    return zh ? { ...cue, zh } : cue;
  });
}

/** 同批中的相同学习句只提交一次，响应回填到每个所属行。 */
export function buildCueTranslationBatch(cues: Cue[], orderedIndices: Iterable<number>, limit: number) {
  const items: { id: number; text: string }[] = [];
  const targets: { index: number; id: number }[] = [];
  const byText = new Map<string, number>();
  for (const index of orderedIndices) {
    const text = cues[index]!.text;
    let id = byText.get(text);
    if (id === undefined) {
      if (items.length >= limit) continue;
      id = index;
      byText.set(text, id);
      items.push({ id, text });
    }
    targets.push({ index, id });
  }
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

/** 毫秒 → m:ss / h:mm:ss（字幕栏与侧栏显示用）。 */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (x: number) => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}
