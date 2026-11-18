import { queryTranslation, type RegularTranslationResult } from './regularTranslation';
import { saveTranslationKnowledge, backfillTranslationKnowledge, translationKnowledgeState } from './db';
import { translationIdentity } from '@/shared/knowledge';
import type { SelectionSnapshot } from '@/shared/panel';

import { getAiConfig } from './aiTransport';
import { translateSelectionText } from './aiClient';
import { aiCacheScope, validateAiProfile, type AiProvider } from '@/shared/aiConfig';
import { cached } from './onlineCache';
import type { Settings } from '@/shared/settings';

type SelectionMode = Settings['selectionTranslationMode'];
type AiSelectionResult = Awaited<ReturnType<typeof translateSelectionText>> | {ok:false; error:'no-key' | 'invalid-config'};
export type SelectionTranslationResult = RegularTranslationResult | (AiSelectionResult & {
  source: `ai:${AiProvider}`; detectedLang?: string; httpStatus?: number;
});

async function queryAiSelection(text: string, source: string, target: string, signal: AbortSignal, fresh: boolean): Promise<SelectionTranslationResult> {
  const config = await getAiConfig();
  const service = `ai:${config.provider}` as const;
  if (!config.apiKey) return {ok:false, source:service, error:'no-key'};
  if (validateAiProfile(config)) return {ok:false, source:service, error:'invalid-config'};
  const key = JSON.stringify(['ai-selection', aiCacheScope(config), source, target, text]);
  const result = await cached(key, requestSignal => translateSelectionText(config, text, source, target, requestSignal), signal, fresh);
  return {...result, source:service};
}

interface Query {
  mode: SelectionMode;
  snapshot: SelectionSnapshot; source: string; target: string;
  controller: AbortController; valid: boolean; detached: boolean;
  saving: number; retained: boolean; settled: boolean; boundId?: string;
  result: Promise<SelectionTranslationResult>;
  value?: SelectionTranslationResult;
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
export async function startSelectionQuery(scope: string, requestId: string, snapshot: SelectionSnapshot, source: string, target: string, fresh: boolean, replace: string | undefined, changed: () => void, mode: SelectionMode = 'regular') {
  if (replace) cancelSelectionQuery(scope, replace, true);
  const identity = translationIdentity(snapshot,source,target);
  if (fresh) for (const [key, previous] of queries) {
    if (previous.mode === mode && translationIdentity(previous.snapshot,previous.source,previous.target) === identity) {
      previous.valid = false; previous.controller.abort(); previous.detached = true; cleanup(key,previous);
    }
  }
  const key = keyOf(scope, requestId);
  if (queries.has(key)) throw new Error('duplicate translation request');
  const controller = new AbortController();
  const translate = mode === 'ai' ? queryAiSelection : queryTranslation;
  const result = translate(snapshot.text, source, target, controller.signal, fresh).catch(error => {
    if (controller.signal.aborted) return {ok:false as const,source:'google-gtx' as const,error:'aborted' as const};
    throw error;
  });
  const query: Query = { mode, snapshot: structuredClone(snapshot), source, target, controller, valid: true, detached: false, saving: 0, retained: false, settled: false, result };
  queries.set(key, query);
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
    // Preserve the existing original-only record shape; the service identifies a result once it has a translation.
    const value = query.value;
    const saved = await saveTranslationKnowledge(query.snapshot, query.source, query.target, owner, value?.ok ? value.text : undefined, value?.detectedLang, value?.ok ? value.source : undefined);
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
