import { blockTextEnd } from './cues';
import type { Cue, LearningCue, SourceFragment } from './protocol';
import { segmentWords } from './tokenize';

export interface SubtitlePart {
  from: number;
  to: number;
  text: string;
  unitText: string;
  start: number;
  dur: number;
  budget: number;
  blockIndex: number;
  unitIndex: number;
}

export interface DisplayUnit {
  from: number;
  to: number;
  text: string;
  start: number;
  dur: number;
  parts: {cue: number; part: number}[];
}

const MIN_WORDS = 2;
const MIN_DURATION_MS = 800;
const LONG_PAUSE_MS = 1500;
const LONG_DURATION_MS = 6000;
const LONG_WORDS = 18;
const graphemes = new Intl.Segmenter(undefined, {granularity:'grapheme'});

export function lineLength(text: string, _targetLang?: string): number {
  let length = 0;
  for (const {segment} of graphemes.segment(text)) if (segment.trim()) length++;
  return length;
}

export function readingBudget(durMs: number, targetLang: string): number {
  const cjk = /^(zh|ja|ko)(-|$)/i.test(targetLang);
  return Math.max(1,Math.min(cjk ? 32 : 72, Math.floor(durMs * (cjk ? 9 : 18) / 1000)));
}

export function joinSubtitleLines(lines: readonly string[], targetLang: string): string {
  return lines.join(/^(zh|ja)(-|$)/i.test(targetLang) ? '' : ' ');
}

interface TextRange { from: number; to: number }

// The semantic transcript can contain several thousand sentences; rolled
// prefixes mean consecutive display ranges need not start farther to the right.
function firstOverlap(ranges: readonly TextRange[], from: number): number {
  let lo = 0, hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ranges[mid]!.to <= from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Cut {
  word: number;
  offset: number;
  time: number;
  priority: number;
}

function splitBlock(block: SourceFragment, base: number, end: number, starts: Set<number>, lang: string): DisplayUnit[] {
  const makeUnit = (left: number, right: number, start: number, stop: number): DisplayUnit => {
    const text = block.text.slice(left, right).trimEnd();
    return {from:base + left, to:base + left + text.length, text, start, dur:Math.max(0,stop-start), parts:[]};
  };
  if (!block.anchors?.length) return [makeUnit(0,block.text.length,block.start,end)];
  const words = segmentWords(block.text,lang);
  const onsets = new Map(block.anchors.filter(a => a.time >= block.start && a.time < block.start + block.dur)
    .map(a => [a.offset, a.time]));
  // Opening quotes and brackets belong to the following word. JSON3 may
  // position the same measured onset on the opening mark or on the letter.
  const wordStarts = words.map((word,i) => {
    const before = block.text.slice(i ? words[i-1]!.end : 0,word.start);
    const opening = /[\p{Ps}\p{Pi}"']+$/u.exec(before);
    const offset = word.start - (opening?.[0].length ?? 0);
    return {offset, time:onsets.get(word.start) ?? onsets.get(offset)};
  });
  const start = wordStarts[0]?.time ?? block.start;
  const head = {word:0, offset:0, time:start, priority:0};
  const tail = {word:words.length, offset:block.text.length, time:end, priority:0};
  const candidates: Cut[] = [];
  let lastTime = start;
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!, prev = words[i-1]!;
    const {offset,time} = wordStarts[i]!;
    if (time === undefined || time <= lastTime || time >= end) continue;
    lastTime = time;
    const between = block.text.slice(prev.end,word.start);
    const prevTime = wordStarts[i-1]!.time;
    const pause = prevTime !== undefined && time - prevTime > LONG_PAUSE_MS;
    const terminal = /\p{Sentence_Terminal}/u.test(between) &&
      !/^(?:mr|mrs|ms|dr|prof|sr|jr|st|vs)$/iu.test(prev.text);
    const priority = starts.has(base + offset) ? 0 : terminal ? 1 :
      /[,;，；、]/u.test(between) || pause ? 2 : 3;
    candidates.push({word:i, offset, time, priority});
  }
  const cuts = [head,tail];
  // Among equally useful boundaries prefer a balanced interval. A word's
  // true onset is used even when speech speeds up or slows down.
  function choose(left: Cut, right: Cut, first: number, last: number) {
    const long = right.time-left.time > LONG_DURATION_MS || right.word-left.word > LONG_WORDS;
    let best = -1, bestRank = Infinity, nearest = Infinity;
    for (let i=first; i<last; i++) {
      const cut = candidates[i]!;
      if (cut.priority === 3 && !long || cut.priority > bestRank) continue;
      if (cut.word-left.word < MIN_WORDS || right.word-cut.word < MIN_WORDS ||
        cut.time-left.time < MIN_DURATION_MS || right.time-cut.time < MIN_DURATION_MS) continue;
      const distance = Math.abs(cut.time - (left.time+right.time)/2);
      if (cut.priority < bestRank || distance < nearest) {
        best = i; bestRank = cut.priority; nearest = distance;
      }
    }
    if (best < 0) return;
    const cut = candidates[best]!;
    cuts.push(cut);
    choose(left,cut,first,best);
    choose(cut,right,best+1,last);
  }
  choose(head,tail,0,candidates.length);
  cuts.sort((a,b) => a.offset-b.offset);
  return cuts.slice(0,-1).map((cut,i) => makeUnit(cut.offset,cuts[i+1]!.offset,cut.time,cuts[i+1]!.time));
}

export function buildSubtitleUnits(blocks: SourceFragment[], blockRanges: TextRange[], cues: LearningCue[],
  sourceLang: string, targetLang: string, frozenUnits?: ReadonlyMap<number,readonly DisplayUnit[]>):
  {unitsByBlock: DisplayUnit[][]; partsByCue: SubtitlePart[][]} {
  const starts = new Set(cues.map(cue => cue.from));
  const unitsByBlock = blocks.map((block,i) => {
    const base = blockRanges[i]?.from ?? 0;
    // A plan already shown before inference has block-local coordinates.
    // Preserve its measured cuts, attach the final sentence references below.
    const shown = frozenUnits?.get(i);
    if (shown) return shown.map((u): DisplayUnit => ({...u, from:base+u.from, to:base+u.to, parts:[]}));
    return splitBlock(block,base,Math.min(blockTextEnd(block,sourceLang),blocks[i+1]?.start ?? Infinity),starts,sourceLang);
  });
  const boundaries = cues.map(() => new Set<number>());
  function intersections(unit: DisplayUnit, visit: (index:number, from:number, to:number)=>void) {
    for (let i=firstOverlap(cues,unit.from); i<cues.length && cues[i]!.from < unit.to; i++) {
      const cue = cues[i]!;
      visit(i,Math.max(unit.from,cue.from),Math.min(unit.to,cue.to));
    }
  }
  for (const units of unitsByBlock) for (const unit of units) {
    intersections(unit,(i,from,to) => { boundaries[i]!.add(from).add(to); });
  }
  // A rolling caption can show "I know" and then "I know why". Split the
  // semantic text at both range edges so the sidebar keeps each word once.
  const partsByCue: SubtitlePart[][] = cues.map((cue,i) => {
    const edges = [...boundaries[i]!].sort((a,b) => a-b);
    const parts: SubtitlePart[] = [];
    for (let n=1; n<edges.length; n++) {
      const raw = cue.text.slice(edges[n-1]!-cue.from,edges[n]!-cue.from);
      const text = raw.trim();
      if (!text) continue;
      const from = edges[n-1]! + raw.length - raw.trimStart().length;
      parts.push({from,to:from+text.length,text,unitText:'',start:0,dur:0,blockIndex:-1,unitIndex:-1,budget:Infinity});
    }
    return parts;
  });
  unitsByBlock.forEach((units,blockIndex) => units.forEach((unit,unitIndex) => {
    intersections(unit,(cue,from,to) => {
      const parts = partsByCue[cue]!;
      for (let p=firstOverlap(parts,from); p<parts.length && parts[p]!.from<to; p++) {
        const part = parts[p]!;
        if (part.blockIndex < 0 || part.dur === 0 && unit.dur > 0) {
          part.blockIndex = blockIndex; part.unitIndex = unitIndex; part.start = unit.start; part.dur = unit.dur;
          part.unitText = unit.text;
        }
        unit.parts.push({cue, part:p});
      }
    });
    if (unit.dur === 0) return;
    const budget = readingBudget(unit.dur,targetLang);
    const count = unit.parts.length;
    unit.parts.forEach(({cue,part},i) => {
      const record = partsByCue[cue]![part]!;
      // A reused line must fit every screen on which it appears.
      record.budget = Math.min(record.budget,Math.floor(budget/count) + (i < budget%count ? 1 : 0));
    });
  }));
  // A simultaneous manual event can be completely superseded by its
  // successor. Retain its text in the request with no readable time instead
  // of returning a seemingly successful partial translation of the sentence.
  for (const parts of partsByCue) for (const part of parts) {
    if (part.dur === 0) part.budget = 0;
  }
  return {unitsByBlock,partsByCue};
}

/** An entire unique bilingual event may supply one line; a time overlap or
 * a sentence intersection with only part of the event is insufficient. */
export function platformLineForPart(part: SubtitlePart, blocks: SourceFragment[], translations: Cue[]): string | undefined {
  const block = blocks[part.blockIndex];
  const translated = translations[part.blockIndex];
  if (!block || !translated || part.text !== block.text || part.start !== block.start || part.dur !== block.dur ||
    translated.start !== block.start || translated.dur !== block.dur || translated.text !== block.text) return;
  return translated.zh;
}
