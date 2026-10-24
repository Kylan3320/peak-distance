// Focused cache/routing and knowledge-format risks for translation-learning.md.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { knowledgeFromTranslation, translationIdentity, type KnowledgeRecord } from '../shared/knowledge';
import { parseKnowledge, serializeKnowledge } from '../lib/vault/knowledgeFormat';
import { parseCollection, serializeCollection, emptyCollection } from '../lib/vault/collectionFormat';
import { UI_MESSAGES } from '../shared/uiMessages';
import { readFileSync } from 'node:fs';

const bundle = (await build({stdin:{contents:"export * from './lib/onlineCache'; export * from './lib/regularTranslation'; export * from './lib/lookupService'; export { DEFAULT_SETTINGS } from './shared/settings';",resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',globalName:'Api'})).outputFiles[0]!.text;
const local:Record<string,any>={}, session:Record<string,any>={};
let now=1_000_000, delayed:Promise<void>|undefined, storageFailure=false;
const warnings:unknown[]=[];
const storage=(values:Record<string,any>)=>({get:async(keys:string|string[])=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(values[k])])),set:async(value:Record<string,unknown>)=>{await delayed;if(storageFailure)throw Error('Controlled quota error');Object.assign(values,structuredClone(value));}});
const urls:URL[]=[];
let fetchImpl = async (url:URL)=>new Response(JSON.stringify([[['有效译文']],null,'en']));
function fresh() {
  const context=vm.createContext({browser:{storage:{local:storage(local),session:storage(session)}},console:{warn:(...args:unknown[])=>warnings.push(args)},Buffer,TextEncoder,AbortController,AbortSignal,DOMException,URL,URLSearchParams,Response,Intl,setTimeout,clearTimeout,Date:class extends Date { static override now(){return now;} },fetch:async(url:URL)=>{urls.push(new URL(url));return fetchImpl(new URL(url));}});
  vm.runInContext(bundle,context);return context.Api;
}
let api=fresh();
const tick=()=>new Promise(done=>setTimeout(done,0));
const key=(text:string)=>api.translationCacheKey(text,'en','zh-Hans');
const first=await api.queryTranslation('US policy\nCafé!', 'en','zh-Hans');
assert.equal(first.ok,true);assert.equal(urls[0]!.searchParams.get('q'),'US policy\nCafé!');assert.equal(first.detectedLang,'en');
await tick();
const originalExpiry=local['query-cache-v2'][key('US policy\nCafé!')].expiresAt;
now+=1000;
await api.queryTranslation('US policy\nCafé!', 'en','zh-Hans');assert.equal(urls.length,1);
await api.cachePut('captions:keep',[{text:'Session subtitle'}]);await tick();
api=fresh();await api.queryTranslation('US policy\nCafé!', 'en','zh-Hans');assert.equal(urls.length,1);
now=originalExpiry;await api.queryTranslation('US policy\nCafé!', 'en','zh-Hans');assert.equal(urls.length,2);
await tick();assert.equal(local['query-cache-v2'][key('US policy\nCafé!')].expiresAt,now+30*86400000);
console.log('PASS exact translation input, detected language, persistent restart hit and exact 30-day expiry without renewal');

local.cacheLimit=20;await api.trimCache();
for(let i=0;i<21;i++){now++;await api.cachePut(key(`count-${i}`),{ok:true,text:`${i}`});}
assert.equal(await api.cacheGet(key('count-0')),undefined);
for(let i=0;i<4;i++){now++;await api.cachePut(key(`bytes-${i}`),{ok:true,text:'汉'.repeat(220000)});}
await tick();assert.ok(Buffer.byteLength(JSON.stringify(local['query-cache-v2']))+Buffer.byteLength(JSON.stringify(session['online-cache-v1']))<=2_000_002);
await api.cachePut(key('too-big'),{ok:true,text:'汉'.repeat(700000)});assert.equal(await api.cacheGet(key('too-big')),undefined);
console.log('PASS combined count and UTF-8 byte limits; oversized result is excluded');

await api.clearQueryCache();
let releaseStorage!:()=>void;delayed=new Promise(done=>{releaseStorage=done;});
let resolved=false;const responsive=api.queryTranslation('Storage delayed','en','zh-Hans').then(()=>{resolved=true;});
await tick();assert.equal(resolved,true);await responsive;
releaseStorage();delayed=undefined;await tick();
storageFailure=true;await api.queryTranslation('Storage failed','en','zh-Hans');await tick();assert.ok(warnings.length);storageFailure=false;
await api.queryTranslation('Storage recovered','en','zh-Hans');await tick();assert.ok(local['query-cache-v2'][key('Storage recovered')]);
let finish!:(value:unknown)=>void;
const beforeClear=api.cached(key('cleared-in-flight'),()=>new Promise(done=>{finish=done;}));await tick();
await api.clearQueryCache();finish({ok:true,text:'May display'});assert.equal((await beforeClear).text,'May display');await tick();assert.equal(await api.cacheGet(key('cleared-in-flight')),undefined);
assert.ok(await api.cacheGet('captions:keep')===undefined); // It was legitimately evicted by the combined byte cap.
await api.cachePut('captions:retained',[1]);await api.clearQueryCache();assert.ok(await api.cacheGet('captions:retained'));
console.log('PASS delayed/failed cache persistence never blocks results; clear isolates older in-flight writes and preserves session categories');

let calls=0, settle!:(value:unknown)=>void, sharedSignal:AbortSignal|undefined;
const run=(signal:AbortSignal)=>{calls++;sharedSignal=signal;return new Promise(done=>{settle=done;});};
const a=new AbortController(),b=new AbortController();
const one=api.cached(key('coalesced'),run,a.signal).catch((e:Error)=>e.name),two=api.cached(key('coalesced'),run,b.signal);await tick();a.abort();assert.equal(await one,'AbortError');assert.equal(sharedSignal?.aborted,false);settle({ok:true,text:'Shared'});assert.equal((await two).text,'Shared');assert.equal(calls,1);
let oldResolve!:(value:unknown)=>void;
const old=api.cached(key('fresh'),()=>new Promise(done=>{oldResolve=done;}));await tick();
await api.cached(key('fresh'),async()=>({ok:true,text:'New'}),undefined,true);oldResolve({ok:true,text:'Old'});await old;await tick();assert.equal((await api.cacheGet(key('fresh'))).text,'New');
console.log('PASS coalesced requests cancel consumers independently; bypassed older results cannot replace fresh cache');

urls.length=0;await api.queryTranslation('US policy','en','zh-Hans');urls.length=0;
const result=await api.lookupOnline('US policy',{...api.DEFAULT_SETTINGS,regularTranslation:'google-gtx'},undefined,undefined,{lang:{source:'en',target:'zh-Hans'}});assert.equal(result.result.kind,'translation');assert.equal(urls.length,0);
fetchImpl=async()=>new Response('',{status:403});
await api.lookupOnline('US policy',{...api.DEFAULT_SETTINGS,regularTranslation:'google-gtx'},'youdao',undefined,{lang:{source:'en',target:'zh-Hans'}});assert.equal(urls.length,1);assert.equal(urls[0]!.hostname,'dict.youdao.com');
console.log('PASS default lookup reuses Google cache before network; explicitly chosen dictionary still runs, without an AI request');

const snapshot={text:'US policy\nCafé!',url:'https://example.com/a#section',title:'A'};
const translation:KnowledgeRecord={...knowledgeFromTranslation(snapshot,'auto','zh-Hans','有效译文','en'),id:'translation',createdAt:1,updatedAt:1};
const answer:KnowledgeRecord={...translation,id:'answer',origin:{chatId:'old-chat',messageId:'old-message'}};
const video={...snapshot,position:{videoId:'abc',trackId:'en:manual',trackKind:'manual' as const,trackLang:'en',startMs:1000,endMs:2000}};
const videoRecord:KnowledgeRecord={...knowledgeFromTranslation(video,'en','de'),id:'video',createdAt:2,updatedAt:2};
assert.equal(translationIdentity(snapshot,'auto','zh-Hans'),translationIdentity({...snapshot,url:'https://example.com/a#:~:text=US',text:' US policy\r\nCafe\u0301! '},'auto','zh-Hans'));
assert.notEqual(translationIdentity(snapshot,'en','zh-Hans'),translationIdentity(snapshot,'auto','zh-Hans'));
assert.notEqual(translationIdentity(video,'en','de'),translationIdentity({...video,position:{...video.position,startMs:2000,endMs:3000}},'en','de'));
assert.notEqual(translationIdentity(snapshot,'en','de'),translationIdentity({...snapshot,text:snapshot.text.toLowerCase()},'en','de'));
assert.equal(knowledgeFromTranslation({...snapshot,url:'https://www.youtube.com/watch?v=abc'},'auto','de').source.sourceType,'article');
assert.equal(knowledgeFromTranslation({...snapshot,source:{sourceType:'x',sourceKey:'x:123456',title:'Post',url:'https://x.com/user/status/123456'}},'auto','de').source.sourceKey,'x:123456');
const collection=serializeCollection({...emptyCollection('knowledge'),documents:[answer,translation,videoRecord].map(serializeKnowledge)},'knowledge');
assert.deepEqual(parseCollection(collection,'knowledge').documents.map(parseKnowledge),[answer,translation,videoRecord]);
for(const path of ['shared/translationPopup.ts','shared/settingsView.ts']){
  const text=readFileSync(path,'utf8');for(const match of text.matchAll(/(?:message\('([^']+)'|data-i18n(?:-aria-label)?="([^"]+)")/g)){const key=match[1]??match[2]!;if(key==='$language')continue;assert.ok(UI_MESSAGES[key],key);assert.equal(UI_MESSAGES[key]!.length,5);assert.ok(UI_MESSAGES[key]!.every(Boolean));}
}
console.log('PASS source/mode/location deduplication, legacy AI + translation + video collection round-trip, and modified labels in all five languages');
