import { PILL_PAUSE_KEY, pillPageKey, type PillVisibilityRule } from '@/shared/selectionVisibility';
import type { BgcRequest } from '@/shared/messages';

type Request = Extract<BgcRequest, { type: 'selectionVisibilityGet' | 'selectionVisibilitySet' | 'selectionVisibilityRestore' }>;

let pendingWrite: Promise<unknown> = Promise.resolve();

export async function handleSelectionVisibility(request: Request) {
  const { url } = request;
  if (url !== undefined && (typeof url !== 'string' || !url.startsWith('https://'))) return { ok: false };
  if (!url && request.type !== 'selectionVisibilityRestore') return { ok: false };
  const storage = browser.storage.local;
  const pageKey = url ? pillPageKey(url) : PILL_PAUSE_KEY;
  if (request.type === 'selectionVisibilityGet') {
    const rules = await storage.get([pageKey, PILL_PAUSE_KEY]);
    const pause = rules[PILL_PAUSE_KEY] as PillVisibilityRule | undefined;
    return { ok: true, suppressed: !!rules[pageKey] || (pause?.until ?? 0) > Date.now() };
  }

  const apply = async () => {
    if (request.type === 'selectionVisibilitySet') {
      const { choice } = request;
      if (!url || !['page', 'hour', 'day'].includes(choice)) return { ok: false };
      const key = choice === 'page' ? pageKey : PILL_PAUSE_KEY;
      const previous = (await storage.get(key))[key] as PillVisibilityRule | undefined;
      const rule: PillVisibilityRule = { id: crypto.randomUUID() };
      if (choice !== 'page') rule.until = Date.now() + (choice === 'hour' ? 1 : 24) * 3600000;
      await storage.set({ [key]: rule });
      return { ok: true, undo: { id: rule.id, previous } };
    }

    const { undo } = request;
    if (undo) {
      const current = (await storage.get(pageKey))[pageKey] as PillVisibilityRule | undefined;
      if (current?.id !== undo.id) return { ok: false };
    }
    if (undo?.previous) await storage.set({ [pageKey]: undo.previous });
    else await storage.remove(pageKey);
    return { ok: true };
  };
  // Undo must compare and restore the same rule even when other tabs are writing.
  const result = pendingWrite.then(apply);
  pendingWrite = result.catch(() => {});
  return result;
}
