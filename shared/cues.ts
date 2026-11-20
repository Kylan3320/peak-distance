// MAIN 与隔离世界共用的字幕解析、表示、定位和翻译纯逻辑。

import type { Cue, LearningCue, SourceFragment, SubtitleFragment, SubtitleViews } from './protocol';
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
export const DISPLAY_CUE_VERSION = 8;

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

/** Mark a gap only between consecutive words with measured onsets. */
export function blockPauseOffsets(block: SourceFragment, lang: string): number[] {
  if (!block.anchors || block.anchors.length < 2) return [];
  const times = new Map(block.anchors.map(point => [point.offset, point.time]));
  const offsets: number[] = [];
  let previous: number | undefined;
  for (const word of segmentWords(block.text, lang)) {
    const time = times.get(word.start);
    if (time !== undefined && previous !== undefined && time - previous > 1500) offsets.push(word.start);
    previous = time;
  }
  return offsets;
}

/** A word-timed track may leave a rolling caption window open after speech. */
export function blockTextEnd(block: SourceFragment, lang: string): number {
  const end = block.start + block.dur;
  const anchor = block.anchors?.at(-1);
  if (!anchor || anchor.time < block.start || anchor.time + 1300 >= end) return end;
  const finalWord = segmentWords(block.text, lang).at(-1);
  return finalWord?.start === anchor.offset ? anchor.time + 1300 : end;
}

export function buildSubtitleViews(rawCues: SourceFragment[], kind: 'manual' | 'asr', lang: string): SubtitleViews {
  const fragments = kind === 'asr' ? normalizeAsrCues(rawCues) :
    rawCues.map((cue, i) => ({ ...cue, firstEvent: i, lastEvent: i }));
  return readingViews(rawCues, fragments, kind, lang);
}

export async function buildSegmentedSubtitleViews(raw: SourceFragment[], kind: 'manual' | 'asr', lang: string,
  predict: (passages: string[]) => Promise<string[]>): Promise<SubtitleViews & {segmentationFallback?: boolean}> {
  const fragments = kind === 'asr' ? normalizeAsrCues(raw) :
    raw.map((cue, index) => ({ ...cue, firstEvent: index, lastEvent: index }));
  const passages = new Set<string>();
  const baseline = readingViews(raw, fragments, kind, lang, text => { passages.add(text); return undefined; });
  if (!passages.size) return baseline;
  const inputs = [...passages];
  const outputs = await predict(inputs);
  if (outputs.length !== inputs.length) return {...baseline, segmentationFallback: true};
  const predictions = new Map(inputs.map((input, i) => [input, outputs[i]]));
  let incomplete = false;
  const views = readingViews(raw, fragments, kind, lang, text => predictions.get(text), () => { incomplete = true; });
  return incomplete ? {...views, segmentationFallback: true} : views;
}

// Examine soft punctuation only in long English ASR sentences. A comma can
// introduce an aside, a list item, a reason, or a new assertion. Accept a
// narrow set of positive clause shapes; ambiguity keeps the translation together.
function independentThought(left: string, right: string): boolean {
  // Ignore parenthetical asides when looking for the main assertion, but
  // retain a trailing comma: "I, along with the whole team," has no predicate.
  const main = (clause: string) => clause.replace(/,\s*[^,]+,\s+(?=\S)/g, ' ');
  const freeRelative = /^what\s+(?:i|we|you|he|she|they)(?:['’]\w+)?\s+[a-z]+\b[^,;.!?]*?\s+(?:is|was|are|were)\s+\S/i;
  const start = main(left).replace(/^(?:and|but|so|yet)\s+/i, '');
  // "This particular morning, and I ... , was ..." is a subject with an
  // intervening aside. A demonstrative + modifier is not a completed clause.
  const personal = /^(?:i|we|you|he|she|it|they)(?:['’](?:m|re|ve|ll|d|s)\b|\s+(?!(?:and|or|along|with|together|like|of|in|as)\b)[a-z]+\b)|^(?:this|that)(?:['’]s|\s+(?:is|was|has|had|can|will|did|does))\b/i;
  if (!personal.test(start) && !freeRelative.test(start)) return false;
  if (/\b(?:is|are|was|were|be|been|the|a|an|to|and|or|but|that|whether|as|because|although|except)[,;]$/i.test(left)) return false;
  if (/\b(?:whether|unless|until|if|either|neither|not only|not just)\b/i.test(left)) return false;
  // A standalone-looking "what ..." clause can still be the object of the
  // first verb. Split only an explicit contrast with a completed negative
  // assertion using the same subject and verb ("we didn't see X; what we did see ...").
  if (/^what\b/i.test(right)) {
    const contrast = /^what\s+(i|we|you|he|she|they)\s+(?:do|does|did)\s+([a-z]+)\b/i.exec(right);
    if (!contrast || !freeRelative.test(main(right))) return false;
    const negative = new RegExp(`\\b${contrast[1]}\\s+(?:do|does|did)(?:n['’]t|\\s+not)\\s+${contrast[2]}\\s+\\w`, 'i');
    return negative.test(left);
  }
  if (/\b(?:because|although|while|when|that)\s+/i.test(left)) return false;
  const coordinated = right.replace(/^(and|but|yet)\s+(i|we|you|he|she|it|they),\s+/i, '$1 $2 ');
  return /^(?:and|but|yet)\s+(?:(?:and|but)\s+)?(?:i|we|you|he|she|it|they|that|this)(?:['’](?:m|re|ve|ll|d|s)\b|\s+(?:am|are|is|was|were|have|has|had|do|does|did|can|could|will|would|should|must)\b|\s+(?:think|believe|feel|know)\s+(?:it|we|they|i|you)\b)/i.test(coordinated);
}

/** Predicted punctuation sometimes detaches a subject or the predicate of
 * a gerund: "I think going down the hill. A little faster helps my balance." */
function incompletePrediction(left: string, following: string): boolean {
  const plain = left.toLowerCase().replace(/[.,!?;:]/g,'').trim();
  if (/^(?:and |but )?(i|you|we|they|she|he|it|that)(?: \1)*$/.test(plain) ||
      /\b(?:a|an|the)$/.test(plain)) return true;
  const reportedSubject = /^(?:(?:and|but) )?(?:i|we|they|you) (?:think|believe|feel) (?:\w+ly )?\w+ing\b(.*)$/.exec(plain);
  if (!reportedSubject || /\b(?:\w+s|is|was|can|could|will|would|should|must|does|did)\s+(?:my|your|their|our|his|her|me|us|him|them|the|a|an|it)\b/.test(reportedSubject[1]!)) return false;
  // Require an adverbial modifier followed by its predicate. A comparative
  // adjective can instead start a new subject ("Faster runs can help ...").
  return /^(?:a (?:bit|little) (?:more|less|further|farther|faster|slower|longer)|(?:more|less) \w+ly)\s+(?:\w+s\s+(?:me|us|my|our|your|the|a|an|it|them)|(?:can|will|would)\s+[a-z]+)\b/i.test(following);
}

/** Restore only source offsets. Predicted casing and punctuation never replace the transcript. */
function predictedEnds(source: string, prediction: string, refineLongAsr: boolean): number[] | null {
  const words = [...source.matchAll(/\S+/gu)];
  const out = prediction.trim().split(/\s+/u);
  if (words.length !== out.length) return null;
  const ends: number[] = [];
  const normalize = (word: string) => word.toLowerCase().replace(/[.,!?;:]+$/u, '');
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const {0: word, index} = words[i]!;
    if (normalize(word) !== normalize(out[i]!)) return null;
    const terminal = /[.!?]$/u.test(out[i]!) && !/^(?:mr|mrs|ms|dr|prof|sr|jr)\.?$/i.test(word);
    if (!terminal && i !== words.length-1) continue;
    if (terminal && refineLongAsr && prediction !== source && i + 1 < words.length &&
        incompletePrediction(out.slice(start,i+1).join(' '),out.slice(i+1,i+10).join(' '))) continue;
    // Length only opens the search. It never determines where to cut.
    if (refineLongAsr && i-start+1 > 24) {
      for (let j = start; j < i; j++) {
        const delayedComma = /^(and|but|yet)$/i.test(out[j+1]!) && /^(i|we|you|he|she|it|they),$/i.test(out[j+2] ?? '');
        if ((!/[,;]$/u.test(out[j]!) && !delayedComma) || j-start < 3 || i-j < 4) continue;
        const left = out.slice(start,j+1).join(' ');
        const right = out.slice(j+1,i+1).join(' ');
        if (!independentThought(left,right)) continue;
        ends.push(words[j]!.index + words[j]![0].length);
        start = j+1;
      }
    }
    ends.push(index + word.length);
    start = i+1;
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

function readingViews(blocks: SourceFragment[], fragments: SubtitleFragment[], kind: 'manual' | 'asr', lang: string, prediction?: (text: string) => string | undefined,
  markUnaligned?: () => void): SubtitleViews {
  const english = /^en(?:-|$)/i.test(lang);
  const separator = /^(zh|ja)(-|$)/i.test(lang) ? '' : ' ';
  const spans: { from: number; to: number }[] = [];
  const blockRanges: SubtitleViews['blockRanges'] = [];
  const speakerBreaks: number[] = [];
  let offset = 0;
  for (const fragment of fragments) {
    const from = offset;
    const to = from + fragment.text.length;
    spans.push({ from, to });
    // Every rolling update repeats a prefix at the same text position. Only
    // its own source event may reveal the longer text in the player.
    for (let i = fragment.firstEvent; i <= fragment.lastEvent; i++) {
      blockRanges.push({ from, to: from + blocks[i]!.text.length });
    }
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
    let firstBlock = fragments[firstFragment]!.firstEvent;
    while (blockRanges[firstBlock]!.to <= from) firstBlock++;
    const start = blocks[firstBlock]!.start;
    const last = fragments[lastFragment]!;
    cues.push({ text: text.slice(from, to), from, to, firstFragment, lastFragment,
      firstOffset: from - spans[firstFragment]!.from, lastOffset: to - spans[lastFragment]!.from,
      start, dur: last.start + last.dur - start, lastOff: last.lastOff,
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
    const punctuatedAsr = !predict && english && kind === 'asr' && /[,;]/.test(source);
    const ends = result ? predictedEnds(source, result, kind === 'asr') :
      punctuatedAsr ? predictedEnds(source, source, true) : null;
    if (predict && !ends) markUnaligned?.();
    if (!ends && uncertain) {
      provisionalTail = Boolean(predict && prediction);
      return false;
    }
    let begin = from;
    for (const end of ends ?? [to-from]) {
      const [left, right] = trimRange(begin, from + end);
      if (left < right) {
        add(left, right);
        if (predict && prediction && !ends) cues[cues.length - 1]!.segmentationFallback = true;
      }
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
  return { cues, fragments, blocks, blockRanges };
}

/** Pair platform translations with unique raw events. The player decides
 * whether a part covers this exact event after display units are known. */
export function alignBlockTranslations(raw: Cue[], translated: Cue[]): Cue[] {
  const key = (cue: Cue) => `${cue.start}:${cue.dur}`;
  const byTime = new Map<string,string | undefined>();
  for (const cue of translated) {
    const id = key(cue);
    byTime.set(id,byTime.has(id) ? undefined : cue.text);
  }
  const seen = new Set<string>(), duplicate = new Set<string>();
  for (const cue of raw) {
    const id = key(cue);
    if (seen.has(id)) duplicate.add(id);
    seen.add(id);
  }
  return raw.map(cue => {
    const id = key(cue);
    const zh = !duplicate.has(id) && byTime.get(id);
    return zh ? {...cue, zh} : cue;
  });
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
