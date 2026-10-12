import { UI_MESSAGES } from './uiMessages';

export const DISPLAY_LANGUAGES = ['zh-Hans', 'zh-Hant', 'en', 'de', 'fr'] as const;
export type DisplayLocale = typeof DISPLAY_LANGUAGES[number];
export type DisplayLanguage = 'auto' | DisplayLocale;
export const DISPLAY_LANGUAGE_NAMES: Record<DisplayLocale, string> = {
  'zh-Hans': '简体中文', 'zh-Hant': '繁體中文', en: 'English', de: 'Deutsch', fr: 'Français',
};
export const AI_RESPONSE_LANGUAGES: Record<DisplayLocale, string> = {
  'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese', en: 'English', de: 'German', fr: 'French',
};

export function isDisplayLanguage(value: unknown): value is DisplayLanguage {
  return value === 'auto' || DISPLAY_LANGUAGES.includes(value as DisplayLocale);
}

export function resolveDisplayLocale(preference: DisplayLanguage, browserLanguage: string): DisplayLocale {
  if (preference !== 'auto') return preference;
  const tag = browserLanguage.toLowerCase();
  if (tag.startsWith('zh')) return /(?:hant|tw|hk|mo)/.test(tag) ? 'zh-Hant' : 'zh-Hans';
  if (tag === 'de' || tag.startsWith('de-')) return 'de';
  if (tag === 'fr' || tag.startsWith('fr-')) return 'fr';
  return 'en';
}

let locale: DisplayLocale = 'zh-Hans';
let displayLanguage: DisplayLanguage = 'auto';
const listeners = new Set<() => void>();
export const getDisplayLocale = () => locale;
export const getDisplayLanguage = () => displayLanguage;
export function setDisplayLanguage(preference: DisplayLanguage, browserLanguage: string) {
  const next = resolveDisplayLocale(preference, browserLanguage);
  if (next === locale && preference === displayLanguage) return;
  locale = next;
  displayLanguage = preference;
  for (const listener of listeners) listener();
}
export function onDisplayLanguageChange(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Fixed catalog order: Simplified Chinese, Traditional Chinese, English, German, French. */
export function t(key: string, values: UiText['values'] = {}): string {
  return translate(locale,key,values);
}
export function translate(displayLocale: DisplayLocale, key: string, values: UiText['values'] = {}): string {
  if(key === '$language') {
    const tag=String(values.tag);
    return tag==='und' ? translate(displayLocale,'待确认') : new Intl.DisplayNames([displayLocale],{type:'language'}).of(tag)!;
  }
  const text = UI_MESSAGES[key]![DISPLAY_LANGUAGES.indexOf(displayLocale)]!;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value=values[name]!;
    return typeof value==='object' ? translate(displayLocale,value.key,value.values) : String(value);
  });
}

export interface UiText { key: string; values: Record<string, string | number | UiText> }
export const message = (key: string, values: UiText['values'] = {}): UiText => ({ key, values });
export const languageLabel = (tag: string): UiText => message('$language',{tag});
export function setText(element: Element, text: string | UiText) {
  if(typeof text === 'string') {
    element.textContent=text;
    element.removeAttribute('data-i18n');
    element.removeAttribute('data-i18n-values');
  } else {
    element.setAttribute('data-i18n',text.key);
    element.setAttribute('data-i18n-values',JSON.stringify(text.values));
    element.textContent=t(text.key,text.values);
  }
}
export function setLocalizedAttribute(element: Element, attribute: string, text: UiText) {
  element.setAttribute(`data-i18n-${attribute}`,text.key);
  element.setAttribute(`data-i18n-${attribute}-values`,JSON.stringify(text.values));
  element.setAttribute(attribute,t(text.key,text.values));
}

/** Stored material labels are metadata; an unrecognized label may be a user title. */
export function materialLabel(label: string): string | UiText {
  return Object.hasOwn(UI_MESSAGES,label) ? message(label) : label;
}
export function scopeLabel(label: string): string | UiText {
  const match=/^片段 (\d+)\/(\d+)(?: · (.*))?$/.exec(label);
  if(!match) return materialLabel(label);
  const range=match[3];
  if(!range) return message('片段 {index}/{count}',{index:match[1]!,count:match[2]!});
  const paragraphs=/^段落 (\d+)–(\d+)$/.exec(range);
  return paragraphs
    ? message('片段 {index}/{count} · 段落 {start}–{end}',{index:match[1]!,count:match[2]!,start:paragraphs[1]!,end:paragraphs[2]!})
    : message('片段 {index}/{count} · {range}',{index:match[1]!,count:match[2]!,range});
}

/** Only explicitly marked product labels are translated; user content stays untouched. */
export function localize(root: ParentNode) {
  if(root instanceof ShadowRoot) (root.host as HTMLElement).lang=locale;
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) element.textContent = t(element.getAttribute('data-i18n')!,JSON.parse(element.getAttribute('data-i18n-values') ?? '{}'));
  for (const attribute of ['title', 'aria-label', 'placeholder']) {
    for (const element of root.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)!,JSON.parse(element.getAttribute(`data-i18n-${attribute}-values`) ?? '{}')));
    }
  }
}

/** Settings are supplied by the background; content scripts never read private storage. */
export async function initDisplayLanguage() {
  const refresh = async () => {
    const result = await browser.runtime.sendMessage({ type: 'getSettings' });
    if (!result.ok) throw new Error('display-language-settings-unavailable');
    setDisplayLanguage(result.settings.displayLanguage, browser.i18n.getUILanguage());
  };
  await refresh();
  browser.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message.type === 'settings-changed') return refresh();
  });
}
