// One memory mirror and request coalescer; ordinary queries survive browser restarts.
const SESSION_STORE = 'online-cache-v1';
const QUERY_STORE = 'query-cache-v2';
const TTL = 30 * 24 * 60 * 60 * 1000;
const BYTE_LIMIT = 2_000_000;
interface RecordValue { value: unknown; writtenAt: number; usedAt: number; expiresAt?: number }
let records: Record<string, RecordValue> = {};
let ready: Promise<void> | undefined;
let limit = 200;
let write = Promise.resolve();
let queryEpoch = 0;
const pending = new Map<string, { controller: AbortController; cacheable: boolean; users: Set<symbol>; result: Promise<any> }>();
const ordinary = (key: string) => /^\["(?:dictionary|translation)"/.test(key);
const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

let dirty = false;
let writing = false;
function persist(): void {
  dirty = true;
  if (writing) return;
  writing = true;
  write = (async () => {
    try {
      while (dirty) {
        dirty = false;
        const local = Object.fromEntries(Object.entries(records).filter(([key]) => ordinary(key)));
        const session = Object.fromEntries(Object.entries(records).filter(([key]) => !ordinary(key)));
        for (const [area, key, value] of [[browser.storage.local, QUERY_STORE, local], [browser.storage.session, SESSION_STORE, session]] as const) {
          try { await area.set({ [key]: value }); }
          catch (error) { console.warn('[pd] online cache persistence failed', error); }
        }
      }
    } finally { writing = false; }
  })();
}
function prune(): boolean {
  let changed = false;
  const remove = (key: string) => { delete records[key]; changed = true; };
  for (const [key, record] of Object.entries(records)) if (record.expiresAt !== undefined && Date.now() >= record.expiresAt) remove(key);
  const sorted = Object.keys(records).sort((a, b) => records[a]!.usedAt - records[b]!.usedAt || records[a]!.writtenAt - records[b]!.writtenAt || a.localeCompare(b));
  while (sorted.length > limit || size(records) > BYTE_LIMIT) {
    const key = sorted.shift(); if (!key) break; remove(key);
  }
  return changed;
}
async function load(): Promise<void> {
  ready ??= (async () => {
    const [local, session] = await Promise.all([
      browser.storage.local.get([QUERY_STORE, 'cacheLimit']).catch(error => { console.warn('[pd] query cache load failed', error); return {} as Record<string, unknown>; }),
      browser.storage.session.get(SESSION_STORE).catch(error => { console.warn('[pd] session cache load failed', error); return {} as Record<string, unknown>; }),
    ]);
    limit = Math.max(20, Math.min(500, Number(local.cacheLimit) || 200));
    const now = Date.now();
    for (const [key, record] of Object.entries((session[SESSION_STORE] ?? {}) as Record<string, any>)) {
      if (!ordinary(key)) records[key] = record.writtenAt !== undefined ? record : { value: record.value, writtenAt: record.at ?? now, usedAt: record.at ?? now };
    }
    for (const [key, record] of Object.entries((local[QUERY_STORE] ?? {}) as Record<string, RecordValue>)) {
      if (ordinary(key) && Number.isFinite(record.expiresAt) && Number.isFinite(record.writtenAt) && Number.isFinite(record.usedAt)) records[key] = record;
    }
    prune(); persist();
  })();
  await ready;
}
export async function cacheGet<T>(key: string): Promise<T | undefined> {
  await load();
  if (prune()) persist();
  const record = records[key];
  if (record) record.usedAt = Date.now();
  return record?.value as T | undefined;
}
export async function cachePut(key: string, value: unknown, valid: () => boolean = () => true): Promise<void> {
  await load();
  if (!valid()) return;
  const now = Date.now();
  const record = { value, writtenAt: now, usedAt: now, ...(ordinary(key) ? { expiresAt: now + TTL } : {}) };
  delete records[key];
  if (size({ [key]: record }) <= BYTE_LIMIT) records[key] = record;
  prune(); persist();
}
export async function trimCache(): Promise<void> {
  await load();
  const settings = await browser.storage.local.get('cacheLimit');
  limit = Math.max(20, Math.min(500, Number(settings.cacheLimit) || 200));
  prune(); persist();
}
export async function clearQueryCache(): Promise<void> {
  await load(); queryEpoch++;
  for (const key of Object.keys(records)) if (ordinary(key)) delete records[key];
  // Pre-clear consumers may finish, but new consumers start in the new generation.
  for (const key of pending.keys()) if (ordinary(key)) pending.delete(key);
  persist(); await write;
}
export async function cached<T extends { ok: boolean }>(key: string, run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, fresh = false): Promise<T> {
  signal?.throwIfAborted();
  const hit = await cacheGet<T>(key);
  signal?.throwIfAborted();
  if (hit && !fresh) return hit;
  let task = fresh ? undefined : pending.get(key);
  if (!task) {
    if (fresh && pending.has(key)) pending.get(key)!.cacheable = false;
    const controller = new AbortController(), epoch = queryEpoch;
    task = { controller, cacheable:true, users: new Set(), result: Promise.resolve() };
    const current = task;
    task.result = Promise.resolve().then(() => run(controller.signal)).then(result => {
      if (result.ok && !controller.signal.aborted && pending.get(key) === current && (!ordinary(key) || epoch === queryEpoch)) void cachePut(key, result, () => current.cacheable && !controller.signal.aborted && (!ordinary(key) || epoch === queryEpoch));
      return result;
    }).finally(() => { if (pending.get(key) === current) pending.delete(key); });
    pending.set(key, task);
  }
  const user = Symbol(), current = task;
  current.users.add(user);
  return new Promise<T>((resolve, reject) => {
    const release = () => {
      signal?.removeEventListener('abort', abort);
      current.users.delete(user);
      if (!current.users.size && pending.get(key) === current) { pending.delete(key); current.controller.abort(); }
    };
    const abort = () => { release(); reject(new DOMException('Cancelled', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    void current.result.then(resolve, reject).finally(release);
  });
}
