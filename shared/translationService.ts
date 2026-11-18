import { isAiProvider, type AiProvider } from './aiConfig';

export type TranslationService = 'google-gtx' | 'browser-native';
export const isTranslationService = (value: unknown): value is TranslationService => value === 'google-gtx' || value === 'browser-native';

export type SelectionTranslationService = TranslationService | `ai:${AiProvider}`;
export const isSelectionTranslationService = (value: unknown): value is SelectionTranslationService =>
  isTranslationService(value) || typeof value === 'string' && value.startsWith('ai:') && isAiProvider(value.slice(3));
