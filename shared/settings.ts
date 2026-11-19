import { defaultPageShortcut, isPageShortcut } from './pageShortcut';
import type { DictionarySource } from '@/lib/onlineDictionary';
import { isDisplayLanguage, type DisplayLanguage } from './i18n';
import {
  DEFAULT_COMPREHENSION_LANG,
  isLanguageTag,
  isTargetLanguage,
  primaryOfLang,
} from './languages';

export type AppearanceTheme = 'minimal' | 'classic';

export function appearanceTheme(value: unknown): AppearanceTheme {
  return value === 'minimal' || value === 'classic' ? value : DEFAULT_SETTINGS.appearanceTheme;
}

export interface Settings {
  appearanceTheme: AppearanceTheme;
  displayLanguage: DisplayLanguage;
  markingEnabled: boolean;
  primaryDictionary: DictionarySource;
  backupDictionary: DictionarySource;
  selectionTranslationMode: 'regular' | 'ai';
  pageTranslationShortcut: string;
  pageTranslationStyle: 'frost' | 'parallel' | 'translated';
  pageTranslationEngine: 'native' | 'ai';
  translationMode: 'regular' | 'ai';
  bilingualEnabled: boolean;
  chineseVisible: boolean;
  cacheLimit: number;
  subtitleSize: 'small' | 'standard' | 'large';
  /** M11：默认理解语言（词语解释／句段／字幕译文共用目标） */
  defaultComprehensionLang: string;
  /** M11：无词典结果时主动查词自动使用 AI（默认关；仅本浏览器生效，不写入学习库） */
  aiLookupFallback: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  appearanceTheme: 'classic',
  displayLanguage: 'auto',
  markingEnabled: true, primaryDictionary: 'cambridge', backupDictionary: 'youdao',
  selectionTranslationMode: 'regular',
  pageTranslationShortcut: defaultPageShortcut,
  pageTranslationStyle: 'frost',
  pageTranslationEngine: 'native',
  translationMode: 'regular',
  bilingualEnabled: true, chineseVisible: true, cacheLimit: 200, subtitleSize: 'standard',
  defaultComprehensionLang: DEFAULT_COMPREHENSION_LANG,
  aiLookupFallback: false,
};

/** Legacy entries remain in the vault preference document. */
function validOverrides(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  for (const [k, t] of Object.entries(v as Record<string, unknown>)) {
    if (!isLanguageTag(k) || !primaryOfLang(k)) return false;
    if (!isLanguageTag(t)) return false;
    if (primaryOfLang(k) === primaryOfLang(t)) return false; // 同语闭环无意义，拒绝保存
  }
  return true;
}

export function validSetting(name: string, value: unknown): boolean {
  if (name === 'pageTranslationShortcut') return isPageShortcut(value);
  if (name === 'pageTranslationStyle') return value === 'frost' || value === 'parallel' || value === 'translated';
  if (name === 'pageTranslationEngine') return value === 'native' || value === 'ai';
  if (name === 'appearanceTheme') return value === 'minimal' || value === 'classic';
  if (name === 'displayLanguage') return isDisplayLanguage(value);
  if (name === 'subtitleSize') return ['small', 'standard', 'large'].includes(String(value));
  if (['markingEnabled', 'bilingualEnabled', 'chineseVisible', 'aiLookupFallback'].includes(name)) return typeof value === 'boolean';
  if (name === 'primaryDictionary' || name === 'backupDictionary') return value === 'youdao' || value === 'cambridge';
  if (name === 'translationMode' || name === 'selectionTranslationMode') return value === 'regular' || value === 'ai';
  if (name === 'defaultComprehensionLang') return isLanguageTag(value) && isTargetLanguage(String(value));
  if (name === 'comprehensionOverrides') return validOverrides(value);
  return name === 'cacheLimit' && Number.isInteger(value) && Number(value) >= 20 && Number(value) <= 500;
}
