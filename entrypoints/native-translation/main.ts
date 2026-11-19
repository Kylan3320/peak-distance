import type { translateNativeText } from '@/lib/nativeTranslator';

const frame = document.querySelector('iframe')!;
const ready = (frame.contentWindow as Window & {translateNativeText?: unknown})?.translateNativeText
  ? Promise.resolve() : new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), {once:true}));
browser.runtime.onConnect.addListener(port => {
  if (port.name === 'subtitle-boundaries') {
    if (port.sender?.id !== browser.runtime.id || port.sender.frameId !== 0 ||
        !port.sender.url?.startsWith('https://www.youtube.com/')) return;
    let worker: Worker | undefined;
    port.onDisconnect.addListener(() => worker?.terminate());
    port.onMessage.addListener((passages: string[]) => {
      if (worker) return;
      worker = new Worker('/subtitle-segmentation/worker.js');
      worker.onmessage = event => port.postMessage(event.data);
      worker.onerror = event => port.postMessage({ error: event.message });
      worker.postMessage(passages);
    });
    return;
  }
  if (port.name !== 'native-translation' || port.sender?.id !== browser.runtime.id) return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async ({text, langs}) => {
    await ready;
    if (controller.signal.aborted) return;
    const runner = frame.contentWindow as Window & {translateNativeText: typeof translateNativeText};
    const result = await runner.translateNativeText(text, langs, controller.signal, detected => port.postMessage({detected}));
    if (!controller.signal.aborted) port.postMessage(result);
  });
});
