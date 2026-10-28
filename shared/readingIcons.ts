import { uiIcon } from './uiControls';

const paths = {
  previous: '<path d="M5 4v16M19 5l-10 7 10 7z"/>',
  next: '<path d="M19 4v16M5 5l10 7-10 7z"/>',
  replay: '<path d="M4 10a8 8 0 1 1 1 8M4 3v7h7"/>',
  words: '<path d="M4 20 10 4h4l6 16M7 14h10"/>',
  sentences: '<path d="M4 6h16M4 12h16M4 18h11"/>',
  ask: '<path d="M21 11a8 8 0 0 1-8 8H8l-5 3V11a9 9 0 0 1 18 0ZM9 8a3 3 0 0 1 6 0c0 2-3 2-3 4M12 15h.01"/>',
} as const;

export type ReadingIcon = keyof typeof paths | Parameters<typeof uiIcon>[0];
export const readingIcon = (name: ReadingIcon) => name in paths
  ? `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name as keyof typeof paths]}</svg>`
  : uiIcon(name as Parameters<typeof uiIcon>[0]);

export const readingIconStyles = `
  button.reading-icon {display:inline-flex;align-items:center;justify-content:center;flex:none;width:34px;height:34px;min-height:34px;padding:0;border-color:transparent;background:transparent;color:var(--pd-ink)}
  button.reading-icon:hover {background:var(--pd-selected)}
  .reading-icon svg {width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
  button.reading-icon.is-saved {color:var(--pd-blue)}
  button.reading-icon.is-saved:disabled:not([aria-busy=true]) {opacity:1;cursor:default}
  .reading-icon.is-saved svg {fill:currentColor}
  .reading-icon[aria-busy=true] {cursor:wait}
  @keyframes pd-bookmark-saved {from {transform:scale(.78)} to {transform:scale(1)}}
  .reading-icon.save-complete svg {animation:pd-bookmark-saved 160ms cubic-bezier(.16,1,.3,1)}
  @media(prefers-reduced-motion:reduce) {.reading-icon.save-complete svg {animation:none}}
`;

/** Run only in the successful mutation callback, never in a render path. */
export function animateBookmark(button: HTMLButtonElement) {
  button.classList.add('save-complete');
  setTimeout(() => button.classList.remove('save-complete'), 160);
}
