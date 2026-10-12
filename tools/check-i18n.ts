import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { parseHTML } from 'linkedom';
import { UI_MESSAGES } from '../shared/uiMessages';
import {
  DISPLAY_LANGUAGES, AI_RESPONSE_LANGUAGES, resolveDisplayLocale, isDisplayLanguage,
  setDisplayLanguage, message, setText, localize, languageLabel, materialLabel, scopeLabel, translate,
} from '../shared/i18n';
import { buildChatMessages } from '../shared/chat';
import { comprehensionLangFor, DEFAULT_SETTINGS, validSetting } from '../shared/settings';
import { MAX_SELECTION_CHARS, selectionError } from '../shared/panel';

for(const [browserLanguage, expected] of [
  ['zh-CN','zh-Hans'],['zh-SG','zh-Hans'],['zh-TW','zh-Hant'],['zh-HK','zh-Hant'],
  ['zh-Hant','zh-Hant'],['en-GB','en'],['de-AT','de'],['fr-CA','fr'],['ja-JP','en'],
] as const) assert.equal(resolveDisplayLocale('auto',browserLanguage),expected);
for(const locale of DISPLAY_LANGUAGES) {
  assert.equal(resolveDisplayLocale(locale,'ja-JP'),locale);
  assert.ok(validSetting('displayLanguage',locale));
  const messages=buildChatMessages({responseLanguage:locale,snapshot:null,segment:null,question:'Explain this.',quote:null,history:[{question:'原来的问题',answer:'原来的回答',scopeLabel:'普通问答'}]});
  assert.ok(messages[0]!.content.includes(`Answer in ${AI_RESPONSE_LANGUAGES[locale]}.`));
  assert.ok(!messages[0]!.content.includes('英语学习助手'));
  assert.equal(messages[2]!.content,'原来的回答');
}
assert.ok(isDisplayLanguage('auto'));
for(const value of ['es','zh',null,42]) assert.equal(isDisplayLanguage(value),false);
assert.equal(comprehensionLangFor({...DEFAULT_SETTINGS,comprehensionOverrides:{'zh-Hans':'en'}},'zh-TW'),'en');
const germanSettings={...DEFAULT_SETTINGS,displayLanguage:'de' as const};
assert.equal(comprehensionLangFor(germanSettings,'en'),'zh-Hans');
assert.equal(validSetting('comprehensionOverrides',{en:'en'}),false);
assert.equal(selectionError(''),'empty-selection');
assert.equal(selectionError('a'.repeat(MAX_SELECTION_CHARS+1)),'selection-too-long');

for(const [key, translations] of Object.entries(UI_MESSAGES)) {
  assert.equal(translations.length,5,key);
  const placeholders=[...translations[0].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
  for(const text of translations) {
    assert.ok(text.trim(),key);
    assert.deepEqual([...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),placeholders,key);
  }
  for(const text of translations.slice(2)) assert.ok(!/\p{Script=Han}/u.test(text),`${key}: untranslated copy`);
}

const {document,window}=parseHTML('<html><body><button id="action"></button><textarea id="note">保留解释 {literal}</textarea><select id="choice"><option value="en" selected>English</option></select><details open><summary data-i18n="单独设置"></summary></details><aside></aside></body></html>');
Object.assign(globalThis,{ShadowRoot:window.ShadowRoot});
const note=document.querySelector<HTMLTextAreaElement>('#note')!;
const choice=document.querySelector<HTMLSelectElement>('#choice')!;
const action=document.querySelector<HTMLButtonElement>('#action')!;
action.disabled=true;
setText(action,message('无词典结果时自动使用 AI 查词'));
const shadow=document.querySelector('aside')!.attachShadow({mode:'open'});
shadow.innerHTML='<button data-i18n="添加到对话"></button><p></p>';
setText(shadow.querySelector('p')!,message('{label} · {count} 块',{label:materialLabel('词句与原句'),count:2}));
for(const locale of DISPLAY_LANGUAGES) {
  setDisplayLanguage(locale,'en');localize(document);localize(shadow);
  assert.equal(action.textContent,translate(locale,'无词典结果时自动使用 AI 查词'));
  assert.equal(shadow.querySelector('button')!.textContent,translate(locale,'添加到对话'));
  assert.equal(note.value,'保留解释 {literal}');assert.equal(choice.value,'en');assert.equal(action.disabled,true);
  assert.ok(document.querySelector('details')!.hasAttribute('open'));
}
const scope=scopeLabel('片段 2/3 · 段落 41–87');assert.ok(typeof scope!=='string');
assert.equal(translate('fr',scope.key,scope.values),'Partie 2/3 · Paragraphes 41–87');
assert.equal(materialLabel('Custom material title'),'Custom material title');
setText(action,'User content: 设置');setDisplayLanguage('de','en');localize(document);
assert.equal(action.textContent,'User content: 设置');
assert.equal(translate('en','焦点：{text}',{text:'{status} 原文'}),'Focus: {status} 原文');

// Catch missing keys before a rarely used error state reaches users.
function checkMarkup(file:string,html:string) {
  const fragment=parseHTML(html.includes('<html')?html:'<html><body>'+html+'</body></html>').document;
  for(const element of fragment.body.querySelectorAll('*')) {
    if(element.closest('style,script'))continue;
    for(const child of element.childNodes) if(child.nodeType===3&&/\p{Script=Han}/u.test(child.textContent??'')) assert.ok(element.hasAttribute('data-i18n'),`${file}: unbound text ${child.textContent}`);
    for(const attribute of ['title','aria-label','placeholder']) if(/\p{Script=Han}/u.test(element.getAttribute(attribute)??'')) assert.ok(element.hasAttribute(`data-i18n-${attribute}`),`${file}: unbound ${attribute} ${element.getAttribute(attribute)}`);
  }
  for(const tag of html.matchAll(/<[a-z][^>]*>/g)) {
    const attributes=[...tag[0].matchAll(/\s(data-i18n(?:-[a-z-]+)?)=/g)].map(match=>match[1]);
    assert.equal(new Set(attributes).size,attributes.length,`${file}: duplicate localization attribute`);
  }
}
for(const directory of ['entrypoints','shared','lib']) for(const path of readdirSync(directory,{recursive:true}) as string[]) {
  if(!/\.(ts|html)$/.test(path))continue;
  const file=`${directory}/${path}`,source=readFileSync(file,'utf8');
  for(const match of source.matchAll(/data-i18n(?:-(?:title|aria-label|placeholder))?="([^"$]+)"/g)) assert.ok(Object.hasOwn(UI_MESSAGES,match[1]!),`${file}: ${match[1]}`);
  if(!path.endsWith('.ts')){checkMarkup(file,source);continue;}
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  function visit(node: ts.Node) {
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&['ERROR_LABEL','vaultErrors'].includes(node.name.text)&&node.initializer&&ts.isObjectLiteralExpression(node.initializer)) {
      for(const property of node.initializer.properties) if(ts.isPropertyAssignment(property)&&ts.isStringLiteral(property.initializer)) assert.ok(Object.hasOwn(UI_MESSAGES,property.initializer.text),`${file}: ${property.initializer.text}`);
    }
    if(ts.isTemplateExpression(node)||ts.isNoSubstitutionTemplateLiteral(node)) {
      const html=ts.isTemplateExpression(node)?node.head.text+node.templateSpans.map(span=>'__dynamic__'+span.literal.text).join(''):node.text;
      if(/<(?:label|button|section|div|main|aside)\b/.test(html))checkMarkup(file,html);
    }
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['t','tr','message','translate'].includes(node.expression.text)) {
      const key=node.arguments[node.expression.text==='translate'?1:0];
      if(key&&ts.isStringLiteral(key)) assert.ok(Object.hasOwn(UI_MESSAGES,key.text),`${file}: ${key.text}`);
    }
    ts.forEachChild(node,visit);
  }
  visit(tree);
}
setDisplayLanguage('zh-Hans','en');
console.log(`i18n checks passed: ${DISPLAY_LANGUAGES.length} locales, ${Object.keys(UI_MESSAGES).length} messages, AI language, source rules and preserved UI state.`);
