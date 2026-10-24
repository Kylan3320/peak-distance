import type { RegularTranslationResult, TranslationLangs } from './regularTranslation';

let creating: Promise<void> | undefined;
async function ensureDocument() {
  creating ??= (async () => {
    const url = browser.runtime.getURL('/native-translation.html');
    const contexts = await browser.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'], documentUrls:[url]});
    if (!contexts.length) await browser.offscreen.createDocument({url, reasons:['IFRAME_SCRIPTING'],
      justification:'Run the bundled translation iframe independently of the reading panel.'});
  })().finally(() => { creating = undefined; });
  await creating;
}

export async function requestNativeTranslation(text: string, langs: TranslationLangs, signal?: AbortSignal): Promise<RegularTranslationResult> {
  if (signal?.aborted) return {ok:false, source:'browser-native', error:'aborted'};
  try { await ensureDocument(); }
  catch (error) { return {ok:false, source:'browser-native', error:'native-unavailable', detail:String(error)}; }
  if (signal?.aborted) return {ok:false, source:'browser-native', error:'aborted'};
  return new Promise(resolve => {
    const port = browser.runtime.connect({name:'native-translation'});
    let settled = false;
    const finish = (result: RegularTranslationResult) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      port.onDisconnect.removeListener(disconnected);
      port.disconnect(); resolve(result);
    };
    const abort = () => finish({ok:false, source:'browser-native', error:'aborted'});
    const disconnected = () => finish({ok:false, source:'browser-native', error:'native-unavailable'});
    port.onMessage.addListener(finish); port.onDisconnect.addListener(disconnected);
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) { abort(); return; }
    port.postMessage({text, langs});
  });
}
