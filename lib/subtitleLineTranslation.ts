import { aiCacheScope, type AiConfig } from '@/shared/aiConfig';
import type { SubtitleTranslationItem, SubtitleTranslationRecord, SubtitleTranslationReply, SubtitleVariant } from '@/shared/messages';
import { cleanSubtitleText, fitsSubtitleLine, translateSentences } from './aiClient';
import { cached, cacheGet, cachePut } from './onlineCache';
import { querySubtitleText } from './regularTranslation';

export interface SubtitleRequestScope {
  videoId: string;
  trackId: string;
  revision: string;
  source: string;
  target: string;
  variant: SubtitleVariant;
}

const FORMAT = 'subtitle-lines-v1';
const PROMPT_VERSION = 1;

function itemKey(scope: SubtitleRequestScope, item: SubtitleTranslationItem, provider: string) {
  return JSON.stringify([FORMAT, PROMPT_VERSION, scope.variant, provider, scope.videoId, scope.trackId,
    scope.revision, scope.source, scope.target, item.id, item.from, item.to, item.text,
    item.parts.map(p => [p.blockIndex,p.unitIndex,p.from,p.to,p.start,p.dur,p.unitText,p.text,p.budget,p.platformText ?? null])]);
}

export function validSubtitleItems(items: SubtitleTranslationItem[] | undefined): items is SubtitleTranslationItem[] {
  if (!Array.isArray(items) || !items.length || items.length > 8) return false;
  const seen = new Set<number>();
  for (const item of items) {
    if (!item || !Number.isSafeInteger(item.id) || item.id < 0 || seen.has(item.id) ||
      typeof item.text !== 'string' || !item.text.trim() || !Number.isSafeInteger(item.from) ||
      !Number.isSafeInteger(item.to) || item.from < 0 || item.to <= item.from ||
      !Array.isArray(item.parts) || !item.parts.length) return false;
    seen.add(item.id);
    for (const p of item.parts) {
      if (!p || typeof p.text !== 'string' || !p.text.trim() || typeof p.unitText !== 'string' || !p.unitText.trim() ||
        !Number.isSafeInteger(p.from) || !Number.isSafeInteger(p.to) || p.from < item.from || p.to > item.to || p.to <= p.from ||
        !Number.isSafeInteger(p.blockIndex) || p.blockIndex < 0 || !Number.isSafeInteger(p.unitIndex) || p.unitIndex < 0 ||
        !Number.isFinite(p.start) || p.start < 0 || !Number.isFinite(p.dur) || p.dur < 0 ||
        !Number.isSafeInteger(p.budget) || p.budget < 0 || (p.platformText !== undefined && typeof p.platformText !== 'string')) return false;
    }
  }
  return true;
}

async function regularSentence(scope: SubtitleRequestScope, item: SubtitleTranslationItem, key: string,
  signal: AbortSignal): Promise<SubtitleTranslationReply> {
  const lines: string[] = [];
  const lineSources: SubtitleTranslationRecord['lineSources'] = [];
  for (const [i,part] of item.parts.entries()) {
    if (!part.budget) return {ok:false,error:'bad-response',detail:'line-budget'};
    if (fitsSubtitleLine(part.platformText, part.budget, scope.target)) {
      lines.push(part.platformText.trim()); lineSources.push('youtube');
      continue;
    }
    // Provider primitives for lines can be shared between A and B. The full is
    // an independent translation even if the sentence happens to have one part.
    const partKey = JSON.stringify([FORMAT, 'line', PROMPT_VERSION, scope.videoId, scope.trackId, scope.revision,
      item.from,item.to,i,part.from,part.to,part.start,part.dur,part.unitText,part.budget,part.blockIndex,part.unitIndex]);
    const result = await querySubtitleText(part.text,scope,signal,partKey,
      text => fitsSubtitleLine(text,part.budget,scope.target));
    if (!result.ok) return result;
    lines.push(result.text); lineSources.push(result.source);
  }
  const record: SubtitleTranslationRecord = {id:item.id,lines,lineSources};
  if (scope.variant === 'B') {
    const full = await querySubtitleText(item.text,scope,signal,JSON.stringify([key,'full']),cleanSubtitleText);
    if (!full.ok) return full;
    record.full = full.text; record.fullSource = full.source;
  }
  return {ok:true,translations:[record]};
}

export async function translateSubtitleBatch(scope: SubtitleRequestScope, items: SubtitleTranslationItem[],
  signal: AbortSignal, ai?: AiConfig): Promise<SubtitleTranslationReply> {
  const provider = ai ? aiCacheScope(ai) : 'regular';
  const keys = new Map(items.map(item => [item.id,itemKey(scope,item,provider)]));
  const translations: SubtitleTranslationRecord[] = [];
  const missing: SubtitleTranslationItem[] = [];
  for (const item of items) {
    const hit = await cacheGet<SubtitleTranslationRecord>(keys.get(item.id)!);
    if (hit) translations.push(hit); else missing.push(item);
  }
  signal.throwIfAborted();
  if (!missing.length) return {ok:true,translations};
  let failure: Extract<SubtitleTranslationReply,{ok:false}> | undefined;
  let deferred: number[] | undefined;
  if (ai) {
    const key = JSON.stringify([FORMAT,'batch',missing.map(item => keys.get(item.id))]);
    // The coalescer only persists complete batches. Preserve valid *sentences*
    // from a partial reply in the individual-record cache and leave the rest retryable.
    const reply = await cached(key, async requestSignal => {
      const r = await translateSentences(ai, missing, scope.variant, scope, requestSignal);
      return {ok:r.ok && !r.failure,reply:r};
    },signal);
    if (reply.reply.ok) {
      translations.push(...reply.reply.translations);
      failure = reply.reply.failure;
    } else failure = reply.reply;
  } else {
    for (const [index,item] of missing.entries()) {
      const r = await regularSentence(scope,item,keys.get(item.id)!,signal);
      if (r.ok) translations.push(...r.translations);
      else {
        failure = r;
        if (r.error === 'restricted' || r.error === 'network' || r.error === 'aborted' ||
            r.error === 'extension-context-invalidated' || (r.httpStatus ?? 0) >= 500) {
          deferred = missing.slice(index).map(it => it.id);
          break;
        }
      }
    }
  }
  signal.throwIfAborted();
  const newIds = new Set(missing.map(item => item.id));
  for (const row of translations) if (newIds.has(row.id)) {
    await cachePut(keys.get(row.id)!,row,() => !signal.aborted);
  }
  if (!translations.length && failure) return {...failure,deferred};
  return {ok:true,translations,...(failure && {failure}),...(deferred && {deferred})};
}
