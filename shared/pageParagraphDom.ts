import { isLanguageTag, normalizeLangTag } from './languages';
import type { Settings } from './settings';

// Each candidate owns its direct prose, never the text of a nested paragraph.
export const paragraphSelector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,dt,dd,figcaption,div,section,article,main';
const hostTag = 'pd-page-translation';
const wrappedSources = new WeakMap<HTMLElement,Set<HTMLElement>>();
const sourceWrappers = new WeakSet<HTMLElement>();
const skip = [
  'nav,footer,aside,dialog,form,button,input,select,textarea,label,pre,script,style,noscript,template',
  '[contenteditable]:not([contenteditable="false"]),[hidden],[inert],[aria-hidden="true"]',
  '[role="navigation"],[role="toolbar"],[role="menu"],[role="banner"],[role="contentinfo"],[role="dialog"],[role="button"]',
  '[translate="no"],.notranslate,[data-ad],.advertisement,[data-ad-slot]',
  '[data-blc-skip],#pd-floating-panel,#pd-translation,#blc-lookup-popup,#blc-lookup-pill',
].join(',');
const inline = 'a,abbr,b,bdi,bdo,br,cite,code,data,del,dfn,em,font,i,ins,kbd,mark,q,rp,rt,ruby,s,samp,small,span,strong,sub,sup,time,u,var,wbr';
const formatted = 'a[href],b,strong,i,em,sub,sup,del,s,u,code,kbd,samp';
const literal = 'code,kbd,samp';
const compact = (text: string) => text.replace(/\s+/gu, ' ').trim();
type Style = Settings['pageTranslationStyle'];
const replacementVersions = new WeakMap<DocumentFragment,DocumentFragment>();
const hostVersions = new WeakMap<HTMLElement,{parallel:Node[]; translated:Node[]}>();
let activeHosts = 0;
let sheet: CSSStyleSheet | undefined;

function isVisibleInline(node: HTMLElement) {
  if (sourceWrappers.has(node)) return true;
  const style = getComputedStyle(node);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
}

function ownNodes(block: HTMLElement): Node[] {
  return Array.from(block.childNodes).filter(node => {
    if (node instanceof Text) return true;
    if (!(node instanceof HTMLElement) || node.matches(skip)) return false;
    if (sourceWrappers.has(node)) return true;
    return node.matches(inline) && isVisibleInline(node) &&
      !node.querySelector(paragraphSelector + ',img,video,button,input,select,textarea');
  });
}

function hideSource(block: HTMLElement) {
  const owned = wrappedSources.get(block) ?? new Set();
  wrappedSources.set(block,owned);
  function wrap(parent:HTMLElement) {
    let wrapper: HTMLSpanElement | undefined;
    for (const node of ownNodes(parent)) {
      if (node instanceof HTMLElement && sourceWrappers.has(node)) { wrapper = undefined; continue; }
      if (node instanceof HTMLElement && node.querySelector('pd-page-translation,[data-pd-original]')) {
        wrap(node);
        wrapper = undefined;
        continue;
      }
      if (!wrapper || wrapper.nextSibling !== node) {
        wrapper = document.createElement('span');
        wrapper.setAttribute('data-pd-original', '');
        wrapper.style.setProperty('display', 'none', 'important');
        parent.insertBefore(wrapper, node);
        owned.add(wrapper);
        sourceWrappers.add(wrapper);
      }
      wrapper.append(node);
    }
  }
  wrap(block);
}

function restoreSource(block: HTMLElement) {
  const owned = wrappedSources.get(block);
  if (!owned) return;
  for (const wrapper of owned) {
    sourceWrappers.delete(wrapper);
    if (wrapper.parentNode) wrapper.replaceWith(...wrapper.childNodes);
    else {
      wrapper.removeAttribute('data-pd-original');
      wrapper.style.removeProperty('display');
    }
  }
  wrappedSources.delete(block);
}

function styleHost(block: HTMLElement, host: HTMLElement, mode: Style) {
  if (mode === 'translated') hideSource(block);
  else restoreSource(block);
  const versions = hostVersions.get(host);
  if (versions) {
    const nodes = mode === 'translated' ? versions.translated : versions.parallel;
    if (host.firstChild !== nodes[0]) host.replaceChildren(...nodes);
  }
  host.dataset.mode = mode;
  host.style.display = mode === 'translated' ? 'inline' : 'block';
  host.style.marginBlockStart = mode === 'translated' ? '0' : '.35em';
  if (mode === 'frost') host.tabIndex = 0;
  else host.removeAttribute('tabindex');
}

// Preserve only semantics. Never let translator output create HTML, URLs, handlers or attributes.
function shell(source: HTMLElement): HTMLElement {
  const el = document.createElement(source.localName);
  if (source instanceof HTMLAnchorElement && el instanceof HTMLAnchorElement) {
    for (const name of ['href','target','rel','download','hreflang','referrerpolicy']) {
      const value = source.getAttribute(name);
      if (value !== null) el.setAttribute(name, value);
    }
  }
  return el;
}

interface Piece { el: HTMLElement; parts: Part[]; }
type Part = string | Piece;
const plain = (parts: Part[]): string => parts.map(p => typeof p === 'string' ? p : plain(p.parts)).join('');

function collect(nodes: Iterable<Node>): Part[] {
  const parts: Part[] = [];
  for (const node of nodes) {
    if (node instanceof Text) parts.push(node.data);
    else if (node instanceof HTMLElement && !node.matches(skip) && isVisibleInline(node)) {
      if (node.localName === 'br') parts.push('\n');
      else {
        const children = collect(node.childNodes);
        if (node.matches(formatted) && plain(children).trim()) parts.push({el:node, parts:children});
        else parts.push(...children);
      }
    }
  }
  // Site syntax highlighters and our vocabulary marks may divide one word into several nodes.
  const merged: Part[] = [];
  for (const part of parts) {
    if (typeof part === 'string' && typeof merged.at(-1) === 'string') merged[merged.length - 1] += part;
    else merged.push(part);
  }
  return merged;
}

function encode(parts: Part[], templates: HTMLElement[]): string {
  return parts.map(p => {
    if (typeof p === 'string') return p;
    const id = templates.push(p.el);
    return '⟦' + id + '⟧' + encode(p.parts, templates) + '⟦/' + id + '⟧';
  }).join('');
}

function decode(translated: string, templates: HTMLElement[]): DocumentFragment | null {
  const fragment = document.createDocumentFragment();
  const stack: {id: number; parent: DocumentFragment | HTMLElement}[] = [{id:0,parent:fragment}];
  const seen = new Set<number>();
  let from = 0;
  for (const marker of translated.matchAll(/⟦\s*(\/?)\s*(\d+)\s*⟧/gu)) {
    const current = stack.at(-1)!;
    current.parent.append(translated.slice(from,marker.index));
    const id = Number(marker[2]), el = templates[id - 1];
    if (!el) return null;
    if (marker[1]) {
      if (current.id !== id) return null;
      if (el.matches(literal)) current.parent.replaceChildren(el.textContent ?? '');
      stack.pop();
    } else {
      if (seen.has(id)) return null;
      seen.add(id);
      const copy = shell(el);
      current.parent.append(copy);
      stack.push({id,parent:copy});
    }
    from = marker.index + marker[0].length;
  }
  if (stack.length !== 1 || seen.size !== templates.length) return null;
  fragment.append(translated.slice(from));
  return fragment;
}

// A text-only engine may discard the boundaries. Keep its complete, unmarked paragraph
// translation; link-label queries locate the target span, never supply surrounding prose.
async function alignTranslation(parts:Part[], text: string, templates: HTMLElement[], request: (text: string) => Promise<string>) {
  const translation = await request(text);
  const ranges: {start:number; end:number; element:HTMLElement}[] = [];
  const fragment = document.createDocumentFragment();
  const labels = new Map<HTMLElement,string>();
  let missingLink = false;
  function add(label: string, element: HTMLElement) {
    if (!label) return false;
    const start = translation.indexOf(label), end = start + label.length;
    if (start < 0 || translation.indexOf(label,start + 1) >= 0 || ranges.some(r => r.start < end && start < r.end)) return false;
    ranges.push({start,end,element});
    return true;
  }
  for (const el of [...templates].sort((a,b) => Number(b.matches('a')) - Number(a.matches('a')))) {
    const label = compact(plain(collect(el.childNodes)));
    const candidate = label === text ? translation : label;
    if (add(candidate,el)) { labels.set(el,candidate); continue; }
    if (el.matches('a')) {
      const translatedLabel = /\p{L}/u.test(label) ? (await request(label)).trim() : label;
      labels.set(el,translatedLabel);
      if (!add(translatedLabel,el)) missingLink = true;
    }
  }
  let start = 0;
  for (const range of ranges.sort((a,b) => a.start - b.start)) {
    const el = shell(range.element);
    el.textContent = translation.slice(range.start,range.end);
    fragment.append(translation.slice(start,range.start),el);
    start = range.end;
  }
  fragment.append(translation.slice(start));
  if (missingLink) {
    const linked = await restoreLinkSlots(parts,labels,request,text + translation);
    replacementVersions.set(fragment,linked);
  }
  return fragment;
}

// A number is understood by text-only engines without an HTML/markup contract.
// Exclude existing numeric text and require exactly one recoverable slot per link.
const digitForms = ['0０〇零','1１一','2２二','3３三','4４四','5５五','6６六','7７七','8８八','9９九'];
function numberPattern(value:string) {
  const digits = value.split('').map((digit,i) =>
    (i && (value.length - i) % 3 === 0 ? '[,，.．\\u00a0\\u202f ]?' : '') + '[' + digitForms[Number(digit)] + ']');
  return new RegExp('(?<![0-9０-９])' + digits.join('') + '(?![0-9０-９])','gu');
}
async function restoreLinkSlots(parts:Part[], labels:Map<HTMLElement,string>, request:(s:string)=>Promise<string>, existing:string) {
  const runs:(string|HTMLElement)[] = [];
  function visit(children:Part[]) {
    for (const p of children) {
      if (typeof p === 'string') {
        if (typeof runs.at(-1) === 'string') runs[runs.length - 1] += p;
        else runs.push(p);
      } else if (p.el.matches('a')) runs.push(p.el);
      else visit(p.parts);
    }
  }
  visit(parts);
  const slots = new Map<string,HTMLElement>();
  let number = 916731;
  const encoded = runs.map(run => {
    if (typeof run === 'string') return run;
    while (numberPattern(String(number)).test(existing)) number++;
    const slot = String(number++);
    slots.set(slot,run);
    return ' ' + slot + ' ';
  }).join('');
  const translated = await request(compact(encoded));
  const hits:{start:number; end:number; anchor:HTMLElement}[] = [];
  for (const [slot,anchor] of slots) {
    const matches = [...translated.matchAll(numberPattern(slot))];
    if (matches.length === 1) hits.push({start:matches[0]!.index,end:matches[0]!.index + matches[0]![0].length,anchor});
  }
  const linked = document.createDocumentFragment();
  function appendLink(anchor:HTMLElement) {
    const copy = shell(anchor);
    copy.textContent = labels.get(anchor) ?? anchor.textContent;
    linked.append(copy);
  }
  if (hits.length === slots.size) {
    let from = 0;
    for (const hit of hits.sort((a,b)=>a.start - b.start)) {
      linked.append(translated.slice(from,hit.start));
      appendLink(hit.anchor);
      from = hit.end;
    }
    linked.append(translated.slice(from));
  } else {
    // Both markup and numeric anchors were lost. The bilingual modes already
    // have fluent prose and original links. Only the in-place version needs
    // separate link boundaries to remain navigable on such an engine.
    for (const run of runs) {
      if (typeof run !== 'string') { appendLink(run); continue; }
      const content = run.trim();
      if (!/\p{L}/u.test(content)) linked.append(run);
      else linked.append(run.slice(0,run.indexOf(content)),await request(content),run.slice(run.indexOf(content) + content.length));
    }
  }
  return linked;
}

export function readParagraph(block: HTMLElement) {
  if (block.closest(skip) || block.closest('header:not(article header,main header)') || !block.checkVisibility({visibilityProperty:true})) return null;
  const parts = collect(ownNodes(block));
  const text = compact(plain(parts));
  if (!/\p{L}/u.test(text)) return null;
  const templates: HTMLElement[] = [];
  const input = compact(encode(parts,templates));
  const lang = block.closest('[lang]')?.getAttribute('lang');
  const source = isLanguageTag(lang) && lang !== 'und' ? normalizeLangTag(lang) : 'auto';
  const key = JSON.stringify([source,input,templates.map(el => [el.localName,el.getAttribute('href'),el.getAttribute('target')])]);
  return {
    key, source, text,
    async translate(request: (text: string) => Promise<string>) {
      if (!templates.length) {
        const fragment = document.createDocumentFragment();
        fragment.append(await request(text));
        return fragment;
      }
      const result = await request(input);
      return decode(result, templates) ?? await alignTranslation(parts,text,templates,request);
    },
    mount(fragment: DocumentFragment) {
      const host = document.createElement(hostTag);
      const linked = replacementVersions.get(fragment);
      if (linked) hostVersions.set(host,{parallel:[...fragment.childNodes],translated:[...linked.childNodes]});
      if (!activeHosts++) {
        sheet ??= new CSSStyleSheet();
        sheet.replaceSync('pd-page-translation[data-mode="frost"]:not(:hover,:focus-within){filter:blur(.26em)!important}');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets,sheet];
      }
      host.setAttribute('data-blc-skip', '');
      host.dir = 'auto';
      host.append(fragment);
      const nodes = ownNodes(block);
      const last = nodes.findLast(node => node instanceof HTMLElement || node.textContent?.trim());
      block.insertBefore(host, last ? last.nextSibling : null);
      return host;
    },
    style(host: HTMLElement, mode: Style) {
      styleHost(block, host, mode);
    },
    remove(host: HTMLElement) {
      restoreSource(block);
      host.remove();
      if (!--activeHosts) document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== sheet);
    },
  };
}
