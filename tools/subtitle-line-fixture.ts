// One real source interval per test item unless a case supplies its own parts.
export function subtitleItem(text: string, id = 0) {
  const from = id * 1000;
  const to = from + text.length;
  return {id, text, from, to, parts:[{text, unitText:text, from, to, start:id * 4000, dur:4000, budget:32, blockIndex:id, unitIndex:0}]};
}
