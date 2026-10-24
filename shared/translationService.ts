export type TranslationService = 'google-gtx' | 'browser-native';
export const isTranslationService = (value: unknown): value is TranslationService => value === 'google-gtx' || value === 'browser-native';
