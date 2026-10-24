import { queryTranslation, type RegularTranslationResult } from './regularTranslation';
import { saveTranslationKnowledge, backfillTranslationKnowledge, translationKnowledgeState } from './db';
import { translationIdentity } from '@/shared/knowledge';
import type { SelectionSnapshot } from '@/shared/panel';
import type { TranslationService } from '@/shared/translationService';

interface Query {
  snapshot: SelectionSnapshot; source: string; target: string;
  service: TranslationService;
  controller: AbortController; valid: boolean; detached: boolean;
  saving: number; retained: boolean; settled: boolean; boundId?: string;
  result: Promise<RegularTranslationResult>;
  value?: RegularTranslationResult;
}
const queries = new Map<string, Query>();
const keyOf = (scope: string, requestId: string) => `${scope}|${requestId}`;
function cleanup(key: string, query: Query) {
  if (query.detached && query.settled && !query.saving && queries.get(key) === query) queries.delete(key);
}
export function cancelSelectionQuery(scope: string, requestId: string, supersede = false) {
  const key = keyOf(scope, requestId), query = queries.get(key);
  if (!query) return;
  query.detached = true;
  if (supersede) query.valid = false;
  if (supersede || !query.retained && !query.saving) query.controller.abort();
  // Saving holds a reference through both its transaction and any delayed result.
  cleanup(key, query);
}
export function detachSelectionScope(scope: string) {
  for (const key of queries.keys()) if (key.startsWith(`${scope}|`)) cancelSelectionQuery(scope, key.slice(scope.length + 1));
}
export async function startSelectionQuery(scope: string, requestId: string, snapshot: SelectionSnapshot, source: string, target: string, fresh: boolean, replace: string | undefined, changed: () => void, service: TranslationService | Promise<TranslationService> = 'google-gtx') {
  if (replace) cancelSelectionQuery(scope, replace, true);
  const identity = translationIdentity(snapshot,source,target);
  if (fresh) for (const [key, previous] of queries) {
    if (translationIdentity(previous.snapshot,previous.source,previous.target) === identity) {
      previous.valid = false; previous.controller.abort(); previous.detached = true; cleanup(key,previous);
    }
  }
  const key = keyOf(scope, requestId);
  if (queries.has(key)) throw new Error('duplicate translation request');
  const controller = new AbortController();
  const query: Query = { snapshot: structuredClone(snapshot), source, target, service:typeof service === 'string' ? service : 'google-gtx', controller, valid: true, detached: false, saving: 0, retained: false, settled: false, result: Promise.resolve({ok:false,source:'google-gtx',error:'aborted'}) };
  queries.set(key, query);
  query.result = Promise.resolve(service).then(provider => {
    query.service = provider;
    return queryTranslation(snapshot.text, source, target, controller.signal, fresh, provider);
  }).catch(error => {
    if (controller.signal.aborted) return {ok:false as const,source:query.service,error:'aborted' as const};
    throw error;
  });
  query.result = query.result.then(value => { query.value = value; return value; });
  // Reopening an unedited original-only favorite can fill it after an explicit query.
  query.saving++;
  void (async () => {
    try {
      const saved = await translationKnowledgeState(translationIdentity(snapshot, source, target));
      if (!saved.id) return;
      query.retained = true; query.boundId ??= saved.id;
      const result = await query.result;
      if (saved.id && result.ok && query.valid && await backfillTranslationKnowledge(saved.id, translationIdentity(snapshot,source,target), saved.vaultId, result.text, result.detectedLang, () => query.valid, result.source)) changed();
    } catch (error) { console.warn('[pd] translation backfill failed', error); }
    finally {query.saving--; if(query.detached && !query.retained && !query.saving) query.controller.abort(); cleanup(key,query);}
  })();
  try { return await query.result; }
  finally { query.settled = true; cleanup(key, query); }
}
export async function saveSelectionQuery(scope: string, requestId: string, owner: string | null, changed: () => void) {
  const key = keyOf(scope, requestId), query = queries.get(key);
  if (!query?.valid || query.detached) throw new Error('conflict: translation changed');
  query.saving++;
  try {
    // Never wait for the network to commit an original-only record.
    const saved = await saveTranslationKnowledge(query.snapshot, query.source, query.target, owner, query.value?.ok ? query.value.text : undefined, query.value?.ok ? query.value.detectedLang : undefined, query.service);
    query.retained = true;
    // An old in-flight request can never bind a replacement record after deletion.
    if (query.boundId && query.boundId !== saved.record.id) return saved;
    query.boundId = saved.record.id; query.saving++;
    void (async () => {
      try {
        const result = await query.result;
        if (result.ok && query.valid && await backfillTranslationKnowledge(saved.record.id,
          translationIdentity(query.snapshot, query.source, query.target), owner, result.text, result.detectedLang, () => query.valid, result.source)) changed();
      } catch (error) { console.warn('[pd] translation backfill failed', error); }
      finally {query.saving--;cleanup(key,query);}
    })();
    return saved;
  } finally { query.saving--; cleanup(key, query); }
}
