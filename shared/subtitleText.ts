import { segmentWords } from './tokenize';

/** Lay out long clauses without changing the source text, selection offsets or translation unit. */
export function appendSubtitleText(parent: HTMLElement, text: string, language: string) {
  const words = segmentWords(text, language);
  let previousEnd = 0;
  let lineStart = 0;
  for (const [index, word] of words.entries()) {
    const separator = text.slice(previousEnd, word.start);
    if (separator) parent.append(document.createTextNode(separator));
    if (words.length > 38 && index - lineStart >= 9 && words.length - index >= 8 &&
        /[,;:，；：—]/u.test(separator)) {
      parent.append(document.createElement('br'));
      lineStart = index;
    }
    const element = document.createElement('span');
    element.className = 'w';
    element.tabIndex = 0;
    element.setAttribute('role', 'button');
    element.style.userSelect = 'text';
    element.textContent = word.text;
    parent.append(element);
    previousEnd = word.end;
  }
  if (previousEnd < text.length) parent.append(document.createTextNode(text.slice(previousEnd)));
}
