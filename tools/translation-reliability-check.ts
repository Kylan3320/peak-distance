import { subtitleItem } from './subtitle-line-fixture';
// Real translation/cache code with controlled HTTP, clock, and browser session storage.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import type { RegularTranslationResult, TranslationLangs } from '../lib/regularTranslation';

const bundle = (await build({stdin:{contents:"export * from './lib/regularTranslation'; export {translateSubtitleBatch} from './lib/subtitleLineTranslation'; export { cacheGet, cachePut } from './lib/onlineCache'; export { translateSentences } from './lib/aiClient'; export { defaultAiProfile } from './shared/aiConfig'; export { lookupOnline } from './lib/lookupService'; export { DEFAULT_SETTINGS } from './shared/settings';",resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',globalName:'Api'})).outputFiles[0]!.text;
const session:Record<string,unknown>={}, local:Record<string,unknown>={};
let now=1_000_000, calls=0;
let delayedSessionWrite: Promise<void> | undefined;
let respond: (url:URL, init?:RequestInit)=>Promise<Response>;
let nativeReply: ((text:string, langs:TranslationLangs) => Promise<RegularTranslationResult>) | undefined;
let disconnected = 0;
const storage = (values:Record<string,unknown>)=>({
  get:async(keys:string|string[])=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(values[k])])),
  set:async(value:Record<string,unknown>)=>{if(values===session)await delayedSessionWrite;Object.assign(values,structuredClone(value));},
});
function fresh() {
  const runtime = nativeReply && {
    getURL: (path:string) => path,
    getContexts: async () => [{}],
    connect: () => {
      let notify: (result:RegularTranslationResult) => void;
      return {onMessage:{addListener: (listener:typeof notify) => { notify = listener; }},
        onDisconnect:{addListener() {}}, disconnect: () => { disconnected++; },
        postMessage: ({text,langs}:{text:string;langs:TranslationLangs}) => { void nativeReply!(text,langs).then(notify); }};
    },
  };
  const context=vm.createContext({browser:{runtime,storage:{session:storage(session),local:storage(local)},permissions:{contains:async()=>true}},console,Buffer,TextEncoder,
    AbortController,AbortSignal,DOMException,URL,URLSearchParams,Response,Intl,setTimeout,clearTimeout,
    Date:class extends Date { static override now(){return now;} },
    fetch:async(url:URL,init?:RequestInit)=>{calls++;return respond(new URL(url),init);}});
  vm.runInContext(bundle,context);return context.Api;
}
function reset() { for(const values of [session,local])for(const k of Object.keys(values))delete values[k];calls=0;return fresh(); }
const success=()=>Response.json([[['有效译文']],null,'en']);
const items=Array.from({length:6},(_,id)=>subtitleItem(`Uncached sentence ${id}`,10+id));
const langs={source:'en',target:'zh-Hans'};
const scope={...langs,variant:'A',videoId:'fixture',trackId:'en',revision:'fixture-v1'};
const signal=()=>new AbortController().signal;
let api=reset();
respond=async()=>new Response('',{status:429,headers:{'retry-after':'120'}});
const failed=await api.translateSubtitleBatch(scope,items,signal());
assert.equal(failed.ok,false);assert.equal(failed.error,'restricted');assert.equal(failed.httpStatus,429);
assert.equal(failed.retryAt,now+120_000);assert.equal(calls,1);
await new Promise(done=>setTimeout(done,0));
await api.queryTranslation('Another tab','en','zh-Hans',undefined,true);
await api.lookupOnline('日本語',api.DEFAULT_SETTINGS,undefined,undefined,{lang:{source:'ja',target:'zh-Hans'}});
assert.equal(calls,1);
api=fresh();const afterRestart=await api.translateRegularText('After worker restart',undefined,langs);
assert.equal(afterRestart.retryAt,failed.retryAt);assert.equal(calls,1);
console.log('PASS first 429 stops six-cue batch, fails honestly, and shares Retry-After across selections, lookup and worker restart');

api=reset();respond=async()=>success();await api.queryTranslation('Already cached','en','zh-Hans');
respond=async()=>new Response('',{status:429});
await api.translateRegularText('Blocked',undefined,langs);
const cached=await api.queryTranslation('Already cached','en','zh-Hans');assert.equal(cached.ok,true);assert.equal(calls,2);
const refreshed=await api.queryTranslation('Already cached','en','zh-Hans',undefined,true);assert.equal(refreshed.ok,false);assert.equal(calls,2);
now+=60_000;respond=async()=>success();const recovered=await api.translateRegularText('Recovered',undefined,langs);
assert.equal(recovered.ok,true);assert.equal(calls,3);
console.log('PASS successful cache remains usable during cooldown; force refresh cannot bypass it; expiry permits recovery');

api=reset();respond=async()=>new Response('',{status:429});
const concurrent=await Promise.all(['A','B','C'].map(text=>api.translateRegularText(text,undefined,langs)));
assert.ok(concurrent.every(r=>r.error==='restricted'));assert.equal(calls,1);
now+=60_000;await Promise.all(['D','E'].map(text=>api.translateRegularText(text,undefined,langs)));assert.equal(calls,2);
console.log('PASS concurrent cache misses and expired-channel probes send only one request before observing a new 429');

api=reset();respond=async()=>calls===1?success():new Response('',{status:429});
const partial=await api.translateSubtitleBatch(scope,items,signal());
assert.equal(partial.ok,true);assert.equal(partial.translations[0].lineSources[0],'google-gtx');assert.equal(partial.translations.length,1);assert.equal(partial.translations[0].id,10);
assert.equal(partial.failure.httpStatus,429);assert.equal(calls,2);
const cacheOnly=await api.translateSubtitleBatch(scope,[items[0]],signal());assert.equal(cacheOnly.ok,true);assert.equal(calls,2);
console.log('PASS partial success keeps exact cue IDs, carries restriction and stops remaining requests');

api=reset();respond=async()=>new Response('Invalid JSON',{status:200});
const invalid=await api.translateSubtitleBatch(scope,items.slice(0,2),signal());
assert.equal(invalid.ok,false);assert.equal(invalid.error,'bad-response');assert.equal(calls,2);
api=reset();respond=async()=>new Response('',{status:503});
const unavailable=await api.translateSubtitleBatch(scope,items,signal());
assert.equal(unavailable.ok,false);assert.equal(unavailable.error,'http');assert.equal(unavailable.httpStatus,503);assert.equal(calls,1);
console.log('PASS invalid/empty batches cannot report success; 503 stops the batch and remains distinct from access restriction');

api=reset();respond=async()=>new Response('',{status:429,headers:{'retry-after':new Date(now+90_000).toUTCString()}});
assert.equal((await api.translateRegularText('Date deadline',undefined,langs)).retryAt,now+90_000);
api=reset();respond=async()=>new Response('',{status:429,headers:{'retry-after':'invalid'}});
assert.equal((await api.translateRegularText('Invalid deadline',undefined,langs)).retryAt,now+60_000);
api=reset();respond=async()=>{
  const r=new Response('<html>unusual traffic</html>',{status:200});
  Object.defineProperty(r,'url',{value:'https://www.google.com/sorry/index'});return r;
};
const challenge=await api.translateRegularText('Challenge',undefined,langs);
assert.equal(challenge.error,'restricted');assert.equal(calls,1);
assert.equal((await api.translateRegularText('Same language',undefined,{source:'en',target:'en'})).text,'Same language');assert.equal(calls,1);
console.log('PASS HTTP-date/default cooldown and redirected verification pages; same-language results need no network');

api=reset();let finish!:(r:Response)=>void;
respond=()=>new Promise(resolve=>{finish=resolve;});
const first=api.translateRegularText('Held request',undefined,langs);
await new Promise(done=>setTimeout(done,0));
const controller=new AbortController();
const cancelled=api.translateRegularText('Cancelled waiter',controller.signal,langs);controller.abort();
finish(success());await first;
assert.equal((await cancelled).error,'aborted');assert.equal(calls,1);
console.log('PASS cancelling a queued consumer neither sends its request nor cancels another consumer');

api=reset();let releaseWrite!:()=>void;delayedSessionWrite=new Promise(done=>{releaseWrite=done;});
respond=async()=>new Response('',{status:429});
let responded=false;const slowWrite=api.translateRegularText('Slow storage',undefined,langs).then((r:any)=>{responded=true;return r;});
await new Promise(done=>setTimeout(done,0));assert.equal(responded,true);assert.equal((await slowWrite).error,'restricted');
await api.translateRegularText('Still blocked',undefined,langs);assert.equal(calls,1);
releaseWrite();delayedSessionWrite=undefined;await new Promise(done=>setTimeout(done,0));
assert.ok(session['google-translation-restriction']);
console.log('PASS delayed cooldown persistence does not hold the error response or disable the in-memory guard');

let nativeCalls: string[] = [];
nativeReply = async (_text, langs) => {
  nativeCalls.push(langs.source!);
  return {ok:false, source:'browser-native', error:'native-unavailable'};
};
api=reset();
const requested: string[] = [];
respond=async url=>{requested.push(url.searchParams.get('sl')!);return Response.json([[['翻译']],null,'fr']);};
const unknown=await api.queryTranslation('Le Louvre est à Paris.','auto','zh-Hans');
assert.equal(unknown.source,'google-gtx');assert.equal(unknown.detectedLang,'fr');
assert.deepEqual(requested,['auto']);
assert.deepEqual(nativeCalls,['auto']);
nativeReply=async()=>({ok:false,source:'browser-native',error:'bad-response',detectedLang:'ja'});
const pairFailure=await api.queryTranslation('日本の朝です。','auto','zh-Hans');
assert.equal(pairFailure.source,'google-gtx');assert.equal(pairFailure.detectedLang,'ja');
assert.deepEqual(requested,['auto','ja']);
nativeReply=async()=>({ok:false,source:'browser-native',error:'extension-context-invalidated'});
assert.equal((await api.queryTranslation('Context ended.','auto','zh-Hans')).error,'extension-context-invalidated');
assert.equal(calls,2);
console.log('PASS unready detection uses Google auto; a reliable local detection survives native service failure; invalidated context never goes online');

const text='Replace the cached translation.';
let countNative=0;
nativeReply=async()=>{countNative++;return {ok:true,source:'browser-native',text:'内置译文'};};
api=reset();
const nativeKey=api.translationCacheKey(text,'en','zh-Hans','browser-native');
const googleKey=api.translationCacheKey(text,'en','zh-Hans','google-gtx');
await api.cachePut(googleKey,{ok:true,source:'google-gtx',text:'已缓存的在线译文'});
assert.equal((await api.queryTranslation(text,'en','zh-Hans')).source,'google-gtx');
assert.equal(countNative,0);
await api.queryTranslation(text,'en','zh-Hans',undefined,true);
assert.equal((await api.queryTranslation(text,'en','zh-Hans')).source,'browser-native');
assert.equal((await api.cacheGet(nativeKey)).source,'browser-native');
nativeReply=async()=>({ok:false,source:'browser-native',error:'native-needs-setup'});
assert.equal((await api.queryTranslation(text,'en','zh-Hans',undefined,true)).source,'google-gtx');
assert.equal(await api.cacheGet(nativeKey),undefined);
assert.equal((await api.cacheGet(googleKey)).source,'google-gtx');
assert.equal((await api.queryTranslation(text,'en','zh-Hans')).source,'google-gtx');
assert.equal(calls,1);
console.log('PASS provider caches precede capability checks and a successful forced refresh replaces the old provider result');

let nativeEntered!:()=>void;
const nativeStarted=new Promise<void>(resolve=>{nativeEntered=resolve;});
nativeReply=()=>{nativeEntered();return new Promise(()=>{});};
const consumer=new AbortController();
const abortable=api.queryTranslation('Cancel while checking.','auto','zh-Hans',consumer.signal).catch((error:Error)=>error.name);
await nativeStarted;
const beforeDisconnect=disconnected;consumer.abort();
assert.equal(await abortable,'AbortError');await new Promise(done=>setTimeout(done,0));
assert.equal(disconnected,beforeDisconnect+1);assert.equal(calls,1);
nativeReply=async()=>({ok:false,source:'browser-native',error:'native-unavailable'});
let finishShared!: (response:Response) => void, googleEntered!:()=>void;
const googleStarted=new Promise<void>(resolve=>{googleEntered=resolve;});
respond=()=>{googleEntered();return new Promise(resolve=>{finishShared=resolve;});};
const cancelOne=new AbortController();
const queryA=api.queryTranslation('Same direction and text.','en','zh-Hans',cancelOne.signal).catch((error:Error)=>error.name);
const queryB=api.queryTranslation('Same direction and text.','en','zh-Hans');
await googleStarted;cancelOne.abort();
assert.equal(await queryA,'AbortError');
finishShared(success());assert.equal((await queryB).source,'google-gtx');assert.equal(calls,2);
nativeReply=undefined;
console.log('PASS cancellation during a native check prevents online fallback; Google fallback shares work without sharing consumer cancellation');

api=reset();const aiConfig={...api.defaultAiProfile('deepseek'),provider:'deepseek',apiKey:'offline-test-only'};
const one = [subtitleItem('one',19)];
const valid = [{id:19,lines:['一']}];
let lastRequest: any;
const output = (body: unknown) => {
  respond = async (_,init) => {
    lastRequest = JSON.parse(String(init?.body));
    return Response.json({choices:[{message:{content:typeof body === 'string' ? body : JSON.stringify(body)},finish_reason:'stop'}]});
  };
};
for (const invalid of [
  'not JSON', [], [{id:20,lines:['一']}], [...valid,...valid], [{id:19,lines:[]}], [{id:19,lines:['一','二']}],
  [{id:19,lines:[' ']}], [{id:19,lines:['⟦1⟧译文']}], [{id:19,lines:['{"full":"译文"}']}],
  [{id:19,lines:['{}']}], [{id:19,lines:['<part>一</part>']}], [{id:19,lines:['字'.repeat(33)]}], [{id:19,full:'一'}], [{id:19,full:'一',lines:['一']}],
]) {
  output(invalid);
  const before:number=calls;
  const r=await api.translateSentences(aiConfig,one,'A',langs);
  assert.equal(r.ok,false);assert.equal(r.error,'bad-response');assert.equal(calls-before,2);
}
output([{id:19,lines:['一'],full:'完整'}]);
assert.equal((await api.translateSentences(aiConfig,one,'B',langs)).ok,false);
output(valid);const aiA=await api.translateSubtitleBatch(scope,one,signal(),aiConfig);
assert.ok(aiA.ok);assert.equal('full' in aiA.translations[0],false);
output([{id:19,full:'完整意思',lines:['简述']}]);
const count=calls;const aiB=await api.translateSubtitleBatch({...scope,variant:'B'},one,signal(),aiConfig);
assert.equal(calls,count+1);assert.equal(aiB.translations[0].full,'完整意思');
assert.equal(aiB.translations[0].lines[0],'简述');assert.match(lastRequest.messages[0].content,/仅从这份 full 改写/);
assert.deepEqual(Object.keys(JSON.parse(lastRequest.messages[1].content).items[0]),['id','text','parts']);
await api.translateSubtitleBatch({...scope,variant:'B'},one,signal(),aiConfig);assert.equal(calls,count+1);
const revised=[{...one[0],parts:[{...one[0]!.parts[0]!,dur:3999}]}];
await api.translateSubtitleBatch({...scope,variant:'B'},revised,signal(),aiConfig);assert.equal(calls,count+2);
const changedUnit=[{...one[0],parts:[{...one[0]!.parts[0]!,unitText:'one and the next sentence'}]}];
await api.translateSubtitleBatch({...scope,variant:'B'},changedUnit,signal(),aiConfig);
assert.equal(calls,count+3);
assert.equal('unitText' in JSON.parse(lastRequest.messages[1].content).items[0].parts[0],false);
console.log('PASS AI A/B schema, ID set, line budgets and format retry; one B normal request carries full-first rewrite instructions; timed boundaries isolate caches');

api=reset();const pair=subtitleItem('All set.',4);pair.parts=[{...pair.parts[0]!,text:'All',to:pair.from+3,budget:6},{...pair.parts[0]!,text:'set.',from:pair.from+4,budget:6,unitIndex:1}];
const requests:string[]=[];
respond=async url=>{const q=url.searchParams.get('q')!;requests.push(q);return Response.json([[[q==='All'?'都':q==='set.'?'好了。':'一切就绪。']],null,'en']);};
const a=await api.translateSubtitleBatch(scope,[pair],signal());
const b=await api.translateSubtitleBatch({...scope,variant:'B'},[pair],signal());
assert.ok(a.ok && b.ok);assert.deepEqual(Array.from(a.translations[0].lines),['都','好了。']);assert.equal('full' in a.translations[0],false);
assert.equal(b.translations[0].full,'一切就绪。');assert.deepEqual(requests,['All','set.','All set.']);
assert.equal(b.translations[0].fullSource,'google-gtx');
console.log('PASS regular B reuses exact part results and obtains a distinct full through the regular provider');

api=reset();
let attempts=0;
respond=async()=>Response.json([[[attempts++ ? '短' : '超'.repeat(33)]],null,'en']);
assert.equal((await api.translateSubtitleBatch(scope,one,signal())).ok,false);
assert.equal((await api.translateSubtitleBatch(scope,one,signal())).translations[0].lines[0],'短');
assert.equal(attempts,2);
console.log('PASS an over-budget ordinary line remains retryable and never enters the provider cache');
