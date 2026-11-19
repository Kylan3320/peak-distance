import type { LearningCue, PlaybackInterval, SubtitleFragment } from './protocol';

/** Display times only. Saved ranges and auto-pause keep the track's real intervals. */
export function subtitleScreenTimes(cues: LearningCue[], intervals: PlaybackInterval[], fragments: SubtitleFragment[], lang: string) {
  const screens = cues.map(({ start, dur }) => ({ start, dur }));
  const separator = /^(zh|ja)(-|$)/i.test(lang) ? 0 : 1;
  intervals.forEach((interval, i) => {
    const first = interval.firstCue;
    const end = intervals[i + 1]?.firstCue ?? cues.length;
    if (end - first < 2) return;
    const head = cues[first]!;
    const tail = cues[end - 1]!;
    const limit = interval.start + interval.dur;
    const anchors = [{offset: head.from, time: interval.start}];
    const addAnchor = (offset: number, time: number) => {
      const last = anchors[anchors.length - 1]!;
      if (offset > last.offset && offset < tail.to && time > last.time && time < limit) anchors.push({offset, time});
    };
    let offset = head.from - head.firstOffset;
    for (let n = head.firstFragment; n <= tail.lastFragment; n++) {
      const fragment = fragments[n]!;
      addAnchor(offset, fragment.start);
      for (const anchor of fragment.anchors ?? []) addAnchor(offset + anchor.offset, anchor.time);
      offset += fragment.text.length + separator;
    }
    anchors.push({offset: tail.to, time: limit});
    let left = 0;
    for (let n = first + 1; n < end; n++) {
      const at = cues[n]!.from;
      while (left + 2 < anchors.length && anchors[left + 1]!.offset <= at) left++;
      const before = anchors[left]!;
      const after = anchors[left + 1]!;
      const fraction = (at - before.offset) / (after.offset - before.offset);
      const start = before.time + fraction * (after.time - before.time);
      screens[n - 1]!.dur = start - screens[n - 1]!.start;
      screens[n] = {start, dur: limit - start};
    }
  });
  return screens;
}
