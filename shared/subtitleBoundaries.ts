/** The source bridge can request only bounded local inference for an active acquisition. */
async function infer(passages: string[], signal: AbortSignal): Promise<string[]> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  try {
    const prepared = await browser.runtime.sendMessage({ type: 'prepareSubtitleWorker' });
    if (!prepared?.ok) throw Error('Could not prepare local subtitle worker');
    deadline.throwIfAborted();
    const port = browser.runtime.connect({name: 'subtitle-boundaries'});
    try {
      return await new Promise<string[]>((resolve, reject) => {
        deadline.addEventListener('abort', () => reject(deadline.reason), {once:true});
        port.onDisconnect.addListener(() => reject(Error('Local subtitle worker disconnected')));
        port.onMessage.addListener(result => result.error ? reject(Error(result.error)) : resolve(result.results));
        port.postMessage(passages);
      });
    } finally {
      port.disconnect();
    }
  } catch (error) {
    if (!signal.aborted) console.warn('[pd] Local subtitle boundaries unavailable', error);
    return [];
  }
}

export function createSubtitleBoundaryHost() {
  let job: { revision: string; controller: AbortController; result: Promise<string[]>; clients: number } | undefined;
  let nextStart = 0;
  function cancel() {
    job?.controller.abort();
    job = undefined;
  }
  async function answer(revision: string, passages: unknown, reply: MessagePort) {
    try {
      if (!/^[a-f0-9]{64}$/.test(revision) || !Array.isArray(passages) || !passages.length ||
          passages.length > 20_000 || !passages.every(p => typeof p === 'string' && p.length > 0) ||
          passages.reduce((sum, p) => sum + p.length, 0) > 2_000_000) {
        reply.postMessage([]);
        return;
      }
      if (job?.revision !== revision) {
        cancel();
        const controller = new AbortController();
        // Coalesce source replacements. Page messages cannot continually construct parallel workers.
        const result = (async () => {
          const wait = nextStart - Date.now();
          if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
          if (controller.signal.aborted) return [];
          nextStart = Date.now() + 1000;
          return infer(passages, controller.signal);
        })();
        job = {revision, controller, result, clients: 0};
      }
      const active = job;
      active.clients++;
      let listening = true;
      reply.onmessage = () => {
        listening = false;
        if (--active.clients === 0 && job === active) cancel();
        reply.close();
      };
      const result = await active.result;
      if (listening) {
        active.clients--;
        reply.postMessage(result);
      }
    } finally {
      reply.close();
    }
  }
  return {answer, cancel};
}
