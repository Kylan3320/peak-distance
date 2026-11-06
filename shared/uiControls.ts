import { message, setLocalizedAttribute, setText, type UiText } from './i18n';
import { visibleVocabStatus, VOCAB_STATUS_LABEL, type VocabStatus } from './vocab';

const paths = {
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  new:'<path d="M12 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 3l5 5-9 9-5 1 1-5z"/>',
  history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>',
  bookmark:'<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4z"/>',
  saved:'<path fill="currentColor" stroke="none" d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4z"/>',
  known:'<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4zM8 10l3 3 5-5-1-1-4 4-2-2z"/>',
  article:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  library:'<path d="M12 6a5 5 0 0 0-4-2H3v15h5a5 5 0 0 1 4 2 5 5 0 0 1 4-2h5V4h-5a5 5 0 0 0-4 2Zm0 0v15"/>',
  chat:'<path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"/><path d="M8 12h8"/>',
  globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  expand:'<path d="m6 9 6 6 6-6"/>',
  back:'<path d="M19 12H5m7-7-7 7 7 7"/>',
  previous:'<path d="m15 6-6 6 6 6"/>',
  next:'<path d="m9 6 6 6-6 6"/>',
  shuffle:'<path d="M3 6h3c4 0 5 12 10 12h5m-3-3 3 3-3 3M3 18h3c4 0 5-12 10-12h5m-3-3 3 3-3 3"/>',
  reveal:'<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
  copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/>',
  search:'<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>',
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
  lookup:'<path d="M12 6a5 5 0 0 0-4-2H3v15h5a5 5 0 0 1 4 2 5 5 0 0 1 4-2h5V4h-5a5 5 0 0 0-4 2Zm0 0v15M6 8h3M6 12h3M15 8h3M15 12h3"/>',
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
export function actionMenu(label = message('更多操作'), icon: keyof typeof paths = 'more') {
  const wrap = document.createElement('div'); wrap.className = 'ui-action-wrap';
  const trigger = iconButton(icon, label);
  const menu = document.createElement('div'); menu.className = 'ui-action-menu';
  menu.popover = 'auto'; menu.setAttribute('role', 'group');
  setLocalizedAttribute(menu, 'aria-label', label);
  trigger.popoverTargetElement = menu;
  wrap.append(trigger, menu);
  return {wrap, trigger, menu};
}

export function choiceMenu<T extends string>(
  icon: keyof typeof paths,
  label: UiText,
  choices: ReadonlyArray<{value: T; label: UiText; count?: number}>,
  selected: T,
  choose: (value: T) => void,
) {
  const control = actionMenu(label, icon);
  for (const choice of choices) {
    const active = choice.value === selected;
    const button = document.createElement('button');
    button.type = 'button';
    button.value = choice.value;
    button.setAttribute('aria-pressed', String(active));
    button.innerHTML = uiIcon('check');
    const caption = document.createElement('span');
    setText(caption, choice.label);
    button.append(caption);
    if (choice.count !== undefined) {
      const count = document.createElement('small');
      count.textContent = String(choice.count);
      button.append(count);
    }
    button.onclick = () => {
      control.menu.hidePopover();
      control.trigger.focus({preventScroll:true});
      if (button.getAttribute('aria-pressed') !== 'true' && control.trigger.getAttribute('aria-busy') !== 'true') choose(choice.value);
    };
    control.menu.append(button);
  }
  return control;
}

export function learningStatus(expression: string, status: VocabStatus, choose: (value: 'saved' | 'known') => Promise<boolean>) {
  const current = visibleVocabStatus(status);
  const labels = (['saved', 'known'] as const).map(value => ({value,label:message(VOCAB_STATUS_LABEL[value])}));
  const label = message('{expression} · {status}', {expression,status:message(VOCAB_STATUS_LABEL[current])});
  const control = choiceMenu(current, label, labels, current, async value => {
    control.trigger.setAttribute('aria-busy','true');
    const saved = await choose(value);
    control.trigger.removeAttribute('aria-busy');
    if (!saved) return;
    control.trigger.innerHTML = uiIcon(value);
    const updated = message('{expression} · {status}', {expression,status:message(VOCAB_STATUS_LABEL[value])});
    setLocalizedAttribute(control.trigger,'title',updated);
    setLocalizedAttribute(control.trigger,'aria-label',updated);
    labels.forEach(({value: item}, index) => control.menu.children[index]?.setAttribute('aria-pressed',String(item===value)));
  });
  control.trigger.classList.add('learning-status');
  return control.wrap;
}
