import type { LearningCue, SubtitleFragment } from './protocol';
import { segmentWords } from './tokenize';

export interface SubtitlePage { text: string; start: number }

// This is a reading budget in approximate Latin character widths. It belongs
// to the player only: pages never become learning cues or translation jobs.
function readingWidth(text: string) {
  return text.length + (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0);
}

function pageOffsets(text: string, lang: string, count: number, onset?: (offset: number) => number) {
  const words = segmentWords(text,lang);
  const offsets = [0];
  for (let page = 1; page < count; page++) {
    const left = offsets.at(-1)!;
    const budget = readingWidth(text.slice(left)) / (count - page + 1);
    let best = -1, bestCost = Infinity;
    for (let i = 1; i < words.length; i++) {
      const next = words[i]!, prev = words[i-1]!;
      if (next.start <= left || words.length-i < count-page) continue;
      const width = readingWidth(text.slice(left,next.start));
      const deviation = Math.abs(width-budget)/budget;
      if (width > budget*1.55 && best >= 0) break;
      const separator = text.slice(prev.end,next.start);
      let cost = deviation;
      if (deviation < .52) {
        if (/[,.;:!?，。！？；：、—]/u.test(separator)) cost -= .75;
        if (onset) cost -= Math.min(.5,Math.max(0,onset(next.start)-onset(prev.start)-350)/1500);
        if (/^(?:and|but|because|especially|when|by|or)$/i.test(next.text)) cost -= .24;
        if (/^(?:the|a|an|my|to|and|by|in|or|is|that)$/i.test(prev.text)) cost += .48;
      }
      if (cost < bestCost) { bestCost = cost; best = next.start; }
    }
    if (best < 0) break;
    offsets.push(best);
  }
  return offsets;
}

export function playerPages(cue: LearningCue, screen: {start:number;dur:number}, fragments: SubtitleFragment[], lang: string): SubtitlePage[] {
  const width = readingWidth(cue.text);
  if (width <= 112 || screen.dur < 2500) return [{text:cue.text,start:screen.start}];
  const count = Math.min(Math.ceil(width/72), Math.max(1,Math.floor(screen.dur/1250)));
  const anchors = [{offset:0,time:screen.start}];
  const end = screen.start + screen.dur;
  function add(offset:number,time:number) {
    const last = anchors.at(-1)!;
    if (offset > last.offset && offset < cue.text.length && time > last.time && time < end) anchors.push({offset,time});
  }
  let offset = -cue.firstOffset;
  const joinWidth = /^(zh|ja)(-|$)/i.test(lang) ? 0 : 1;
  for (let i=cue.firstFragment; i<=cue.lastFragment; i++) {
    const fragment = fragments[i]!;
    add(offset,fragment.start);
    for (const anchor of fragment.anchors ?? []) add(offset+anchor.offset,anchor.time);
    offset += fragment.text.length + joinWidth;
  }
  anchors.push({offset:cue.text.length,time:end});
  function onset(at:number) {
    const right = anchors.findIndex(point => point.offset >= at);
    if (right <= 0) return screen.start;
    const a=anchors[right-1]!, b=anchors[right]!;
    return a.time+(b.time-a.time)*(at-a.offset)/(b.offset-a.offset);
  }
  const cuts = pageOffsets(cue.text,lang,count,onset);
  return cuts.map((at,i)=>({start:onset(at),text:cue.text.slice(at,cuts[i+1])}));
}

// Hints travel in the same full-sentence request. Each marker names the next
// display page; neither the reader nor learning records see the markers.
const markerSource = '⟦\\s*(\\d+)\\s*⟧';
export function pageTranslationInput(pages: SubtitlePage[]) {
  if (pages.some(p=>p.text.includes('⟦'))) return pages.map(p=>p.text).join('');
  return pages.map((p,i)=> (i ? ' ⟦'+i+'⟧ ' : '') + p.text.trim()).join('');
}

export function translatedPages(raw: string, pages: SubtitlePage[], lang: string, tagged: boolean) {
  if (pages.length < 2) return {text:raw, parts:[raw]};
  const markers = tagged ? [...raw.matchAll(new RegExp(markerSource,'gu'))] : [];
  if (markers.length === pages.length-1 && markers.every((m,i)=>Number(m[1])===i+1)) {
    const parts = pages.map((_,i)=>raw.slice(i ? markers[i-1]!.index+markers[i-1]![0].length : 0,markers[i]?.index));
    if (parts.every(part=>part.trim())) {
      const clean = parts.map(part=>part.trim());
      const joiner = /^(?:zh|ja)(?:-|$)/i.test(lang) ? '' : ' ';
      return {text:clean.join(joiner), parts:clean};
    }
  }
  // Platform translations and engines which discard page hints have only
  // sentence-level timing. Keep their own word order and prefer punctuation.
  const text = tagged ? raw.replace(new RegExp(markerSource,'gu'),'').trim() : raw;
  const offsets = pageOffsets(text,lang,pages.length);
  const parts = offsets.map((at,i)=>text.slice(at,offsets[i+1]));
  return {text, parts:pages.map((_,i)=>parts[Math.floor(i*parts.length/pages.length)]!)};
}
