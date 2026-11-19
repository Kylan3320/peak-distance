import assert from 'node:assert/strict';
import { playerPages, pageTranslationInput, translatedPages } from '../shared/subtitlePages';
import type { LearningCue, SubtitleFragment } from '../shared/protocol';

// Same comparison as the viewing report: one long learning cue and a short control.
const fragments = [
  [322960,"cuz I know one of the critiques I've had in my skiing"],
  [326120,'you know by examiners or or uh people a little bit more further in the PSA process than me'],
  [331759,'is that uh especially when speed happens or in a um high performance turn setting'],
  [337800,"I'll get kind of caught behind"],
] as const;
const track: SubtitleFragment[] = fragments.map(([start,text],i)=>({
  text,start,dur:(fragments[i+1]?.[0] ?? 341319)-start,lastOff:start,firstEvent:i,lastEvent:i,
}));
const text = track.map(f=>f.text).join(' ');
const cue: LearningCue = {text,start:322960,dur:18359,lastOff:340319,from:0,to:text.length,firstFragment:0,
  lastFragment:3,firstOffset:0,lastOffset:track[3]!.text.length,interval:0};
const pages = playerPages(cue,cue,track,'en');
assert.ok(pages.length > 1);
assert.equal(pages.map(p=>p.text).join(''),text);
assert.ok(pages.every((page,i)=>i===0 || page.start > pages[i-1]!.start));
assert.ok(!pages[0]!.text.includes('caught behind') && pages.at(-1)!.text.includes('caught behind'));
const input = pageTranslationInput(pages);
const result = translatedPages(input,pages,'en',true);
assert.equal(result.text,text);
assert.deepEqual(result.parts,pages.map(p=>p.text.trim()));
const short = {...cue,text:"we tend to teach what we're comfortable with"};
assert.deepEqual(playerPages(short,short,track,'en'),[{text:short.text,start:short.start}]);
console.log('Long cue paginates within one translation; short cue stays on one screen.');
