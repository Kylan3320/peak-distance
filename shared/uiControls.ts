import { message, setLocalizedAttribute, type UiText } from './i18n';

const paths = {
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  new:'<path d="M12 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 3l5 5-9 9-5 1 1-5z"/>',
  history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>',
  bookmark:'<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4z"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  save:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8"/>',
  settings:'<path d="m10 3-.7 2.3-2 .9-2.3-.6-2 3.4 1.6 1.7v2.6L3 15l2 3.4 2.3-.6 2 .9L10 21h4l.7-2.3 2-.9 2.3.6 2-3.4-1.6-1.7v-2.6L21 9l-2-3.4-2.3.6-2-.9L14 3Z"/><circle cx="12" cy="12" r="3"/>',
  float:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18M12 12h5v5m-7 2 7-7"/>',
  dock:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18M6 12h6m-2-2 2 2-2 2"/>',
  folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  sync:'<path d="M20 7a9 9 0 0 0-15-2L3 7m0-5v5h5M4 17a9 9 0 0 0 15 2l2-2m0 5v-5h-5"/>',
  disconnect:'<path d="m9 15-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0M3 3l18 18"/>',
  edit:'<path d="m16 3 5 5-12 12-6 1 1-6zM14 5l5 5"/>',
  locate:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  review:'<path d="M12 7v14M3 3h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5v15h-5a4 4 0 0 0-4 3 4 4 0 0 0-4-3H3z"/><path d="m15 10 2 2 3-4"/>',
  translate:'<path d="m5 8 6 6m-7 0 6-6 2-3H2m5-3v3m8 13 3-8 3 8m-5-3h4"/>',
  external:'<path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
} as const;

export const uiIcon = (icon: keyof typeof paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[icon]}</svg>`;

export function iconButton(icon: keyof typeof paths, label: UiText): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'ui-icon-button';
  button.innerHTML = uiIcon(icon);
  setLocalizedAttribute(button, 'title', label);
  setLocalizedAttribute(button, 'aria-label', label);
  return button;
}

/** The invoker supplies anchoring, Escape, light dismiss and focus restoration. */
export function actionMenu(label = message('更多操作')) {
  const wrap = document.createElement('div'); wrap.className = 'ui-action-wrap';
  const trigger = iconButton('more', label);
  const menu = document.createElement('div'); menu.className = 'ui-action-menu';
  menu.popover = 'auto'; menu.setAttribute('role', 'group');
  setLocalizedAttribute(menu, 'aria-label', label);
  trigger.popoverTargetElement = menu;
  wrap.append(trigger, menu);
  return {wrap, trigger, menu};
}
