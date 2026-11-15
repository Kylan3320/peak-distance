import { isLanguageTag, normalizeLangTag } from '@/shared/languages';
import type { RegularTranslationResult, TranslationLangs } from './regularTranslation';
import { untilTranslationAbort } from './translationDeadline';

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
interface Session { destroy(): void }
interface TranslatorSession extends Session { translate(text: string, options: {signal: AbortSignal}): Promise<string> }
interface DetectorSession extends Session { detect(text: string, options: {signal: AbortSignal}): Promise<{detectedLanguage: string}[]> }
interface NativeAPIs {
  Translator?: { availability(options: {sourceLanguage:string; targetLanguage:string}): Promise<Availability>; create(options: {sourceLanguage:string; targetLanguage:string; signal:AbortSignal}): Promise<TranslatorSession> };
  LanguageDetector?: { availability(): Promise<Availability>; create(options: {signal:AbortSignal}): Promise<DetectorSession> };
}
const nativeLanguage = (language: string) => language === 'zh-Hans' ? 'zh' : language;
let tail = Promise.resolve();

/** Model download needs a real click in a visible extension page, before handing work to the hidden host. */
export async function prepareNativeTranslation(langs: TranslationLangs & {source:string}, signal: AbortSignal): Promise<void> {
  const api = globalThis as NativeAPIs;
  if (!api.Translator) throw new Error('Native translation is unavailable');
  const sourceLanguage = nativeLanguage(langs.source), targetLanguage = nativeLanguage(langs.target);
  const session = await api.Translator.create({sourceLanguage, targetLanguage, signal});
  session.destroy();
  signal.throwIfAborted();
}

function openSession<T extends Session>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return untilTranslationAbort(work.then(session => {
    if (signal.aborted) { session.destroy(); signal.throwIfAborted(); }
    return session;
  }), signal);
}

/** One document owns the native sessions; each task releases its sessions even on cancellation. */
export async function translateNativeText(text: string, langs: TranslationLangs, signal: AbortSignal, onDetected?: (language: string) => void): Promise<RegularTranslationResult> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>(resolve => { release = resolve; });
  let translator: TranslatorSession | undefined, detector: DetectorSession | undefined;
  let detectedLang: string | undefined;
  const fail = (error: Extract<RegularTranslationResult, {ok:false}>['error'], detail?: string): RegularTranslationResult =>
    ({ok:false, source:'browser-native', error, ...(detail ? {detail} : {}), ...(detectedLang ? {detectedLang} : {})});
  try {
    await previous;
    signal.throwIfAborted();
    const api = globalThis as NativeAPIs;
    const input = text.trim();
    if (!input) return fail('empty');
    let source = langs.source;
    if (!source || source === 'auto' || source === 'und') {
      if (!api.LanguageDetector || await untilTranslationAbort(api.LanguageDetector.availability(), signal) !== 'available') return fail('native-unavailable');
      signal.throwIfAborted();
      detector = await openSession(api.LanguageDetector.create({signal}), signal);
      source = (await untilTranslationAbort(detector.detect(input, {signal}), signal))[0]?.detectedLanguage;
      if (!isLanguageTag(source) || normalizeLangTag(source) === 'und') return fail('native-unavailable');
      onDetected?.(normalizeLangTag(source));
    }
    detectedLang = normalizeLangTag(source);
    if (!api.Translator) return fail('native-unavailable');
    const sourceLanguage = nativeLanguage(detectedLang), targetLanguage = nativeLanguage(langs.target);
    const availability = await untilTranslationAbort(api.Translator.availability({sourceLanguage, targetLanguage}), signal);
    if (availability !== 'available') return fail(availability === 'unavailable' ? 'native-unavailable' : 'native-needs-setup');
    signal.throwIfAborted();
    translator = await openSession(api.Translator.create({sourceLanguage, targetLanguage, signal}), signal);
    const parts = input.split(/(\r\n|\r|\n)/);
    for (let i = 0; i < parts.length; i += 2) {
      signal.throwIfAborted();
      if (!parts[i]!.trim()) continue;
      const output = (await untilTranslationAbort(translator.translate(parts[i]!, {signal}), signal)).trim();
      if (!output) return fail('bad-response');
      parts[i] = output;
    }
    signal.throwIfAborted();
    return {ok:true, source:'browser-native', text:parts.join(''), detectedLang};
  } catch (error) {
    return fail(signal.aborted ? 'aborted' : error instanceof DOMException && error.name === 'NotAllowedError' ? 'native-needs-setup' : 'native-unavailable', String(error));
  } finally { translator?.destroy(); detector?.destroy(); release(); }
}
