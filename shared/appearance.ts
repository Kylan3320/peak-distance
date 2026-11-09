import type { BroadcastEvent, GetSettingsResult } from './messages';
import { appearanceTheme, DEFAULT_SETTINGS, type AppearanceTheme } from './settings';

const roots = new Set<WeakRef<HTMLElement>>();
const scopes = new WeakSet<HTMLElement>();
let current = DEFAULT_SETTINGS.appearanceTheme;
let initialized = false;
const listeners = new Set<(theme: AppearanceTheme) => void>();

/** Only the extension document and its own Shadow hosts opt into theme changes. */
export function applyAppearance(root: HTMLElement) {
  for (const ref of roots) if (!ref.deref()) roots.delete(ref);
  roots.add(new WeakRef(root));
  scopes.add(root);
  root.dataset.pdTheme = current;
  initAppearance();
}

export function onAppearanceChange(listener: (theme: AppearanceTheme) => void) {
  listeners.add(listener);
  listener(current);
  initAppearance();
}

function update(theme: AppearanceTheme) {
  if (current === theme) return;
  current = theme;
  for (const ref of roots) {
    const root = ref.deref();
    if (root) root.dataset.pdTheme = current;
    else roots.delete(ref);
  }
  for (const listener of listeners) listener(current);
}

export function initAppearance() {
  if (initialized) return;
  initialized = true;
  initKeyboardHints();
  let notified = false;
  browser.runtime.onMessage.addListener((event: BroadcastEvent, sender) => {
    if (sender.id !== browser.runtime.id || event?.type !== 'theme-changed') return;
    notified = true;
    update(appearanceTheme(event.theme));
  });
  // Subscribe before the asynchronous read so an older reply cannot replace a new choice.
  void (browser.runtime.sendMessage({type:'getSettings'}) as Promise<GetSettingsResult>).then(result => {
    if (!notified && result?.ok) update(appearanceTheme(result.settings.appearanceTheme));
  }).catch(error => console.warn('[pd] appearance settings unavailable', error));
}

/** Pointer users get the native title; keyboard focus gets the same label in the top layer. */
function initKeyboardHints() {
  let hint: HTMLElement | undefined;
  let owner: HTMLElement | undefined;
  let revision = 0;
  const close = () => {
    revision++;
    hint?.remove();
    hint = undefined;
    owner = undefined;
  };
  document.addEventListener('focusin', event => {
    close();
    const target = event.composedPath()[0];
    if (!(target instanceof HTMLElement) || !target.matches(':focus-visible[title]') || !target.querySelector(':scope > svg')) return;
    const root = target.getRootNode();
    const host = root instanceof ShadowRoot ? root.host : document.documentElement;
    if (!(host instanceof HTMLElement) || !scopes.has(host) || !target.title) return;
    const focus = revision;
    // Focus events can run before the browser finishes changing the popover stack.
    requestAnimationFrame(() => {
      if (focus !== revision || !target.isConnected || !target.matches(':focus-visible')) return;
      const bubble = document.createElement('span');
      bubble.popover = 'manual';
      bubble.setAttribute('aria-hidden','true');
      bubble.textContent = target.title;
      bubble.style.cssText = 'position:fixed;inset:auto;margin:0;padding:4px 8px;box-sizing:border-box;max-width:calc(100vw - 16px);border:0;border-radius:6px;background:var(--pd-ink);color:var(--pd-surface);font:12px/1.5 var(--pd-font-ui);white-space:normal;overflow-wrap:anywhere;text-shadow:none;pointer-events:none';
      (root instanceof ShadowRoot ? root : document.body).append(bubble);
      bubble.showPopover();
      const rect = target.getBoundingClientRect(), width = bubble.offsetWidth, height = bubble.offsetHeight;
      const left = Math.max(8,Math.min(innerWidth-width-8,rect.left+(rect.width-width)/2));
      const top = rect.bottom+height+8 <= innerHeight ? rect.bottom+4 : Math.max(4,rect.top-height-4);
      bubble.style.left=`${left}px`;
      bubble.style.top=`${top}px`;
      hint=bubble;
      owner=target;
    });
  },true);
  document.addEventListener('focusout', event => {if(event.composedPath()[0]===owner)close();},true);
  document.addEventListener('pointerdown',close,true);
  document.addEventListener('scroll',close,true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();},true);
}
