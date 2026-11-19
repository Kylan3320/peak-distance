import type { RegularTranslationResult, TranslationLangs } from './regularTranslation';
import { TRANSLATION_TIMEOUT_MS, untilTranslationAbort } from './translationDeadline';

let creating: Promise<void> | undefined;
export async function ensureLanguageDocument() {
  creating ??= (async () => {
    const url = browser.runtime.getURL('/native-translation.html');
    const contexts = await browser.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'], documentUrls:[url]});
    if (!contexts.length) await browser.offscreen.createDocument({url, reasons:['IFRAME_SCRIPTING', 'WORKERS'],
      justification:'Run native translation and the bundled subtitle boundary worker independently of the reading panel.'});
  })().finally(() => { creating = undefined; });
  await creating;
}

export async function requestNativeTranslation(text: string, langs: TranslationLangs, signal: AbortSignal): Promise<RegularTranslationResult> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(TRANSLATION_TIMEOUT_MS)]);
  let detectedLang: string | undefined;
  try {
    deadline.throwIfAborted();
    await untilTranslationAbort(ensureLanguageDocument(), deadline);
    deadline.throwIfAborted();
    const port = browser.runtime.connect({name:'native-translation'});
    try {
      const work = new Promise<RegularTranslationResult>((resolve, reject) => {
        port.onMessage.addListener((message: RegularTranslationResult | {detected: string}) => {
          if ('detected' in message) detectedLang = message.detected;
          else resolve(message);
        });
        port.onDisconnect.addListener(() => reject(new Error(browser.runtime.lastError?.message ?? 'Native translation host disconnected')));
        port.postMessage({text, langs});
      });
      return await untilTranslationAbort(work, deadline);
    } finally { port.disconnect(); }
  } catch (error) {
    const detail = String(error);
    return {ok:false, source:'browser-native', error:signal.aborted ? 'aborted'
      : /extension context invalidated/i.test(detail) ? 'extension-context-invalidated' : 'native-unavailable',
      detail, ...(detectedLang ? {detectedLang} : {})};
  }
}
