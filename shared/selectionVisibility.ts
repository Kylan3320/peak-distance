import { normalizeArticleUrl } from './chat';

export const PAGE_PILL_PREFIX = 'selectionPillPage:';
export const PILL_PAUSE_KEY = 'selectionPillPause';

export type PillVisibilityChoice = 'page' | 'hour' | 'day';
export type PillVisibilityRule = { id: string; until?: number };
export type PillVisibilityUndo = { id: string; previous?: PillVisibilityRule };

export const pillPageKey = (url: string) => PAGE_PILL_PREFIX + normalizeArticleUrl(url);
export const isPillVisibilityKey = (key: string) => key === PILL_PAUSE_KEY || key.startsWith(PAGE_PILL_PREFIX);
