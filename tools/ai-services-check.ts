import { subtitleItem } from './subtitle-line-fixture';
import assert from 'node:assert/strict';
import { AI_PRESETS, aiCacheScope, aiReasoningOptions, defaultAiProfile, normalizeAiBaseUrl, readAiServices, validateAiProfile, type AiConfig, type AiProvider, type AiReasoningEffort } from '../shared/aiConfig';
import { buildAiRequest, parseAiResponse, parseAiStreamEvent } from '../lib/aiTransport';
import { chatCompletionStream, lookupExpression, translateSentences } from '../lib/aiClient';

const config = (provider: AiProvider): AiConfig => ({...defaultAiProfile(provider),provider,apiKey:'fixture-key'});
const legacy = readAiServices({deepseekApiKey:' legacy-fixture '});
assert.equal(legacy.profiles.deepseek?.apiKey,'legacy-fixture');
assert.equal(readAiServices({aiServices:{active:'deepseek',profiles:{deepseek:defaultAiProfile('deepseek')}},deepseekApiKey:'old'}).profiles.deepseek?.apiKey,'');
for(const url of ['http://example.com/v1','https://user:secret@example.com','https://example.com/?key=secret','https://example.com/#key']) assert.throws(()=>normalizeAiBaseUrl(url));
assert.equal(normalizeAiBaseUrl('https://example.com/v1/chat/completions/'),'https://example.com/v1');
assert.notEqual(aiCacheScope(config('deepseek')),aiCacheScope(config('kimi')));
assert.notEqual(aiCacheScope(config('openai')),aiCacheScope({...config('openai'),model:'another'}));
assert.ok(!aiCacheScope(config('openai')).includes('fixture-key'));
const terra = { ...config('openai'), model: 'gpt-6.1-terra' };
assert.deepEqual(Object.keys(aiReasoningOptions(terra)), ['off', 'low', 'high', 'max']);
const requestBody = (config: AiConfig, reasoningEffort: AiReasoningEffort | undefined, stream = false): Record<string, unknown> =>
  buildAiRequest({ ...config, reasoningEffort }, [], stream, 4000).body;
assert.equal(requestBody(terra, undefined).reasoning_effort, undefined);
assert.equal(requestBody(terra, 'off').reasoning_effort, 'none');
assert.equal(requestBody(terra, 'max', true).reasoning_effort, 'max');
assert.equal(requestBody({ ...terra, model: 'gpt-5.5-2026-04-23' }, 'max').reasoning_effort, 'xhigh');
assert.deepEqual(aiReasoningOptions(config('openai')), {});
assert.deepEqual(aiReasoningOptions({ ...terra, baseUrl: 'https://gateway.example/v1' }), {});
assert.equal(requestBody(config('deepseek'), 'low').reasoning_effort, 'low');
assert.equal(requestBody(config('glm'), 'max').reasoning_effort, 'max');
assert.equal(requestBody(config('kimi'), 'high').reasoning_effort, 'high');
assert.ok(validateAiProfile({ ...config('kimi'), reasoningEffort: 'off' }));
assert.deepEqual(requestBody(config('gemini'), 'high').generationConfig, { maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: 'high' } });
assert.deepEqual(requestBody(config('anthropic'), 'max').thinking, { type: 'enabled', budget_tokens: 3072 });
assert.deepEqual(requestBody({ ...config('anthropic'), model: 'claude-haiku-5-5' }, 'max').output_config, { effort: 'max' });
assert.equal(readAiServices({ aiServices: { active: 'openai', profiles: { openai: { ...terra, reasoningEffort: 'high' } } } }).profiles.openai?.reasoningEffort, 'high');
assert.notEqual(aiCacheScope(terra), aiCacheScope({ ...terra, reasoningEffort: 'high' }));
let allowed=true;
(globalThis as any).browser={permissions:{contains:async()=>allowed}};
const originalFetch=globalThis.fetch;
try {
  for(const provider of Object.keys(AI_PRESETS).filter(p=>p!=='custom') as AiProvider[]) {
    const c=config(provider);
    assert.equal(validateAiProfile(c),null);
    const messages=[{role:'system' as const,content:'system'},{role:'user' as const,content:'hello'},{role:'assistant' as const,content:'answer'},{role:'user' as const,content:'again'}];
    const request=buildAiRequest(c,messages,false,100);
    assert.ok(!request.url.includes(c.apiKey));
    if(c.protocol==='anthropic'){assert.equal(request.headers['x-api-key'],c.apiKey);assert.ok('system' in request.body);assert.equal(request.body.system,'system');assert.equal(request.body.messages?.length,3);}
    if(c.protocol==='gemini'){assert.equal(request.headers['x-goog-api-key'],c.apiKey);assert.equal(request.body.contents?.[1]?.role,'model');assert.equal(request.body.systemInstruction?.parts[0]?.text,'system');}
    if(c.protocol==='openai') assert.equal(request.headers.Authorization,`Bearer ${c.apiKey}`);
    let sent=0;
    globalThis.fetch=async(url,init)=>{
      sent++;assert.ok(String(url).startsWith(c.baseUrl));assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');
      const body=JSON.parse(String(init?.body));
      if(c.protocol!=='gemini') assert.equal(body.model,c.model);
      const text=JSON.stringify(body).includes('JSON 数组')?'[{"id":0,"lines":["一"]},{"id":1,"lines":["二"]},{"id":2,"lines":["三"]}]':'释义：一起\n语境：在当前语境中表示陪伴';
      return Response.json(c.protocol==='openai'?{choices:[{message:{content:text},finish_reason:'stop'}]}:c.protocol==='anthropic'?{content:[{type:'thinking',thinking:'private'},{type:'text',text}],stop_reason:'end_turn'}:{candidates:[{content:{parts:[{thought:true,text:'private'},{text}]},finishReason:'STOP'}]});
    };
    const lookup=await lookupExpression(c,{expression:'with',sentence:'Stay with me.'});
    assert.ok(lookup.ok);if(lookup.ok){assert.equal(lookup.provider,provider);assert.equal(lookup.model,c.model);assert.equal(lookup.definition,'一起');}
    const translated=await translateSentences(c,['one','two','three'].map(subtitleItem),'A',{source:'en',target:'zh-Hans'});
    assert.ok(translated.ok);if(translated.ok)assert.deepEqual(translated.translations.map(({id,lines})=>[id,lines]),[[0,['一']],[1,['二']],[2,['三']]]);
    allowed=false;const denied=await lookupExpression(c,{expression:'with',sentence:'Stay.'});assert.ok(!denied.ok&&denied.error==='permission');assert.equal(sent,2);allowed=true;
    const events=c.protocol==='openai'?[{choices:[{delta:{reasoning_content:'private'}}]},{choices:[{delta:{content:'你好'}}]},'[DONE]']:c.protocol==='anthropic'?[{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'private'}},{type:'content_block_delta',delta:{type:'text_delta',text:'你好'}},{type:'message_stop'}]:[{candidates:[{content:{parts:[{thought:true,text:'private'}]}}]},{candidates:[{content:{parts:[{text:'你好'}]},finishReason:'STOP'}]}];
    const bytes=new TextEncoder().encode(events.map(e=>'data: '+(typeof e==='string'?e:JSON.stringify(e))+'\n\n').join(''));
    globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close();}}));
    let streamed='';const stream=await chatCompletionStream(c,messages,{signal:new AbortController().signal,onText:t=>streamed=t});assert.ok(stream.ok);assert.equal(streamed,'你好');
    const partial = c.protocol==='openai' ? {choices:[{delta:{content:'部分正文'}}]}
      : c.protocol==='anthropic' ? {type:'content_block_delta',delta:{type:'text_delta',text:'部分正文'}}
      : {candidates:[{content:{parts:[{text:'部分正文'}]}}]};
    const terminal = c.protocol==='openai' ? [{choices:[{finish_reason:'length'}]},'[DONE]']
      : c.protocol==='anthropic' ? [{type:'message_delta',delta:{stop_reason:'max_tokens'}},{type:'message_stop'}]
      : [{candidates:[{finishReason:'MAX_TOKENS'}]}];
    const sse = (events: unknown[]) => new Response(events.map(e=>'data: '+(typeof e==='string'?e:JSON.stringify(e))+'\n\n').join(''));
    globalThis.fetch=async()=>sse([partial]);
    assert.deepEqual(await chatCompletionStream(c,messages,{signal:new AbortController().signal}),{ok:false,error:'interrupted',text:'部分正文'});
    globalThis.fetch=async()=>sse([partial,...terminal]);
    assert.deepEqual(await chatCompletionStream(c,messages,{signal:new AbortController().signal}),{ok:false,error:'truncated',text:'部分正文'});
    globalThis.fetch=async()=>new Response('data: {"error":{"message":"failed"}}\n\n');
    const failed=await chatCompletionStream(c,messages,{signal:new AbortController().signal});assert.ok(!failed.ok&&failed.error==='bad-response');
    globalThis.fetch=async()=>new Response('',{status:401});
    const auth=await lookupExpression(c,{expression:'with',sentence:'Stay.'});assert.ok(!auth.ok&&auth.error==='auth');
    console.log(`PASS ${provider}: 请求、释义、字幕、流式、错误与权限`);
  }
  assert.equal(parseAiResponse('gemini',{candidates:[{content:{parts:[{thought:true,text:'private'}]}}]}).content,null);
  assert.equal(['Hello',' ','world','\n','Next'].map(text=>parseAiStreamEvent('gemini',JSON.stringify({candidates:[{content:{parts:[{text}]}}]})).content).join(''),'Hello world\nNext');
  assert.equal(parseAiStreamEvent('anthropic','{"type":"ping"}').content,null);
  console.log('PASS 旧 Key 兼容、清除不回退、地址校验与缓存隔离');
} finally {globalThis.fetch=originalFetch;}
