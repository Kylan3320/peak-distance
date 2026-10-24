import { isLanguageTag, normalizeLangTag } from '@/shared/languages';
import type { RegularTranslationResult, TranslationLangs } from './regularTranslation';

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
interface Session { destroy(): void }
interface TranslatorSession extends Session { translate(text: string, options: {signal: AbortSignal}): Promise<string> }
interface DetectorSession extends Session { detect(text: string, options: {signal: AbortSignal}): Promise<{detectedLanguage: string}[]> }
interface NativeAPIs {
  Translator?: { availability(options: {sourceLanguage:string; targetLanguage:string}): Promise<Availability>; create(options: {sourceLanguage:string; targetLanguage:string; signal:AbortSignal}): Promise<TranslatorSession> };
  LanguageDetector?: { create(options: {signal:AbortSignal}): Promise<DetectorSession> };
}
const nativeLanguage = (language: string) => language === 'zh-Hans' ? 'zh' : language;
let tail = Promise.resolve();

/** Model download needs a real click in a visible extension page, before handing work to the hidden host. */
export async function prepareNativeTranslation(langs: TranslationLangs, signal: AbortSignal): Promise<void> {
  const api = globalThis as NativeAPIs;
  if (!api.Translator || !api.LanguageDetector) throw new Error('Native translation is unavailable');
  const sourceLanguage = nativeLanguage(langs.source ?? 'en'), targetLanguage = nativeLanguage(langs.target);
  const sessions = await Promise.allSettled([
    api.LanguageDetector.create({signal}),
    ...(sourceLanguage === targetLanguage ? [] : [api.Translator.create({sourceLanguage, targetLanguage, signal})]),
  ]);
  for (const session of sessions) if (session.status === 'fulfilled') session.value.destroy();
  const failure = sessions.find(s => s.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  signal.throwIfAborted();
}

/** One document owns the native sessions; each task releases its sessions even on cancellation. */
export async function translateNativeText(text: string, langs: TranslationLangs, signal: AbortSignal): Promise<RegularTranslationResult> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>(resolve => { release = resolve; });
  let translator: TranslatorSession | undefined, detector: DetectorSession | undefined;
  let detectedLang: string | undefined;
  try {
    await previous;
    signal.throwIfAborted();
    const api = globalThis as NativeAPIs;
    if (!api.Translator) return {ok:false, source:'browser-native', error:'native-unavailable'};
    const input = text.trim();
    if (!input) return {ok:false, source:'browser-native', error:'empty'};
    let source = langs.source;
    if (!source || source === 'auto' || source === 'und') {
      if (!api.LanguageDetector) return {ok:false, source:'browser-native', error:'native-unavailable'};
      detector = await api.LanguageDetector.create({signal});
      source = (await detector.detect(input, {signal}))[0]?.detectedLanguage;
      if (!isLanguageTag(source) || source === 'und') return {ok:false, source:'browser-native', error:'native-unavailable'};
    }
    detectedLang = normalizeLangTag(source);
    const sourceLanguage = nativeLanguage(detectedLang), targetLanguage = nativeLanguage(langs.target);
    if (sourceLanguage === targetLanguage) return {ok:true, source:'browser-native', text:input, detectedLang};
    if (await api.Translator.availability({sourceLanguage, targetLanguage}) === 'unavailable') return {ok:false, source:'browser-native', error:'native-unavailable'};
    signal.throwIfAborted();
    translator = await api.Translator.create({sourceLanguage, targetLanguage, signal});
    const parts = input.split(/(\r\n|\r|\n)/);
    for (let i = 0; i < parts.length; i += 2) {
      signal.throwIfAborted();
      if (!parts[i]!.trim()) continue;
      const output = (await translator.translate(parts[i]!, {signal})).trim();
      if (!output) return {ok:false, source:'browser-native', error:'bad-response'};
      parts[i] = output;
    }
    signal.throwIfAborted();
    return {ok:true, source:'browser-native', text:parts.join(''), detectedLang};
  } catch (error) {
    return {ok:false, source:'browser-native', error:signal.aborted ? 'aborted' : error instanceof DOMException && error.name === 'NotAllowedError' ? 'native-needs-setup' : 'native-unavailable', detail:String(error), ...(detectedLang ? {detectedLang} : {})};
  } finally { translator?.destroy(); detector?.destroy(); release(); }
}
