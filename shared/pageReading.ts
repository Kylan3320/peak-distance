import { readParagraph, paragraphSelector } from './pageParagraphDom';
import { sendRuntime } from './runtime';
import type { GetSettingsResult, PageTranslationReply } from './messages';
import type { Settings } from './settings';
import { primaryOfLang } from './languages';

type Paragraph = NonNullable<ReturnType<typeof readParagraph>>;
type Notice = (key: string, retry?: () => void) => void;
type ReadingSettings = Pick<Settings, 'pageTranslationStyle'|'pageTranslationEngine'|'defaultComprehensionLang'>;
const documentKey = () => location.origin + location.pathname + location.search;
const readingRoot = () => document.querySelector<HTMLElement>('main, [role="main"]') ?? document.body;

function startReading(settings: ReadingSettings, notice: Notice, end: () => void) {
  const page = documentKey();
  let port:ReturnType<typeof browser.runtime.connect> | undefined;
  const pending = new Map<string, {resolve:(s:string)=>void;reject:(error:Error)=>void}>();
  let sequence = 0;
  let active = true;
  let running = 0;
  let frame = 0;
  let style = settings.pageTranslationStyle;
  let warned = false;
  const nearby = new Set<HTMLElement>();
  const queue = new Set<HTMLElement>();
  const records = new Map<HTMLElement,{paragraph:Paragraph;host?:HTMLElement;failed?:boolean}>();
  let root = readingRoot();
  const rootsToScan = new Set<Element>();
  const dirty = new Set<HTMLElement>();

  function transport() {
    if (port) return port;
    const connection = browser.runtime.connect({name:'page-translation'});
    port = connection;
    connection.onMessage.addListener((reply:PageTranslationReply) => {
      const task = pending.get(reply.id);
      if (!task) return;
      pending.delete(reply.id);
      if (reply.ok) task.resolve(reply.text);
      else task.reject(new Error(reply.error));
    });
    connection.onDisconnect.addListener(() => {
      if (port !== connection) return;
      port = undefined;
      for (const task of pending.values()) task.reject(new Error('disconnected'));
      pending.clear();
    });
    return connection;
  }
  function request(text:string, source:string) {
    return new Promise<string>((resolve,reject) => {
      if (!active) { reject(new Error('aborted')); return; }
      const id = String(++sequence);
      pending.set(id,{resolve,reject});
      try {
        transport().postMessage({id,text,source,target:settings.defaultComprehensionLang,engine:settings.pageTranslationEngine});
      } catch (error) { pending.delete(id); reject(error); }
    });
  }

  function forget(block:HTMLElement) {
    const record = records.get(block);
    if (record?.host) record.paragraph.remove(record.host);
    records.delete(block);
  }
  function retry() {
    warned = false;
    for (const [block,record] of records) if (record.failed) {
      forget(block);
      if (nearby.has(block)) queue.add(block);
    }
    drain();
  }
  async function translate(block:HTMLElement, paragraph:Paragraph) {
    const record: {paragraph:Paragraph;host?:HTMLElement;failed?:boolean} = {paragraph};
    records.set(block,record);
    running++;
    try {
      // A site-wide language tag can name the UI language on a mixed-language article.
      const source = primaryOfLang(paragraph.source) === primaryOfLang(settings.defaultComprehensionLang) ? 'auto' : paragraph.source;
      const fragment = await paragraph.translate(text => request(text,source));
      if (!active || records.get(block) !== record || !block.isConnected || page !== documentKey()) return;
      const current = readParagraph(block);
      if (!current || current.key !== paragraph.key) { forget(block); if (nearby.has(block)) queue.add(block); return; }
      if (fragment.textContent?.trim() === current.text.trim()) return;
      record.paragraph = current;
      record.host = current.mount(fragment);
      record.host.lang = settings.defaultComprehensionLang;
      current.style(record.host,style);
    } catch (error) {
      if (active && records.get(block) === record) {
        record.failed = true;
        if (!warned) {
          warned = true;
          const code = error instanceof Error ? error.message : '';
          notice(code.startsWith('native-') ? '内置翻译不可用，可在翻译设置中准备语言模型' :
            code === 'no-key' ? '尚未配置 API key' : '翻译暂不可用',retry);
        }
      }
    } finally { running--; drain(); }
  }
  function drain() {
    if (!active || page !== documentKey()) return;
    const distance = (b:HTMLElement) => {
      const rect = b.getBoundingClientRect();
      return Math.max(0,rect.top-innerHeight,-rect.bottom);
    };
    if (running >= 3) return;
    const ready = [...queue].map(block => ({block,gap:distance(block)})).sort((a,b) => a.gap-b.gap);
    for (const {block} of ready) {
      if (running >= 3) break;
      queue.delete(block);
      if (!nearby.has(block) || records.has(block)) continue;
      const paragraph = readParagraph(block);
      if (paragraph) void translate(block,paragraph);
    }
  }
  const view = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const block = entry.target as HTMLElement;
      if (entry.isIntersecting && root.contains(block)) { nearby.add(block); queue.add(block); }
      else { nearby.delete(block); queue.delete(block); }
    }
    drain();
  },{rootMargin:'35% 0px'});
  function discover(node:Element) {
    if (node.matches(paragraphSelector)) view.observe(node);
    for (const block of node.querySelectorAll(paragraphSelector)) view.observe(block);
  }
  function flush() {
    frame = 0;
    if (documentKey() !== page) { end(); return; }
    const next = readingRoot();
    if (root !== next) { root = next; rootsToScan.add(root); }
    for (const block of records.keys()) {
      if (!root.contains(block)) { forget(block); nearby.delete(block); queue.delete(block); view.unobserve(block); }
    }
    for (const node of rootsToScan) if (root.contains(node) && !node.closest('pd-page-translation')) discover(node);
    rootsToScan.clear();
    for (const block of dirty) {
      const record = records.get(block);
      if (record && (record.paragraph.key !== readParagraph(block)?.key ||
          (record.host && !block.contains(record.host)))) forget(block);
      else if (record?.host && style === 'translated') record.paragraph.style(record.host,style);
      if (nearby.has(block) && !records.has(block)) queue.add(block);
    }
    dirty.clear();
    drain();
  }
  const mutations = new MutationObserver(changes => {
    for (const change of changes) {
      const target = change.target instanceof Element ? change.target : change.target.parentElement;
      if (!target || target.closest('pd-page-translation')) continue;
      if (change.type === 'attributes') {
        for (const block of records.keys()) if (target.contains(block)) dirty.add(block);
        for (const block of nearby) if (target.contains(block)) dirty.add(block);
      }
      for (let el = target.closest<HTMLElement>(paragraphSelector); el && root.contains(el); el = el.parentElement?.closest(paragraphSelector) ?? null) dirty.add(el);
      for (const node of change.addedNodes) if (node instanceof HTMLElement) rootsToScan.add(node);
    }
    if (!frame) frame = requestAnimationFrame(flush);
  });
  mutations.observe(document.body,{subtree:true,characterData:true,childList:true,attributes:true,attributeFilter:['href','lang','hidden','aria-hidden','contenteditable']});
  discover(root);
  function checkUrl() { if (page !== documentKey()) end(); }
  window.addEventListener('popstate',checkUrl);
  const navigation = (window as Window & {navigation?:EventTarget}).navigation;
  navigation?.addEventListener('currententrychange',checkUrl);
  function holdReadingPosition(change:()=>void) {
    let anchor:HTMLElement|undefined;
    let nearest = Infinity;
    for (const block of nearby) {
      if (!records.get(block)?.host || !block.isConnected) continue;
      const rect = block.getBoundingClientRect();
      const line = innerHeight / 3;
      const gap = Math.max(0,rect.top-line,line-rect.bottom);
      if (rect.bottom <= 0 || rect.top >= innerHeight || gap > nearest ||
          (gap === nearest && !anchor?.contains(block))) continue;
      nearest = gap;
      anchor = block;
    }
    const before = anchor?.getBoundingClientRect();
    change();
    if (anchor?.isConnected && before?.height) {
      const progress = Math.min(1,Math.max(0,(innerHeight/3-before.top)/before.height));
      const after = anchor.getBoundingClientRect();
      const delta = after.top-before.top + progress*(after.height-before.height);
      window.scrollBy({top:delta,behavior:'instant'});
    }
  }
  return {
    setStyle(next:Settings['pageTranslationStyle']) {
      if (next === style) return;
      style = next;
      holdReadingPosition(() => {
        for (const record of records.values()) if (record.host) record.paragraph.style(record.host,style);
      });
    },
    stop() {
      active = false;
      mutations.disconnect(); view.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener('popstate',checkUrl);
      navigation?.removeEventListener('currententrychange',checkUrl);
      for (const task of pending.values()) task.reject(new Error('aborted'));
      pending.clear(); port?.disconnect();
      holdReadingPosition(() => { for (const block of records.keys()) forget(block); });
    },
    settings,
  };
}

export function mountPageReading(notice:Notice) {
  let enabled = false;
  let version = 0;
  let session:ReturnType<typeof startReading> | undefined;
  function stop() { enabled = false; version++; session?.stop(); session = undefined; }
  async function refresh(force = false) {
    const revision = ++version;
    const result = await sendRuntime<GetSettingsResult>({type:'getSettings'});
    if (!enabled || revision !== version) return;
    if (!result?.ok) { stop(); notice('翻译暂不可用'); return; }
    const next = result.settings;
    if (session && session.settings.defaultComprehensionLang === next.defaultComprehensionLang &&
        session.settings.pageTranslationEngine === next.pageTranslationEngine &&
        !(force && next.pageTranslationEngine === 'ai')) { session.setStyle(next.pageTranslationStyle); return; }
    session?.stop();
    session = startReading(next,notice,stop);
  }
  browser.runtime.onMessage.addListener((msg,_sender,reply) => {
    if (msg?.type === 'page-translation-toggle') {
      if (enabled) stop();
      else { enabled = true; void refresh(); }
      reply({ok:true,enabled});
    } else if (enabled && (msg?.type === 'settings-changed' || msg?.type === 'ai-service-changed')) {
      void refresh(msg.type === 'ai-service-changed');
    }
  });
  window.addEventListener('pagehide',stop);
}
