// yt-dual-subs background.js (commit 5657c8a18ca30c84b5d4662bca58e3e9214ffdff):
// 使用同一免 key Google 端点及 json[0][i][0] 结构。
// Copyright (c) 2026 Gythiro. MIT 许可全文见 docs/REFERENCES.md。
//
// M11：支持任意语言对（source 可为 'auto'）；内部语言标签 → google 代码的
// 转换集中在这里。移除按英文字母占比判定失败的旧规则（M11 spec 3.3）：
// 专名或同语输入返回原文不算失败，由调用方按需展示。

import { isLanguageTag, normalizeLangTag } from '@/shared/languages';
import { cached, cacheGet } from './onlineCache';
import type { TranslationService } from '@/shared/translationService';
import { requestNativeTranslation } from './nativeTranslation';
import { TRANSLATION_TIMEOUT_MS } from './translationDeadline';

export function translationCacheKey(text: string, source: string, target: string, service: TranslationService = 'google-gtx'): string {
  return JSON.stringify(['translation', service, 'v2', source === 'und' ? 'auto' : source, target, text.trim()]);
}
export async function cachedTranslation(text: string, source: string, target: string) {
  return await cacheGet<RegularTranslationResult>(translationCacheKey(text, source, target, 'browser-native'))
    ?? await cacheGet<RegularTranslationResult>(translationCacheKey(text, source, target));
}

export function queryTranslation(text: string, source: string, target: string, signal?: AbortSignal, fresh = false) {
  return routeTranslation(text, {source, target}, signal, fresh);
}

function routeTranslation(text: string, langs: TranslationLangs, signal?: AbortSignal, fresh = false, subtitle = false) {
  const source = !langs.source || langs.source === 'und' ? 'auto' : langs.source;
  const target = langs.target;
  const key = (service: TranslationService) => subtitle
    ? JSON.stringify(['subtitle-translation', service, `${source}|${target}`, text])
    : translationCacheKey(text, source, target, service);
  return cached<RegularTranslationResult>(key('browser-native'), async requestSignal => {
    if (!text.trim()) return {ok:false, source:'google-gtx', error:'empty'};
    const native = await requestNativeTranslation(text, {source, target}, requestSignal);
    requestSignal.throwIfAborted();
    if (native.ok || native.error === 'aborted' || native.error === 'extension-context-invalidated') return native;
    const google = await translateRegularText(text, requestSignal, {source:native.detectedLang ?? source, target});
    return native.detectedLang ? {...google, detectedLang:native.detectedLang} : google;
  }, signal, fresh, {key:key('google-gtx'), used:result => result.source === 'google-gtx'});
}

export type RegularTranslationResult =
  | { ok: true; source: TranslationService; text: string; detectedLang?: string }
  | { ok: false; source: TranslationService; error: 'empty' | 'restricted' | 'network' | 'http' | 'bad-response' | 'aborted' | 'extension-context-invalidated' | 'native-unavailable' | 'native-needs-setup'; detail?: string; detectedLang?: string; httpStatus?: number; retryAt?: number };

type TranslationFailure = Extract<RegularTranslationResult, {ok:false}>;
const ACCESS_STORE = 'google-translation-restriction';
const DEFAULT_COOLDOWN_MS = 60_000;
let restriction: TranslationFailure | undefined;
let accessReady: Promise<void> | undefined;
let requestTail = Promise.resolve();

async function loadRestriction(): Promise<void> {
  // The standalone real-source CLI has no browser storage; it still shares the in-process guard.
  accessReady ??= (async () => {
    if (typeof browser === 'undefined') return;
    try { restriction = (await browser.storage.session.get(ACCESS_STORE))[ACCESS_STORE] as TranslationFailure | undefined; }
    catch (error) { console.warn('[pd] translation restriction read failed', error); }
  })();
  await accessReady;
}

function restrict(response: Response): TranslationFailure {
  const now = Date.now(), header = response.headers.get('retry-after')?.trim();
  const seconds = header ? Number(header) : NaN;
  const date = header ? Date.parse(header) : NaN;
  const retryAt = Number.isFinite(seconds) && seconds >= 0 ? now + seconds * 1000
    : Number.isFinite(date) && date > now ? date : now + DEFAULT_COOLDOWN_MS;
  restriction = {ok:false, source:'google-gtx', error:'restricted', httpStatus:response.status,
    detail:`http ${response.status}`, retryAt};
  if (typeof browser !== 'undefined') {
    // The in-memory guard takes effect immediately; slow persistence must not hold the error response.
    void browser.storage.session.set({[ACCESS_STORE]:restriction})
      .catch(error => console.warn('[pd] translation restriction persistence failed', error));
  }
  return restriction;
}

export interface TranslationLangs {
  /** 源语言（内部标签）；'auto' 或缺省交给端点自动检测 */
  source?: string;
  /** 目标语言（内部标签，如 zh-Hans） */
  target: string;
}

/** 内部语言标签 → google-gtx 代码。清单外主标签原样传给端点。 */
export function googleLanguageCode(tag: string): string {
  const primary = tag.trim().toLowerCase().split('-')[0]!;
  if (primary === 'zh') return /^zh-hant/i.test(tag) ? 'zh-TW' : 'zh-CN';
  if (primary === 'iw') return 'iw'; // 端点沿用旧希伯来语代码
  return primary;
}

export function parseGoogleTranslation(json: unknown): string {
  if (!Array.isArray(json) || !Array.isArray(json[0])) return '';
  return json[0]
    .map((part: unknown) => Array.isArray(part) && typeof part[0] === 'string' ? part[0] : '')
    .join('')
    .trim();
}

/** 只翻译一段自由短语或一条字幕；字幕 ID 由调用方保持。 */
export async function translateRegularText(
  text: string,
  signal?: AbortSignal,
  langs?: TranslationLangs,
): Promise<RegularTranslationResult> {
  const input = text.trim();
  if (!input) return { ok: false, source: 'google-gtx', error: 'empty' };
  const sl = !langs?.source || langs.source === 'auto' ? 'auto' : googleLanguageCode(langs.source);
  const tl = googleLanguageCode(langs?.target ?? 'zh-Hans');
  if (sl !== 'auto' && sl === tl) return { ok: true, source: 'google-gtx', text: input };
  // All tabs/entry points share one Google request slot. A queued request observes
  // a preceding 429 before it can reach the network; cancelling a waiter never cancels another request.
  const previous = requestTail;
  let release!: () => void;
  requestTail = new Promise<void>(resolve => { release = resolve; });
  try {
    await previous;
    if (signal?.aborted) return {ok:false, source:'google-gtx', error:'aborted'};
    await loadRestriction();
    if (signal?.aborted) return {ok:false, source:'google-gtx', error:'aborted'};
    if (restriction?.retryAt && restriction.retryAt > Date.now()) return {...restriction};
    return await requestGoogle(input, sl, tl, signal);
  } finally { release(); }
}

async function requestGoogle(input: string, sl: string, tl: string, signal?: AbortSignal): Promise<RegularTranslationResult> {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.search = new URLSearchParams({ client: 'gtx', sl, tl, dt: 't', q: input }).toString();
  const timeout = AbortSignal.timeout(TRANSLATION_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (error) {
    return { ok: false, source: 'google-gtx', error: signal?.aborted ? 'aborted' : 'network', detail: String(error) };
  }
  const challenge = response.url && /(^|\.)google\.com$/.test(new URL(response.url).hostname)
    && new URL(response.url).pathname.startsWith('/sorry/');
  if ([403, 429].includes(response.status) || challenge) return restrict(response);
  if (!response.ok) return { ok: false, source: 'google-gtx', error: 'http', detail: `http ${response.status}`, httpStatus:response.status };
  try {
    const json = await response.json();
    const translated = parseGoogleTranslation(json);
    const detected = Array.isArray(json) ? json[2] : undefined;
    const detectedLang = isLanguageTag(detected) && detected !== 'und' ? normalizeLangTag(detected) : undefined;
    if (!translated) return { ok: false, source: 'google-gtx', error: 'empty' };
    // 专名／无变化输入：保持原文，不算失败（不伪造译文也不阻断展示）
    return { ok: true, source: 'google-gtx', text: translated, ...(detectedLang ? { detectedLang } : {}) };
  } catch (error) {
    return { ok: false, source: 'google-gtx', error: 'bad-response', detail: String(error) };
  }
}

/** Keep cue IDs and partial results, but never call an empty failed batch successful. */
export type RegularCueReply = (
  | TranslationFailure
  | { ok:true; translations:{id:number;text:string;source:TranslationService}[]; failure?:TranslationFailure }
) & { deferred?: number[] };

export async function translateRegularCues(
  items: {id:number; text:string}[], signal: AbortSignal, langs: TranslationLangs,
): Promise<RegularCueReply> {
  const translations: {id:number; text:string; source:TranslationService}[] = [];
  let failure: TranslationFailure | undefined;
  let deferred: number[] | undefined;
  for (const [index,item] of items.entries()) {
    if (signal.aborted) {
      failure = {ok:false, source:'google-gtx', error:'aborted'};
      deferred = items.slice(index).map(item => item.id);
      break;
    }
    const r = await routeTranslation(item.text, langs, signal, false, true);
    if (r.ok) translations.push({id:item.id, text:r.text, source:r.source});
    else {
      failure = r;
      if (r.error === 'restricted' || r.error === 'network' || r.error === 'aborted' || r.error === 'extension-context-invalidated' || (r.httpStatus ?? 0) >= 500) {
        deferred = items.slice(index).map(item => item.id);
        break;
      }
    }
  }
  const outcome = !translations.length && failure ? failure : {ok:true as const, translations, ...(failure ? {failure} : {})};
  return deferred ? { ...outcome, deferred } : outcome;
}
