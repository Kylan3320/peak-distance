import { panelTransportFailure } from './panel';

/** Content-script requests can outlive an extension update. Keep the failure actionable. */
export async function sendRuntime<T>(message: unknown): Promise<T> {
  try {
    return await browser.runtime.sendMessage(message) as T;
  } catch (error) {
    return { ok: false, error: panelTransportFailure(error) } as T;
  }
}
