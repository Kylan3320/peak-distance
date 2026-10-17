import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { scopeEntries, buildReviewQueue, refreshQueue, contextSourceKey } from '../shared/review';
import { generalMeaning } from '../shared/vocab';
import { knowledgeFromAnswer, mergeKnowledge, type KnowledgeRecord } from '../shared/knowledge';
import { emptyChat } from '../shared/chat';
import { parseKnowledge, serializeKnowledge } from '../lib/vault/knowledgeFormat';
import { emptyCollection, serializeCollection, parseCollection } from '../lib/vault/collectionFormat';
import type { EntryView } from '../shared/messages';
import { createArticleLearning, type ArticleLearningSnapshot } from '../entrypoints/sidepanel/articleLearning';

const a = 'https://example.com/article?edition=A';
const context = (url: string, sentence: string, definition: string | null, createdAt: number): EntryView['contexts'][number] => ({ id: createdAt, url, sentence, definition, createdAt, sourceType: 'web', title: url, video: null });
const entry = (key: string, status: EntryView['status'] = 'saved'): EntryView => ({ key, language: key.split('::')[0], expression: 'same', status, kind: 'word', forms: [], createdAt: 1, updatedAt: 5,
  contexts: [context('https://example.com/B','B latest sentence','B meaning',5), context(a+'#section','A latest sentence',null,3), context(a+'#:~:text=old','A old sentence','A old meaning',1)] });
const scope = { sourceKey: `web:${a}`, language: 'en' };
const entries = [entry('en::same'), entry('fr::same'), entry('en::known','known')];
const scoped = scopeEntries(entries, scope);
assert.equal(scoped.length, 2); assert.equal(scoped[0]!.contexts.length, 2);
assert.ok(scoped.every(e => e.contexts.every(c => c.sentence.startsWith('A '))));
const queue = buildReviewQueue(entries, scope);
assert.equal(queue.length, 1); assert.equal(queue[0]!.sentence, 'A latest sentence'); assert.equal(queue[0]!.definition, null);
const refreshed = refreshQueue(queue, queue[0]!.key, [...entries, entry('en::new')], scope);
assert.equal(refreshed.queue.length, 2); assert.ok(refreshed.queue.every(q => q.sentence === 'A latest sentence'));
const three=[entry('en::first'),entry('en::middle'),entry('en::last')];
assert.equal(refreshQueue(buildReviewQueue(three,scope),'en::middle',[three[0]!,three[2]!],scope).currentIndex,1);
assert.equal(buildReviewQueue(entries, {...scope,language:'fr'})[0]!.key, 'fr::same');
assert.equal(buildReviewQueue(entries,{...scope,sourceKey:`web:${a}&extra=1`}).length,0);
assert.equal(contextSourceKey(context('https://example.com/#/route','',null,0)), 'web:https://example.com/#/route');
assert.equal(contextSourceKey(context('https://x.com/a/status/123456#section','',null,0)), 'x:123456');
assert.equal(contextSourceKey(context('https://x.com/home','',null,0)), '');
const video = entry('en::video'); video.contexts = [{...context('https://www.youtube.com/watch?v=A','Video A','A',1),sourceType:'video',video:{videoId:'A',trackId:'en',trackLang:'en',trackKind:'manual',startMs:100}}, {...context('https://www.youtube.com/watch?v=B','Video B','B',2),sourceType:'video',video:{videoId:'B',trackId:'en',trackLang:'en',trackKind:'manual',startMs:200}}];
assert.equal(buildReviewQueue([video],{sourceKey:'yt:A',language:'en'})[0]!.sentence,'Video A');
const referenceEntry=entry('en::reference');
const selectedResult={kind:'dictionary' as const,selectedSense:1,entry:{source:'youdao' as const,expression:'same',headword:'same',url:'https://dict.youdao.com/result?word=same',senses:[{definition:'first sense'},{definition:'selected meaning'}]}};
referenceEntry.contexts[1]!.result=selectedResult;
const referenceQueue=buildReviewQueue([referenceEntry],scope);
assert.equal(referenceQueue[0]!.definition,null);
assert.equal(generalMeaning(referenceQueue[0]!.reference),'selected meaning');
assert.equal(generalMeaning({kind:'translation',source:'google-gtx',text:'Saved translation'}),'Saved translation');
assert.equal(generalMeaning({kind:'ai-definition',source:'ai',text:'Saved AI definition',lang:{source:'en',target:'zh-Hans'}}),'Saved AI definition');
const reversed=buildReviewQueue(three,scope).reverse();
assert.deepEqual(refreshQueue(reversed,reversed[1]!.key,three,scope).queue.map(item=>item.key),reversed.map(item=>item.key));
console.log('PASS current-source lists, counts, definitions and rebuilt review queues use the same source/language intersection; video and legacy URL identities remain distinct');

const source = { sourceType:'article' as const, sourceKey:`web:${a}`, title:'A', url:a };
const chat = {...emptyChat(),id:'chat',source:{...source,title:'B',url:'https://example.com/B'},snapshots:[{source,version:1,createdAt:1,label:'A',blocks:[{id:'p1',text:'Stored quotation'},{id:'p2',text:'Not cited'}]}],messages:[
  {id:'q',role:'user' as const,turnId:'t',text:'Question',at:1,snapshotVersion:1},
  {id:'answer',role:'assistant' as const,turnId:'t',text:'Answer [p1] [p99]',at:2,state:'done' as const},
]};
const content = knowledgeFromAnswer(chat,'answer')!;
assert.equal(content.source.title,'A'); assert.deepEqual(content.quotes,[{id:'p1',text:'Stored quotation'}]);
content.source.title='copy'; assert.equal(chat.snapshots[0]!.source.title,'A');
const record: KnowledgeRecord = {...content,id:'knowledge-id',createdAt:3,updatedAt:3,body:'Answer\n## Embedded heading\n```yaml\nid: example\nlanguage: en\n```'};
const markdown = serializeCollection({...emptyCollection('knowledge'),documents:[serializeKnowledge(record)]},'knowledge');
assert.deepEqual(parseKnowledge(parseCollection(markdown,'knowledge').documents[0]!),record);
const literalBody = 'Before\n<!-- peak-distance:knowledge -->\nAfter';
const legacyDocument = serializeKnowledge({ ...record, body: 'Legacy body placeholder' }).replace('Legacy body placeholder', literalBody);
assert.equal(parseKnowledge(parseCollection(serializeCollection({ ...emptyCollection('knowledge'), documents: [legacyDocument] }, 'knowledge'), 'knowledge').documents[0]!).body, literalBody);
const markerRecord = { ...record, body: [
  'Record separator outside a fence:', '<!-- peak-distance:knowledge -->',
  '```markdown', '<!-- peak-distance:body -->', '```yaml', 'id: example', 'language: en', '```', '<!-- peak-distance:end-body -->', '```',
  '<!-- peak-distance:body 0 -->', '<!-- peak-distance:end-body 0 -->',
].join('\n') };
const nextRecord = { ...record, id: 'second-id', body: 'A separate saved answer.' };
const markerMarkdown = serializeCollection({ ...emptyCollection('knowledge'), documents: [serializeKnowledge(markerRecord), serializeKnowledge(nextRecord)] }, 'knowledge');
const markerParsed = parseCollection(markerMarkdown, 'knowledge');
assert.deepEqual(markerParsed.documents.map(parseKnowledge), [markerRecord, nextRecord]);
assert.equal(serializeCollection({ ...markerParsed, documents: markerParsed.documents.map(parseKnowledge).map(serializeKnowledge) }, 'knowledge'), markerMarkdown);
const separator = '<!-- peak-distance:knowledge -->';
const lastSeparator = markerMarkdown.lastIndexOf(separator);
assert.throws(() => parseCollection(markerMarkdown.slice(0, lastSeparator) + markerMarkdown.slice(lastSeparator + separator.length), 'knowledge'), /format/);
const missingEnd = serializeKnowledge(record).replace('\n<!-- peak-distance:end-body -->', '');
assert.throws(() => parseCollection(serializeCollection({ ...emptyCollection('knowledge'), documents: [missingEnd, serializeKnowledge(nextRecord)] }, 'knowledge'), 'knowledge'), /format/);
const missingTaggedEnd = serializeKnowledge(markerRecord).replace(/\n<!-- peak-distance:end-body \d+ -->\n$/, '\n');
assert.throws(() => parseCollection(serializeCollection({ ...emptyCollection('knowledge'), documents: [missingTaggedEnd, serializeKnowledge(nextRecord)] }, 'knowledge'), 'knowledge'), /format/);
const legacyEndBody = 'Before\n<!-- peak-distance:end-body -->\nAfter\n```yaml\nid: example\nlanguage: en\n```';
const legacyEndDocument = serializeKnowledge({ ...record, body: 'Legacy body placeholder' }).replace('Legacy body placeholder', legacyEndBody);
assert.equal(parseKnowledge(legacyEndDocument).body, legacyEndBody);
assert.deepEqual(parseCollection(serializeCollection({ ...emptyCollection('knowledge'), documents: [legacyEndDocument, serializeKnowledge(nextRecord)] }, 'knowledge'), 'knowledge').documents.map(parseKnowledge), [{ ...record, body: legacyEndBody }, nextRecord]);
const ambiguousLegacy = legacyEndDocument.replace('After\n', '<!-- peak-distance:knowledge -->\nAfter\n');
assert.throws(() => parseKnowledge(ambiguousLegacy), /format/);
assert.throws(() => parseCollection(serializeCollection({ ...emptyCollection('knowledge'), documents: [ambiguousLegacy] }, 'knowledge'), 'knowledge'), /format/);
const orphan = '<!-- peak-distance:body -->\n```yaml\nid: orphan\nlanguage: en\n```\n<!-- peak-distance:end-body -->';
assert.throws(() => parseCollection(emptyCollection('knowledge').prefix + orphan, 'knowledge'), /format/);
assert.throws(() => parseCollection(serializeCollection({ ...emptyCollection('knowledge'), documents: [serializeKnowledge(record) + orphan] }, 'knowledge'), 'knowledge'), /format/);
assert.throws(() => parseCollection(serializeCollection({ ...emptyCollection('knowledge'), documents: [serializeKnowledge(record) + '\n```yaml\nid: orphan\nlanguage: en\n```'] }, 'knowledge'), 'knowledge'), /format/);
const local={...record,title:'Local title'},remote={...record,body:'External body'};
const merged=mergeKnowledge(record,local,remote); assert.equal(merged.kind,'merged');
if(merged.kind==='merged'){assert.equal(merged.value.title,'Local title');assert.equal(merged.value.body,'External body');}
assert.equal(mergeKnowledge(record,local,{...record,title:'Remote title'}).kind,'conflict');
assert.equal(mergeKnowledge(null,local,remote).kind,'conflict');
assert.throws(()=>parseKnowledge('broken'),/format/);
for(const state of ['streaming','error','interrupted'] as const) assert.equal(knowledgeFromAnswer({...chat,messages:[chat.messages[0]!,{...chat.messages[1]!,state}]},'answer'),null);
assert.equal(knowledgeFromAnswer({...chat,snapshots:[]},'answer'),null);
assert.deepEqual(knowledgeFromAnswer({...chat,messages:[chat.messages[0]!,{...chat.messages[1]!,text:'No citations'}]},'answer')!.quotes,[]);
assert.equal(knowledgeFromAnswer({...chat,messages:[chat.messages[0]!,{...chat.messages[1]!,text:'   '}]},'answer'),null);
console.log('PASS independent knowledge uses the actual turn snapshot, copies only valid citations, rejects ineligible answers and round-trips Markdown with field-level merge/conflict detection');

// Controlled response timing exercises source changes without replacing the real view logic.
const { document, window } = parseHTML('<html><body><main></main></body></html>');
const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
const selectPrototype = window.HTMLSelectElement.prototype;
const selectValueDescriptor = Object.getOwnPropertyDescriptor(selectPrototype, 'value')!;
try {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  // Linkedom exposes a read-only select value; supply the browser setter for this fixture.
  Object.defineProperty(selectPrototype, 'value', {
    ...selectValueDescriptor,
    set(this: HTMLSelectElement, value: string) {
      for (const option of this.options) option.selected = option.value === value;
    },
  });
  let focused: HTMLElement | null = null;
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => focused });
  let gate: Promise<void> | undefined;
  const delayResponses = () => {
    let resolve!: () => void;
    gate = new Promise<void>(done => { resolve = done; });
    return () => { gate = undefined; resolve(); };
  };
  const mount = document.querySelector<HTMLElement>('main')!;
  let reviewed: ArticleLearningSnapshot | undefined;
  const article = createArticleLearning(mount, {
    send: async <T>(request: unknown): Promise<T> => {
      await gate;
      return ((request as { type: string }).type === 'listEntries'
        ? { ok: true, entries: [], vaultId: null }
        : { ok: true, records: [], vaultId: null }) as T;
    },
    entry: () => document.createElement('article'),
    review: state => { reviewed = state; },
    translate: () => {}, changed: () => {},
  });
  const otherSource = { ...source, sourceKey: 'web:https://example.com/B', title: 'B', url: 'https://example.com/B' };
  await article.update(source, null);
  const editor = document.createElement('form'); editor.className = 'knowledge-editor'; mount.append(editor);
  await article.update(otherSource, null);
  assert.equal(article.snapshot().source?.sourceKey, source.sourceKey);
  assert.equal(mount.querySelector('h1')!.textContent, 'A');
  mount.querySelector<HTMLButtonElement>('[data-i18n="复习本篇"]')!.click();
  assert.equal(reviewed?.source?.sourceKey, source.sourceKey);
  editor.remove();
  const note = document.createElement('textarea'); note.value = 'Unsaved note'; mount.append(note); focused = note;
  await article.update(otherSource, null);
  assert.equal(article.snapshot().source?.sourceKey, source.sourceKey);
  assert.equal(note.value, 'Unsaved note');
  focused = null;
  await article.update(otherSource, null);
  assert.equal(article.snapshot().source?.sourceKey, otherSource.sourceKey);
  assert.equal(mount.querySelector('h1')!.textContent, 'B');

  const pinned: ArticleLearningSnapshot = { source, category: 'vocab', language: 'all', pinned: true };
  article.restore(pinned);
  let release = delayResponses();
  let pending = article.update(source, null);
  article.follow(); release(); await pending;
  assert.equal(article.snapshot().pinned, false, 'a delayed response must not restore the old article pin after leaving');
  await article.update(otherSource, null);
  assert.equal(article.snapshot().source?.sourceKey, otherSource.sourceKey);

  release = delayResponses(); pending = article.update(otherSource, null);
  article.restore(pinned); release(); await pending;
  assert.deepEqual(article.snapshot(), pinned, 'a delayed response must not overwrite an explicitly restored article');
  await article.update(otherSource, null);
  assert.equal(mount.querySelector('h1')!.textContent, 'A');
} finally {
  Object.defineProperty(selectPrototype, 'value', selectValueDescriptor);
  if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
  else Reflect.deleteProperty(globalThis, 'document');
}
console.log('PASS article edits keep their displayed source and delayed responses cannot undo follow or restore');
