export const defaultPageShortcut = 'Alt+S';

export function isPageShortcut(value: unknown): value is string {
  return typeof value === 'string' && /^(?=(?:Ctrl|Alt|Meta)\+)(?:Ctrl\+)?(?:Alt\+)?(?:Meta\+)?(?:Shift\+)?[A-Z0-9]$/.test(value);
}

export function pageShortcutFromEvent(event: KeyboardEvent): string | undefined {
  if (event.isComposing || event.getModifierState('AltGraph')) return;
  const physical = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code);
  // Some input devices expose only the logical key.
  const logical = (!event.code || event.code === 'Unidentified') && /^[a-z0-9]$/i.test(event.key)
    ? event.key.toUpperCase() : undefined;
  const key = physical?.[1] ?? physical?.[2] ?? logical;
  if (!key || !(event.ctrlKey || event.altKey || event.metaKey)) return;
  return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.metaKey && 'Meta',
    event.shiftKey && 'Shift', key].filter(Boolean).join('+');
}
