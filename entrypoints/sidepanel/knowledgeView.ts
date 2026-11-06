import { iconButton, uiIcon } from '@/shared/uiControls';
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
  const summary = document.createElement('summary');
  const title = document.createElement('span'); title.className='knowledge-title';title.textContent=record.title;
  const caption = document.createElement('span'); caption.className='knowledge-origin';caption.textContent=record.source.title || record.source.url;
  const arrow=document.createElement('span');arrow.className='knowledge-expand';arrow.innerHTML=uiIcon('expand');
  summary.append(title,caption,arrow);row.append(summary);
  appendKnowledgeBody(row, record);
  const tools = document.createElement('div'); tools.className='entry-tools';
  const origin = document.createElement('a'); origin.className='ui-icon-button';origin.href=record.source.url;origin.target='_blank';origin.rel='noopener';origin.innerHTML=uiIcon('external');
  setLocalizedAttribute(origin,'title',message('打开来源'));
  setLocalizedAttribute(origin,'aria-label',message('打开来源'));
  const status = document.createElement('p'); status.className = 'hint'; status.setAttribute('role', 'status');
  const edit = iconButton('edit',message('编辑'));
  edit.onclick = () => { if (row.querySelector('form')) return; knowledgeEditor(row, record, async (title, body) => {
    const result = await send<{ok:boolean}>({type:'updateKnowledge',id:record.id,title,body,vaultId});
    if (!result?.ok) return false;
    queueMicrotask(changed); return true;
  }); };
  const remove = iconButton('trash',message('删除知识点'));
  remove.classList.add('ui-danger');
  const confirmRow = document.createElement('div'); confirmRow.className='knowledge-confirm';confirmRow.hidden=true;
  const cancel = document.createElement('button'); setText(cancel,message('取消'));
  const confirm = document.createElement('button'); setText(confirm,message('确认删除知识点'));
  const close = () => { confirmRow.hidden=true;remove.focus({preventScroll:true}); };
  remove.onclick = () => {confirmRow.hidden=false;cancel.focus({preventScroll:true});};
  cancel.onclick = close;
  confirmRow.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}});
  confirm.onclick = async () => {
    confirm.disabled = true;
    const result = await send<{ok:boolean}>({type:'deleteKnowledge',id:record.id,vaultId});
    if (result?.ok) changed(); else {confirm.disabled=false;setText(status,message('删除失败，请重试'));}
  };
  confirmRow.append(cancel,confirm);
  tools.append(origin,edit,remove);
  row.append(tools,confirmRow,status);
  return row;
}
