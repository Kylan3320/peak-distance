import { message, setText, setLocalizedAttribute } from '@/shared/i18n';
import type { KnowledgeRecord } from '@/shared/knowledge';

export function knowledgeEditor(parent: HTMLElement, initial: { title: string; body: string }, commit: (title: string, body: string) => Promise<boolean>) {
  const form = document.createElement('form'); form.className = 'knowledge-editor';
  const title = document.createElement('input'); title.value = initial.title; title.maxLength = 4000;
  const body = document.createElement('textarea'); body.value = initial.body; body.rows = 9; body.maxLength = 200000;
  setLocalizedAttribute(title, 'aria-label', message('知识点标题'));
  setLocalizedAttribute(body, 'aria-label', message('知识点正文'));
  const titleLabel = document.createElement('label'),titleCaption=document.createElement('span'); setText(titleCaption, message('知识点标题')); titleLabel.append(titleCaption,title);
  const bodyLabel = document.createElement('label'),bodyCaption=document.createElement('span'); setText(bodyCaption, message('知识点正文')); bodyLabel.append(bodyCaption,body);
  const save = document.createElement('button'); save.type = 'submit'; save.className = 'primary'; setText(save, message('保存知识点'));
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'ghost'; setText(cancel, message('取消'));
  const state = document.createElement('p'); state.className = 'hint'; state.setAttribute('role', 'status');
  cancel.onclick = () => form.remove();
  form.onsubmit = async e => {
    e.preventDefault();
    if (!title.value.trim() || !body.value.trim()) { setText(state, message('标题和正文不能为空')); return; }
    save.disabled = true; cancel.disabled = true;
    try { if (await commit(title.value, body.value)) form.remove(); else setText(state, message('保存失败，请重试')); }
    finally { save.disabled = false; cancel.disabled = false; }
  };
  form.append(titleLabel, bodyLabel, save, cancel, state); parent.append(form); title.focus();
  return form;
}

export function appendKnowledgeBody(parent: HTMLElement, record: KnowledgeRecord) {
  const body = document.createElement('div'); body.className = 'knowledge-body'; body.textContent = record.body; parent.append(body);
  for (const quote of record.quotes) {
    const block = document.createElement('blockquote'); block.textContent = `[${quote.id}] ${quote.text}`; parent.append(block);
  }
}

export function knowledgeRow(record: KnowledgeRecord, vaultId: string | null, send: <T>(message: unknown) => Promise<T>, changed: () => void): HTMLDetailsElement {
  const row = document.createElement('details'); row.className = 'knowledge-row'; row.dataset.id = record.id;
  const summary = document.createElement('summary'); summary.textContent = record.title; row.append(summary);
  const origin = document.createElement('a'); origin.className = 'source'; origin.href = record.source.url; origin.target = '_blank'; origin.rel = 'noopener'; origin.textContent = record.source.title || record.source.url; row.append(origin);
  appendKnowledgeBody(row, record);
  const status = document.createElement('p'); status.className = 'hint'; status.setAttribute('role', 'status');
  const edit = document.createElement('button'); edit.className = 'ghost'; setText(edit, message('编辑'));
  edit.onclick = () => { if (row.querySelector('form')) return; knowledgeEditor(row, record, async (title, body) => {
    const result = await send<{ok:boolean}>({type:'updateKnowledge',id:record.id,title,body,vaultId});
    if (!result?.ok) return false;
    queueMicrotask(changed); return true;
  }); };
  const remove = document.createElement('button'); remove.className = 'ghost'; setText(remove, message('删除知识点'));
  remove.onclick = async () => {
    if (remove.dataset.confirm !== 'yes') { remove.dataset.confirm = 'yes'; setText(remove, message('确认删除知识点')); return; }
    remove.disabled = true;
    const result = await send<{ok:boolean}>({type:'deleteKnowledge',id:record.id,vaultId});
    if (result?.ok) changed(); else {remove.disabled=false;setText(status,message('删除失败，请重试'));}
  };
  row.append(edit,remove,status); return row;
}
