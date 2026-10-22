export const PANEL_VIEWS = ['subs', 'list', 'sentences', 'knowledge', 'review', 'chat', 'settings'] as const;
export type PanelView = typeof PANEL_VIEWS[number];
export type PanelMode = 'fixed' | 'floating';
export const isPanelView = (value: unknown): value is PanelView => PANEL_VIEWS.includes(value as PanelView);
export const panelStateKey = (windowId: number) => `panel-state:${windowId}`;

export interface PanelFrameState {
  ok: boolean;
  phase: 'loading' | 'ready' | 'standby' | 'failed' | 'document-missing' | 'unresponsive' | 'document-empty';
  documentId?: string;
  version: string;
  reason?: string;
}

export function panelTransportFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/context invalidated/i.test(text)) return 'extension-context-invalidated';
  if (/receiving end|could not establish connection/i.test(text)) return 'receiver-unavailable';
  if (/port|channel.*closed/i.test(text)) return 'message-channel-closed';
  return 'runtime-send-failed';
}

export interface SelectionSnapshot {
  text: string;
  url: string;
  title: string;
  source?: import('./chat').SourceDescriptor;
  sourceLang?: string;
  languageEvidence?: 'track' | 'element' | 'heuristic';
  position?: { videoId: string; trackId: string; trackKind: 'manual' | 'asr'; trackLang: string; startMs: number; endMs: number };
}

export const MAX_SELECTION_CHARS = 5000;
export function selectionError(text: unknown): 'empty-selection' | 'selection-too-long' | null {
  if (typeof text !== 'string' || !text.trim()) return 'empty-selection';
  if (text.length > MAX_SELECTION_CHARS) return 'selection-too-long';
  return null;
}
