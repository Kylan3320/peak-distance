import { emptyChat, pruneChatSnapshots, refreshChatHistory, type ChatRecord, type ChatRecordView } from '@/shared/chat';
import { panelStateKey } from '@/shared/panel';
import { getChat, getDataVaultIdentity } from './db';

const edits = new Map<number, ChatRecordView>();
export const ownsChatEdit = (windowId: number, edit: ChatRecordView) => edits.get(windowId) === edit;
const operations = new Map<number, symbol>();
export const chatOperation = (windowId: number) => operations.get(windowId);
export function beginChatOperation(windowId: number): symbol {
  const operation = Symbol(); operations.set(windowId, operation); return operation;
}
const keyOf = (windowId: number) => `chat-edit:${windowId}`;

export async function readChatEdit(windowId: number): Promise<ChatRecordView> {
  const vaultId = (await getDataVaultIdentity())?.vaultId ?? null;
  const cached = edits.get(windowId);
  if (cached?.vaultId === vaultId) return cached;
  if (cached) await discardChatEdit(windowId);
  const operation = chatOperation(windowId) ?? beginChatOperation(windowId);
  const saved = (await browser.storage.session.get(keyOf(windowId)))[keyOf(windowId)] as ChatRecordView | undefined;
  const stored = saved?.vaultId === vaultId || !vaultId && saved?.vaultId === undefined ? saved : undefined;
  if (saved && !stored) await browser.storage.session.remove([keyOf(windowId), `chat-active:${windowId}`]);
  const committed = stored?.id ? await getChat(stored.id, () => true) : null;
  if (chatOperation(windowId) !== operation) return { ...emptyChat(), editId: crypto.randomUUID() };
  if (edits.has(windowId)) return edits.get(windowId)!;
  const edit = stored ?? { ...emptyChat(), editId: crypto.randomUUID(), vaultId };
  if (committed) refreshChatHistory(edit, committed);
  pruneChatSnapshots(edit);
  edits.set(windowId, edit);
  return edit;
}

function sessionEdit(edit: ChatRecordView): ChatRecordView {
  const committedVersions = new Set(edit.messages.filter(m => m.role === 'user').map(m => m.snapshotVersion));
  return { ...edit, messages: [], snapshots: edit.snapshots.filter(s => s.version === edit.activeSnapshotVersion && !committedVersions.has(s.version)) };
}

export async function writeChatEdit(windowId: number, edit: ChatRecordView): Promise<void> {
  if (!ownsChatEdit(windowId, edit)) throw Error('stale-edit');
  try { await browser.storage.session.set({ [keyOf(windowId)]: sessionEdit(edit) }); }
  catch (error) { if (edits.get(windowId) === edit) edits.delete(windowId); throw error; }
}

export function replaceChatEdit(windowId: number, record: ChatRecord | null): Promise<void> {
  return activateChatEdit(windowId, { ...(record ?? emptyChat()), draft: '', pendingQuote: null, editId: crypto.randomUUID() });
}

export async function activateChatEdit(windowId: number, record: ChatRecordView | null): Promise<void> {
  const operation = chatOperation(windowId);
  const vaultId = (await getDataVaultIdentity())?.vaultId ?? null;
  if (operation !== chatOperation(windowId) || record?.vaultId !== undefined && record.vaultId !== vaultId) throw Error('stale-edit');
  const edit = { ...(record ?? { ...emptyChat(), editId: crypto.randomUUID() }), vaultId };
  edits.set(windowId, edit);
  return browser.storage.session.set({ [keyOf(windowId)]: sessionEdit(edit), [`chat-active:${windowId}`]: edit.id });
}

export async function discardLibraryWorkspace(): Promise<void> {
  for (const windowId of operations.keys()) beginChatOperation(windowId);
  edits.clear();
  const stored = await browser.storage.session.get(null);
  await browser.storage.session.remove(Object.keys(stored).filter(key => /^(chat-edit|chat-active|chat-tab|panel-state|selection|panel-before-fullscreen):/.test(key)));
}

/** 真实关闭才丢弃；连接断开、隐藏或模式移交不调用。 */
export async function discardChatEdit(windowId: number): Promise<void> {
  const operation = beginChatOperation(windowId);
  edits.delete(windowId);
  await browser.storage.session.remove([keyOf(windowId), `chat-active:${windowId}`]);
  const key = panelStateKey(windowId);
  const state = (await browser.storage.session.get(key))[key];
  if (state && chatOperation(windowId) === operation) await browser.storage.session.set({ [key]: { ...state, chat: undefined } });
}

export async function removeChatWindow(windowId: number): Promise<void> {
  edits.delete(windowId);
  operations.delete(windowId);
  await browser.storage.session.remove([keyOf(windowId), `chat-active:${windowId}`, panelStateKey(windowId),
    `panel-host:${windowId}`, `panel-native-transfer:${windowId}`, `selection:${windowId}`, `chat-tab:${windowId}`]);
}
