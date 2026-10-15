// Production MV3 storage/lifecycle checks plus the real marker and IDB upgrade in disposable profiles.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(join(tmpdir(), 'pd-reliability-'));
const extension = join(root, '.output/chrome-mv3');
const contexts = [];
async function until(check) {
  const deadline = Date.now() + 8000;
  while (!await check()) {
    assert.ok(Date.now() < deadline, 'Expected browser lifecycle state');
    await new Promise(done => setTimeout(done, 20));
  }
}
try {
  const context = await chromium.launchPersistentContext(join(temporary, 'extension'), { channel:'chromium', headless:true,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`] });
  contexts.push(context);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(worker.url()).host}`;
  const control = await context.newPage();
  await control.goto(`${base}/options.html`);
  const send = message => control.evaluate(message => chrome.runtime.sendMessage(message), message);
  await worker.evaluate(async () => {
    await chrome.storage.local.set({deepseekApiKey:'disposable-test-key'});
    globalThis.requests=[];
    globalThis.fetch=async (_url,init) => new Response(new ReadableStream({ start(controller) {
      const reply=()=>{controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Controlled answer"}}]}\n\ndata: [DONE]\n\n'));controller.close();};
      requests.push({signal:init.signal,reply});
      init.signal.addEventListener('abort',()=>controller.error(new DOMException('Cancelled','AbortError')),{once:true});
    }}),{headers:{'content-type':'text/event-stream'}});
  });
  const source={sourceType:'article',sourceKey:'web:test',title:'Test',url:'https://example.com/test'};
  await send({type:'chatNew'});
  for(let i=0;i<32;i++) {
    const response=await control.evaluate(async ({source,i})=>{
      const attached=await chrome.runtime.sendMessage({type:'chatEnsure',source,material:{label:'Draft',blocks:[{id:'p1',text:String(i).padEnd(400000,'x')}]}});
      if(!attached.ok) return {error:attached.error};
      const removed=await chrome.runtime.sendMessage({type:'chatRemoveMaterial',chatId:'',editId:attached.chat.editId});
      return {ok:removed.ok,snapshots:removed.chat.snapshots.length};
    },{source,i});
    assert.deepEqual(response,{ok:true,snapshots:0});
  }
  assert.ok(await control.evaluate(()=>chrome.storage.session.getBytesInUse(null)) < 100000);
  const edit=(await send({type:'chatActive'})).chat;
  const ack=await control.evaluate(edit=>new Promise(resolve=>{
    const port=chrome.runtime.connect({name:'blc-chat'});globalThis.testPort=port;
    port.onMessage.addListener(event=>{if(event.type==='chat-ack')resolve(event);});
    port.postMessage({type:'chat-send',chatId:'',editId:edit.editId,question:'Plain question',snapshotVersion:0,segmentIndex:0});
  }),edit);
  assert.equal(ack.ok,true);
  await until(()=>worker.evaluate(()=>requests.length===1));
  await control.evaluate(()=>testPort.disconnect());
  assert.equal(await worker.evaluate(()=>requests[0].signal.aborted),false);
  await worker.evaluate(()=>requests[0].reply());
  await until(async()=> (await send({type:'chatGet',chatId:ack.submittedChatId})).chat.messages[1].state==='done');
  assert.equal((await send({type:'chatGet',chatId:ack.submittedChatId})).chat.snapshots.length,0);
  console.log('PASS 32 maximum-size discarded attachments stay bounded; plain send persists no discarded material; port loss does not stop the response');

  const history=await control.evaluate(async source=>{
    const snapshots=Array.from({length:30},(_,i)=>({version:i+1,source,label:'Sent material',createdAt:i+1,blocks:[{id:'p1',text:String(i).padEnd(400000,'h')}]}));
    const messages=snapshots.flatMap(s=>[
      {id:`user-${s.version}`,role:'user',turnId:`turn-${s.version}`,text:'Question',at:s.createdAt,snapshotVersion:s.version},
      {id:`answer-${s.version}`,role:'assistant',turnId:`turn-${s.version}`,text:'Answer',at:s.createdAt,state:'done'},
    ]);
    await new Promise((done,reject)=>{
      const request=indexedDB.open('blc-learning');
      request.onsuccess=()=>{
        const db=request.result,tx=db.transaction('conversations','readwrite');
        tx.objectStore('conversations').put({id:'large-history',title:'Large history',source,sourceKey:source.sourceKey,snapshots,messages,activeSnapshotVersion:30,draft:'',pendingQuote:null,updatedAt:100});
        tx.oncomplete=()=>{db.close();done();};tx.onerror=()=>reject(tx.error);
      };request.onerror=()=>reject(request.error);
    });
    const selected=await chrome.runtime.sendMessage({type:'chatSelect',chatId:'large-history'});
    const active=await chrome.runtime.sendMessage({type:'chatActive'});
    const stored=Object.values(await chrome.storage.session.get(null)).filter(value=>value?.id==='large-history');
    return {ok:selected.ok,snapshots:active.chat.snapshots.length,messages:active.chat.messages.length,stored:stored.map(value=>({snapshots:value.snapshots?.length,messages:value.messages?.length})),bytes:await chrome.storage.session.getBytesInUse(null)};
  },source);
  assert.equal(history.ok,true);assert.equal(history.snapshots,30);assert.equal(history.messages,60);
  assert.deepEqual(history.stored,[{snapshots:0,messages:0}]);assert.ok(history.bytes<100000);
  console.log('PASS selecting a 12 MB committed history restores all records without duplicating history into session storage');

  const languages=await control.evaluate(async()=>{
    const base={source:'web',sentence:'Sample.',url:'https://example.com',title:'Sample'};
    const saved=await chrome.runtime.sendMessage({type:'save',snapshot:{...base,expression:'fit',lang:'en-us'}});
    const changed=await chrome.runtime.sendMessage({type:'setStatus',key:'en-US::fit',status:'known'});
    const read=await chrome.runtime.sendMessage({type:'getEntry',key:'en-us::fit'});
    await new Promise((done,reject)=>{
      const request=indexedDB.open('blc-learning');request.onsuccess=()=>{
        const db=request.result,tx=db.transaction('entries','readwrite');
        tx.objectStore('entries').put({key:'en::rise',language:'en',expression:'rise',kind:'word',status:'known',forms:['rose'],createdAt:1,updatedAt:1});
        tx.objectStore('entries').put({key:'en-us::oldfit',language:'en-us',expression:'oldfit',kind:'word',status:'saved',createdAt:1,updatedAt:1});
        tx.oncomplete=()=>{db.close();done();};tx.onerror=()=>reject(tx.error);
      };
    });
    const foreign=await chrome.runtime.sendMessage({type:'save',snapshot:{...base,expression:'rose',lang:'fr'}});
    const legacy=await chrome.runtime.sendMessage({type:'setStatus',key:'en-US::oldfit',status:'known'});
    const legacyRead=await chrome.runtime.sendMessage({type:'getEntry',key:'en-US::oldfit'});
    const dotless=await chrome.runtime.sendMessage({type:'save',snapshot:{...base,expression:'I',lang:'tr'},status:'known'});
    const dotted=await chrome.runtime.sendMessage({type:'save',snapshot:{...base,expression:'i',lang:'tr'}});
    return {key:saved.key,changed:changed.ok,status:read.entry.status,foreignKey:foreign.key,foreignStatus:foreign.status,legacy:legacy.ok&&legacyRead.entry.status==='known',dotless:dotless.key,dotted:dotted.key,dottedStatus:dotted.status};
  });
  assert.deepEqual(languages,{key:'en-US::fit',changed:true,status:'known',foreignKey:'fr::rose',foreignStatus:'saved',legacy:true,dotless:'tr::ı',dotted:'tr::i',dottedStatus:'saved'});
  console.log('PASS full runtime routing preserves regional keys and keeps foreign homographs separate from English forms');

  const nextPage=context.waitForEvent('page');
  const opened=await control.evaluate(base=>chrome.windows.create({url:`${base}/options.html`,focused:false}),base);
  const windowPage=await nextPage;await windowPage.waitForLoadState('load');

  async function sendMaterialQuestion(page, question) {
    const nextRequest=await worker.evaluate(()=>requests.length);
    const ack=await page.evaluate(async question=>{
      const edit=(await chrome.runtime.sendMessage({type:'chatActive'})).chat;
      return new Promise(resolve=>{
        const port=chrome.runtime.connect({name:'blc-chat'});
        port.onMessage.addListener(event=>{if(event.type==='chat-ack') {resolve(event);port.disconnect();}});
        port.postMessage({type:'chat-send',chatId:edit.id,editId:edit.editId,question,snapshotVersion:edit.activeSnapshotVersion??0,segmentIndex:0});
      });
    },question);
    assert.equal(ack.ok,true);
    await until(()=>worker.evaluate(index=>requests.length>index,nextRequest));
    await worker.evaluate(index=>requests[index].reply(),nextRequest);
    await until(async()=>(await send({type:'chatGet',chatId:ack.submittedChatId})).chat.messages.at(-1).state==='done');
    return ack.submittedChatId;
  }
  async function attach(page, name) {
    const result=await page.evaluate(async name=>{
      const edit=(await chrome.runtime.sendMessage({type:'chatActive'})).chat;
      return chrome.runtime.sendMessage({type:'chatEnsure',chatId:edit.id,editId:edit.editId,
        source:{sourceType:'article',sourceKey:'web:'+name,title:name,url:'https://example.com/'+name},
        material:{label:name,blocks:[{id:'p1',text:name+' material'}]}});
    },name);
    assert.equal(result.ok,true);
  }
  await send({type:'chatNew'});await attach(control,'M1');
  const sharedChatId=await sendMaterialQuestion(control,'First window M1');
  await windowPage.evaluate(chatId=>chrome.runtime.sendMessage({type:'chatSelect',chatId}),sharedChatId);
  await attach(control,'M2');await sendMaterialQuestion(control,'First window M2');
  await sendMaterialQuestion(windowPage,'Older window keeps M1');
  let sharedChat=(await send({type:'chatGet',chatId:sharedChatId})).chat;
  assert.deepEqual(sharedChat.snapshots.map(s=>s.label),['M1','M2']);
  assert.deepEqual(sharedChat.messages.filter(m=>m.role==='user').map(m=>m.snapshotVersion),[1,2,1]);
  await attach(windowPage,'M3');await attach(control,'M4');
  await sendMaterialQuestion(control,'First window M4');await sendMaterialQuestion(windowPage,'Second window M3');
  sharedChat=(await send({type:'chatGet',chatId:sharedChatId})).chat;
  assert.deepEqual(sharedChat.snapshots.map(s=>s.label),['M1','M2','M4','M3']);
  assert.deepEqual(sharedChat.messages.filter(m=>m.role==='user').map(m=>m.snapshotVersion),[1,2,1,3,4]);
  console.log('PASS two real windows preserve newer history and rebase colliding attachment versions at commit without changing prior references');

  const closingRequest=await worker.evaluate(()=>requests.length);

  await windowPage.evaluate(async()=>{
    const current=await chrome.windows.getCurrent();
    const attached=await chrome.runtime.sendMessage({type:'chatNew'});
    globalThis.testPort=chrome.runtime.connect({name:'blc-chat'});
    testPort.postMessage({type:'chat-send',chatId:'',editId:attached.chat.editId,question:'Stop when window closes',snapshotVersion:0,segmentIndex:0});
    await chrome.storage.session.set({[`panel-state:${current.id}`]:{reviewQueue:[{sentence:'x'.repeat(50000)}]},[`panel-host:${current.id}`]:{mode:'fixed'},[`panel-before-fullscreen:${(await chrome.tabs.getCurrent()).id}`]:{view:'review'}});
  });
  await until(()=>worker.evaluate(index=>requests.length===index+1,closingRequest));
  await control.evaluate(id=>chrome.windows.remove(id),opened.id);
  await until(()=>worker.evaluate(index=>requests[index].signal.aborted,closingRequest));
  const windowKeys=[`panel-state:${opened.id}`,`panel-host:${opened.id}`,`chat-active:${opened.id}`,`chat-edit:${opened.id}`,`panel-before-fullscreen:${opened.tabs[0].id}`];
  await until(()=>control.evaluate(async keys=>Object.keys(await chrome.storage.session.get(keys)).length===0,windowKeys));
  console.log('PASS real window removal stops owned generation and removes review, editor, host and fullscreen session state');


  async function selectDirectory(name) {
    await control.evaluate(async name=>{
      const root=await navigator.storage.getDirectory();
      const dir=await root.getDirectoryHandle(name,{create:true});
      await new Promise((done,reject)=>{
        const request=indexedDB.open('blc-learning');
        request.onsuccess=()=>{const db=request.result,tx=db.transaction('vault','readwrite');tx.objectStore('vault').put(dir,'handle');tx.oncomplete=()=>{db.close();done();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);
      });
    },name);
    const result=await send({type:'vaultConnect'});assert.equal(result.ok,true);return result.vault.vaultId;
  }
  const vaultA=await selectDirectory('library-A');
  await send({type:'chatNew'});await attach(control,'Owned by A');
  const oldEditor=(await send({type:'chatActive'})).chat;
  const ownedRequest=await worker.evaluate(()=>requests.length);
  const ownedAck=await control.evaluate(edit=>new Promise(resolve=>{
    const port=chrome.runtime.connect({name:'blc-chat'});
    port.onMessage.addListener(event=>{if(event.type==='chat-ack'){resolve(event);port.disconnect();}});
    port.postMessage({type:'chat-send',chatId:edit.id,editId:edit.editId,question:'Running in library A',snapshotVersion:edit.activeSnapshotVersion,segmentIndex:0});
  }),oldEditor);
  assert.equal(ownedAck.ok,true);
  await until(()=>worker.evaluate(index=>requests.length>index,ownedRequest));
  const vaultB=await selectDirectory('library-B');assert.notEqual(vaultA,vaultB);
  assert.equal(await worker.evaluate(index=>requests[index].signal.aborted,ownedRequest),true);
  const inB=(await send({type:'chatActive'})).chat;
  assert.equal(inB.id,'');assert.equal(inB.vaultId,vaultB);assert.notEqual(inB.editId,oldEditor.editId);
  assert.equal((await send({type:'chatGet',chatId:ownedAck.submittedChatId})).chat,null);
  assert.deepEqual((await send({type:'listEntries'})).entries,[]);
  await selectDirectory('library-A');
  const returned=(await send({type:'chatGet',chatId:ownedAck.submittedChatId})).chat;
  assert.equal(returned.messages.at(-1).state,'stopped');assert.equal(returned.snapshots[0].label,'Owned by A');
  console.log('PASS native OPFS library switching stops owned generation, clears stale editors and hides old data; returning restores the committed A conversation');

  const plain=await chromium.launchPersistentContext(join(temporary,'plain'),{channel:'chromium',headless:true});contexts.push(plain);
  const page=await plain.newPage();
  await page.setContent('<!doctype html><html lang="en"><body><main></main></body></html>');
  const marker=await build({absWorkingDir:root,stdin:{contents:"export {createMarker} from './shared/marker';",resolveDir:root},bundle:true,write:false,format:'iife',globalName:'MarkerCheck'});
  await page.addScriptTag({content:marker.outputFiles[0].text});
  const marked=await page.evaluate(async()=>{
    globalThis.browser={runtime:{onMessage:{addListener(){}}}};
    const main=document.querySelector('main');
    main.replaceChildren(...Array.from({length:10},()=>Object.assign(document.createElement('p'),{textContent:Array(400).fill('fit').join(' ')})));
    const marker=MarkerCheck.createMarker({isOwnUi:()=>false,send:async m=>m.type==='getSettings'?{ok:true,settings:{markingEnabled:true}}:{ok:true,items:[{key:'en::fit',language:'en',expression:'fit',status:'learning',forms:[]}]}});
    marker.start();await new Promise(done=>setTimeout(done,100));
    const initial=main.querySelectorAll('[data-blc-key]').length;
    main.replaceChildren(Object.assign(document.createElement('p'),{textContent:'fit again'}));
    await new Promise(done=>setTimeout(done,500));
    const after=main.querySelectorAll('[data-blc-key]').length;marker.stop();return {initial,after};
  });
  assert.deepEqual(marked,{initial:4000,after:1});
  console.log('PASS dynamic page marking resumes after 4000 old marked nodes are removed');

  await page.setContent('<!doctype html><html lang="en"><body><main></main></body></html>');
  const boundaryMarks=await page.evaluate(async()=>{
    const main=document.querySelector('main');
    main.replaceChildren(...Array.from({length:1002},(_,i)=>Object.assign(document.createElement('p'),{textContent:i>=498?'fit':'background'})));
    const marker=MarkerCheck.createMarker({isOwnUi:()=>false,send:async m=>m.type==='getSettings'?{ok:true,settings:{markingEnabled:true}}:{ok:true,items:[{key:'en::fit',language:'en',expression:'fit',status:'learning',forms:[]}]}});
    marker.start();
    const deadline=Date.now()+2000;
    while(!main.lastElementChild.querySelector('[data-blc-key]')&&Date.now()<deadline)await new Promise(done=>setTimeout(done,20));
    const missing=[...main.children].flatMap((node,i)=>i>=498&&!node.querySelector('[data-blc-key]')?[i+1]:[]);
    const dynamic=document.createElement('p');main.append(dynamic);
    await new Promise(done=>setTimeout(done,350));
    dynamic.appendChild(document.createTextNode('fit'));
    await new Promise(done=>setTimeout(done,350));
    const inserted=dynamic.querySelectorAll('[data-blc-key]').length;
    dynamic.textContent='fit again';
    await new Promise(done=>setTimeout(done,350));
    const replaced=dynamic.querySelectorAll('[data-blc-key]').length;
    marker.stop();return {missing,inserted,replaced};
  });
  assert.deepEqual(boundaryMarks,{missing:[],inserted:1,replaced:1});
  console.log('PASS chunk boundaries do not skip text; direct Text insertion and replacement are marked without duplicate wrappers');

  const dbBundle=await build({absWorkingDir:root,stdin:{contents:"export * from './lib/db';",resolveDir:root},bundle:true,write:false,format:'iife',globalName:'DatabaseCheck'});
  const entriesOrigin='https://entry-association.test/';
  await plain.route(entriesOrigin,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Entry association</title>'}));
  await page.goto(entriesOrigin);
  await page.addScriptTag({content:dbBundle.outputFiles[0].text});
  const association=await page.evaluate(async()=>{
    await DatabaseCheck.listEntries(); // Create the actual database and schema.
    await new Promise((done,reject)=>{
      const request=indexedDB.open('blc-learning');
      request.onsuccess=()=>{
        const db=request.result,tx=db.transaction(['entries','contexts'],'readwrite');
        for(let i=0;i<200;i++){
          const language=i%2?'fr':'en',key=`${language}::word${i}`;
          tx.objectStore('entries').put({key,language,expression:`Word${i}`,kind:'word',status:'saved',createdAt:i,updatedAt:i});
          for(let j=0;j<3;j++)tx.objectStore('contexts').add({entryKey:key,sentence:`word${i} context ${j}`,definition:null,url:'https://example.com',title:'Test',createdAt:j});
        }
        tx.objectStore('contexts').add({entryKey:'missing-entry',sentence:'Orphan',createdAt:0});
        tx.oncomplete=()=>{db.close();done();};tx.onerror=()=>reject(tx.error);
      };request.onerror=()=>reject(request.error);
    });
    const originalFilter=Array.prototype.filter;
    let contextVisits=0,entries;
    try {
      Array.prototype.filter=function(predicate,thisArg){
        return originalFilter.call(this,(item,index,array)=>{
          if(item&&typeof item==='object'&&'entryKey' in item)contextVisits++;
          return predicate.call(thisArg,item,index,array);
        });
      };
      entries=await DatabaseCheck.listEntries();
    } finally {Array.prototype.filter=originalFilter;}
    const french=await DatabaseCheck.listEntries(undefined,'fr');
    const query=await DatabaseCheck.listEntries('WORD1');
    return {count:entries.length,contextVisits,first:entries[0].key,last:entries.at(-1).key,
      associated:entries.every(entry=>entry.contexts.length===3&&entry.contexts.every(c=>c.sentence.startsWith(entry.expression.toLowerCase()+' ')&&c.sourceType==='web'&&typeof c.id==='number')),
      order:entries[0].contexts.map(c=>c.createdAt),french:french.length,query:query.length,
      queryMatches:query.every(entry=>entry.expression.toLowerCase().includes('word1'))};
  });
  assert.equal(association.count,200);assert.equal(association.associated,true);
  assert.deepEqual(association.order,[2,1,0]);assert.equal(association.first,'fr::word199');assert.equal(association.last,'en::word0');
  assert.equal(association.french,100);assert.ok(association.query>0&&association.queryMatches);
  assert.ok(association.contextVisits<=601,`Listing must not refilter the whole context table per entry: ${association.contextVisits} visits`);
  console.log('PASS vocabulary listing preserves associations, order, language/query filters without rescanning all contexts per entry');
  for(const known of [true,false]) {
    const origin=known?'https://known.migration.test/':'https://unbound.migration.test/';
    await plain.route(origin,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Migration</title>'}));
    await page.goto(origin);
    await page.evaluate(known=>new Promise((done,reject)=>{
      const request=indexedDB.open('blc-learning',5);
      request.onupgradeneeded=()=>{
        const db=request.result;
        db.createObjectStore('entries',{keyPath:'key'});
        db.createObjectStore('contexts',{keyPath:'id',autoIncrement:true}).createIndex('entryKey','entryKey');
        db.createObjectStore('conversations',{keyPath:'id'});
        db.createObjectStore('sentences',{keyPath:'id'});
        const vault=db.createObjectStore('vault');
        if(known)vault.put({vaultId:'original-vault',formatVersion:2,createdAt:1},'identity');
        vault.put('{"id":"en::fit"}','sync:en::fit');
        db.createObjectStore('vaultQueue',{keyPath:'id'}).put({id:'vocab:en::fit',kind:'vocab',recordId:'en::fit',payload:null,queuedAt:1,revision:'legacy'});
      };
      request.onsuccess=()=>{request.result.close();done();};request.onerror=()=>reject(request.error);
    }),known);
    await page.addScriptTag({content:dbBundle.outputFiles[0].text});
    const migrated=await page.evaluate(async()=>({queue:await DatabaseCheck.listVaultQueue(true),base:await DatabaseCheck.getSyncSnapshot('en::fit'),status:await DatabaseCheck.getVaultStatus()}));
    if(known) {
      assert.equal(migrated.queue[0].vaultId,'original-vault');
      assert.equal(migrated.queue[0].id,'original-vault:vocab:en::fit');
      assert.equal(migrated.base,'{"id":"en::fit"}');
    } else {
      assert.equal(migrated.queue[0].vaultId,undefined);
      assert.equal(migrated.status.lastError,'conflict');
      await page.evaluate(()=>DatabaseCheck.setVaultIdentity({vaultId:'new-vault',formatVersion:2,createdAt:2}));
      assert.equal(await page.evaluate(async()=>(await DatabaseCheck.listVaultQueue()).length),0);
    }
  }
  console.log('PASS v5 upgrade binds known pending work/bases to their original vault; unowned legacy deletion stays isolated and visibly conflicted');

  for(const connected of [true,false]) {
    const origin=`https://${connected?'connected':'disconnected'}-v6.migration.test/`;
    await plain.route(origin,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>v6 migration</title>'}));await page.goto(origin);
    await page.evaluate(connected=>new Promise((done,reject)=>{
      const request=indexedDB.open('blc-learning',6);
      request.onupgradeneeded=()=>{
        const db=request.result;db.createObjectStore('entries',{keyPath:'key'});db.createObjectStore('contexts',{keyPath:'id',autoIncrement:true}).createIndex('entryKey','entryKey');db.createObjectStore('conversations',{keyPath:'id'});db.createObjectStore('sentences',{keyPath:'id'});db.createObjectStore('vaultQueue',{keyPath:'id'});
        const vault=db.createObjectStore('vault'),identity={vaultId:'v6-owner',formatVersion:2,createdAt:1};
        vault.put(identity,'lastIdentity');if(connected)vault.put(identity,'identity');
        vault.put({kind:'vocab',recordId:'en::fit',local:{note:'Keep local'},remote:{note:'Keep remote'}},'conflict:en::fit');
      };
      request.onsuccess=()=>{request.result.close();done();};request.onerror=()=>reject(request.error);
    }),connected);
    await page.addScriptTag({content:dbBundle.outputFiles[0].text});
    const conflict=await page.evaluate(()=>DatabaseCheck.getVaultRaw('conflict:en::fit'));
    assert.equal(conflict.local.note,'Keep local');assert.equal(conflict.remote.note,'Keep remote');
    await page.evaluate(()=>DatabaseCheck.setVaultIdentity({vaultId:'different-vault',formatVersion:2,createdAt:2}));
    assert.equal(await page.evaluate(()=>DatabaseCheck.getVaultRaw('conflict:en::fit')),null);
    await page.evaluate(()=>DatabaseCheck.setVaultIdentity({vaultId:'v6-owner',formatVersion:2,createdAt:1}));
    assert.deepEqual(await page.evaluate(()=>DatabaseCheck.getVaultRaw('conflict:en::fit')),conflict);
  }
  console.log('PASS v6 connected and disconnected upgrades retain conflict copies under their data owner and isolate them on library switch');

} finally {
  await Promise.all(contexts.map(context=>context.close()));
  await rm(temporary,{recursive:true,force:true});
}
