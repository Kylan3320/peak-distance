// M11 学习库同步编排：首次导入、待写入提交、读回合并、断开。
// 被 entrypoints/background.ts 调用（唯一入口）；文件操作在 ./fs.ts，
// 三方合并在 ./format.ts 的 mergeVocabRecord，队列与快照在 lib/db.ts。
//
// 合并语义（spec 4.4）：base = 上次确认的共享文件；无 base 时不猜共同祖先。
// 冲突不丢数据：保留本地，
// 冲突详情存 vault store（conflict:<id>），由 UI 呈现处理选项。

import {
  ensurePermission,
  ensureVault,
  migrateVaultCollections,
  editCollection,
  deleteChatFromVault,
  parseChatDocument,
  parseMaterialDocument,
  readPreferenceFromVault,
  scanVault,
  writeChatToVault,
  writePreferenceToVault,
  type VaultFileScan,
} from './fs';
import type { VaultChatRecord } from '@/shared/vault';
import { vaultRecordJson, vaultErrorCode, type VaultError } from '@/shared/vault';
import type { ChatRecord, MaterialSnapshotRecord } from '@/shared/chat';
import { mergeVocabRecord, mergePreferenceRecord } from './format';
import {
  clearVault,
  clearChat,
  deleteEntry,
  deleteSentence,
  deleteSyncSnapshot,
  enqueueVaultWrite,
  getSyncSnapshot,
  getVaultHandle,
  getVaultIdentity,
  getDataVaultIdentity,
  getVaultStatus,
  getVaultRaw,
  importVaultEntry,
  listEntries,
  getChat,
  listChats,
  listSentences,
  listSyncSnapshotIds,
  upsertChatRecordFromVault,
  listVaultQueue,
  markVaultWriteAttempt,
  putVaultRaw,
  removeVaultWrite,
  setSyncSnapshot,
  setVaultIdentity,
  upsertVaultSentence,
} from '@/lib/db';
import type {
  VaultConflictRecord,
  VaultSentenceRecord,
  VaultStatus,
  VaultVocabRecord,
  VaultPreferenceRecord,
  VaultPendingWrite,
} from '@/shared/vault';
import { entryViewToVaultRecord, sentenceToVaultRecord, vaultRecordToEntry } from './records';
import { DEFAULT_SETTINGS, validSetting } from '@/shared/settings';
import { mergeKnowledge, type KnowledgeRecord } from '@/shared/knowledge';
import { deleteKnowledge, listKnowledge, upsertVaultKnowledge } from '@/lib/db';

type DirHandle = Parameters<typeof ensureVault>[0];

// One worker must not read/replace the same collection in overlapping save and sync operations.
let vaultOperation: Promise<unknown> = Promise.resolve();
function runVaultOperation<T>(task: () => Promise<T>): Promise<T> {
  const operation = vaultOperation.then(task);
  vaultOperation = operation.catch(() => {});
  return operation;
}

function storageLocal(): {
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
} {
  return browser.storage.local as unknown as ReturnType<typeof storageLocal>;
}

// ---- 待写入提交 -------------------------------------------------------------------

export interface FlushResult {
  committed: number;
  failed: number;
  skipped: number;
  error?: VaultError;
}

export const flushVaultWrites = (): Promise<FlushResult> => runVaultOperation(flushPendingWrites);

async function flushCollectionWrites(handle: DirHandle, queue: VaultPendingWrite[]): Promise<FlushResult> {
  const result: FlushResult = { committed:0, failed:0, skipped:0 };
  const fail = async (write: VaultPendingWrite, error: unknown) => {
    await markVaultWriteAttempt(write, String((error as Error)?.message ?? error));
    result.failed++;
    result.error = vaultErrorCode(error);
  };
  for (const kind of ['vocab', 'sentence', 'knowledge'] as const) {
    const writes = queue.filter(w => w.vaultId && w.kind === kind);
    if (!writes.length) continue;
    let edit: Awaited<ReturnType<typeof editCollection>>;
    try { edit = await editCollection(handle, kind); }
    catch (error) { for (const write of writes) await fail(write, error); continue; }
    const staged: { write: VaultPendingWrite; record: VaultVocabRecord | VaultSentenceRecord | KnowledgeRecord | null }[] = [];
    for (const write of writes) {
      try {
        let record = write.payload as VaultVocabRecord | VaultSentenceRecord | KnowledgeRecord | null;
        if (kind === 'knowledge') {
          const key = `knowledge:${write.recordId}`;
          const previous = edit.knowledge(write.recordId);
          const baseRaw = await getSyncSnapshot(key);
          const base = baseRaw ? JSON.parse(baseRaw) as KnowledgeRecord : null;
          if (edit.deletedKnowledge.includes(write.recordId)) {
            if(write.payload)await markVaultWriteAttempt(write,'conflict: deleted knowledge');
            await removeVaultWrite(write);
            if (await deleteKnowledge(write.recordId, false, write.payload as KnowledgeRecord | null)) await deleteSyncSnapshot(key);
            if(write.payload) {
              await putVaultRaw(`conflict:${key}`, { kind, recordId:write.recordId, local:write.payload, remote:null });
              result.failed++;result.error='conflict';
            }
            continue;
          }
          const outcome = record && previous ? mergeKnowledge(base, record as KnowledgeRecord, previous) : null;
          if (outcome?.kind === 'conflict' || record === null && previous && vaultRecordJson(previous) !== vaultRecordJson(base)
            || record && !previous && base) {
            await putVaultRaw(`conflict:${key}`, { kind, recordId: write.recordId, local: record, remote: previous, fields: outcome?.kind === 'conflict' ? outcome.fields : [] });
            await fail(write, new Error('conflict: knowledge changed')); continue;
          }
          if (outcome?.kind === 'merged') record = outcome.value;
        }
        if (record === null) edit.delete(write.recordId);
        else {
          if (kind === 'vocab') {
            const previous = edit.vocab(record.id);
            if (previous) {
              const base = await getSyncSnapshot(record.id);
              const outcome = mergeVocabRecord(base ? JSON.parse(base) : null, record as VaultVocabRecord, previous);
              if (outcome.kind === 'conflict') {
                await putVaultRaw(`conflict:${record.id}`, {
                  kind, recordId:record.id, local:record, remote:previous,
                  fields:outcome.fields.map(f => ({field:f.field,local:f.local,remote:f.file})),
                });
                await fail(write, new Error('conflict: vocabulary changed'));
                continue;
              }
              record = outcome.value;
            }
          }
          edit.set(record);
        }
        staged.push({ write, record });
      } catch (error) { await fail(write, error); }
    }
    if (!staged.length) continue;
    try { await edit.commit(); }
    catch (error) { for (const { write } of staged) await fail(write, error); continue; }
    for (const { write, record } of staged) {
      try {
        const id = kind === 'vocab' ? write.recordId : `${kind}:${write.recordId}`;
        if (record === null) await deleteSyncSnapshot(id);
        else {
          if (kind === 'vocab') {
            const vocab = record as VaultVocabRecord;
            const { entry, contexts } = vaultRecordToEntry(vocab, vocab.note ?? '');
            await importVaultEntry(entry, contexts, write.payload as VaultVocabRecord, write);
          } else if (kind === 'knowledge') {
            await upsertVaultKnowledge(record as KnowledgeRecord, write.payload as KnowledgeRecord, write);
          }
          await setSyncSnapshot(id, vaultRecordJson(record));
        }
        await removeVaultWrite(write);
        await markVaultWriteAttempt(write);
        result.committed++;
      } catch (error) { await fail(write, error); }
    }
  }
  return result;
}

async function flushPendingWrites(): Promise<FlushResult> {
  const handle = (await getVaultHandle()) as DirHandle | null;
  if (!handle) return { committed: 0, failed: 0, skipped: 0, error: 'not-connected' };
  const perm = await ensurePermission(handle);
  if (perm === 'granted' && (await ensureVault(handle)).vaultId !== (await getVaultIdentity())?.vaultId) return { committed: 0, failed: 0, skipped: 0, error: 'conflict' };
  const queue = await listVaultQueue(true);
  if (perm !== 'granted') {
    for (const w of queue) await markVaultWriteAttempt(w, 'no-permission');
    return { committed: 0, failed: queue.length, skipped: 0, error: 'no-permission' };
  }
  await migrateVaultCollections(handle);
  const collections = await flushCollectionWrites(handle, queue);
  let { committed, failed, skipped, error } = collections;
  const unbound = queue.filter(w => !w.vaultId).length;
  failed += unbound;
  error ??= unbound ? 'conflict' : undefined;
  for (const w of queue.filter(w => w.vaultId && w.kind !== 'vocab' && w.kind !== 'sentence' && w.kind !== 'knowledge')) {
    try {
      if (w.payload === null && w.kind === 'chat') {
        const base = await getSyncSnapshot(`chat:${w.recordId}`);
        const result = await deleteChatFromVault(handle, w.recordId, base ? JSON.parse(base) : null);
        if (result) {
          await putVaultRaw(`conflict:chat:${w.recordId}`, { kind: 'chat', recordId: w.recordId, local: null, remote: result.conflict });
          await markVaultWriteAttempt(w, 'conflict'); failed++; error = 'conflict'; continue;
        }
        await deleteSyncSnapshot(`chat:${w.recordId}`);
      } else if (w.kind === 'preference') {
        const local = w.payload as VaultPreferenceRecord;
        if (vaultRecordJson(await readLocalPreference()) !== vaultRecordJson(local)) { await removeVaultWrite(w); skipped++; continue; }
        const file = await readPreferenceFromVault(handle);
        const base = await getSyncSnapshot('preference:main');
        const outcome = file ? mergePreferenceRecord(base ? JSON.parse(base) : null, local, file) : { kind: 'merged' as const, value: local };
        if (outcome.kind === 'conflict') {
          await putVaultRaw('conflict:preference', { kind: 'preference', recordId: 'preference', local, remote: file, fields: outcome.fields });
          await markVaultWriteAttempt(w, 'conflict'); failed++; error = 'conflict'; continue;
        }
        await writePreferenceToVault(handle, outcome.value);
        await setSyncSnapshot('preference:main', vaultRecordJson(outcome.value));
        const now = await readLocalPreference();
        if (vaultRecordJson(now) === vaultRecordJson(local)) await storageLocal().set({ ...outcome.value });
      } else if (w.kind === 'chat') {
        const record = w.payload as VaultChatRecord;
        const base = await getSyncSnapshot(`chat:${record.id}`);
        const result = await writeChatToVault(handle, record, base ? JSON.parse(base) : null);
        if (result) {
          await putVaultRaw(`conflict:chat:${record.id}`, { kind:'chat', recordId:record.id, local:record, remote:result.conflict });
          await markVaultWriteAttempt(w, 'conflict'); failed++; error = 'conflict'; continue;
        }
        await setSyncSnapshot(`chat:${record.id}`, vaultRecordJson(record));
      } else {
        skipped++;
        continue;
      }
      await removeVaultWrite(w);
      await markVaultWriteAttempt(w);
      committed++;
    } catch (e) {
      const message = String((e as Error)?.message ?? e);
      await markVaultWriteAttempt(w, message);
      error = vaultErrorCode(e);
      failed++;
    }
  }
  return { committed, failed, skipped, ...(error ? { error } : {}) };
}

/** 本机保存成功后的入队（幂等键 = kind:recordId，后写覆盖先写）。 */
export async function enqueueKnowledgeWrite(record: KnowledgeRecord): Promise<void> {
  await enqueueVaultWrite({ id: `knowledge:${record.id}`, kind: 'knowledge', recordId: record.id, payload: record, queuedAt: Date.now() });
}

export async function enqueueVocabWrite(record: VaultVocabRecord): Promise<void> {
  await enqueueVaultWrite({
    id: `vocab:${record.id}`,
    kind: 'vocab',
    recordId: record.id,
    payload: record,
    queuedAt: Date.now(),
  });
}

export async function enqueueSentenceWrite(record: VaultSentenceRecord): Promise<void> {
  await enqueueVaultWrite({
    id: `sentence:${record.id}`,
    kind: 'sentence',
    recordId: record.id,
    payload: record,
    queuedAt: Date.now(),
  });
}

/** 会话写入排队（终态后调用；streaming 中间态不写文件）。 */
export async function enqueueChatWrite(record: ChatRecord): Promise<void> {
  const { draft: _draft, pendingQuote: _pq, ...vaultRecord } = record;
  await enqueueVaultWrite({
    id: `chat:${record.id}`,
    kind: 'chat',
    recordId: record.id,
    payload: vaultRecord as VaultChatRecord,
    queuedAt: Date.now(),
  });
}

// ---- 读回合并 ---------------------------------------------------------------------

export interface SyncResult {
  updated: number;
  deleted: number;
  conflicts: number;
  broken: number;
}

type VaultSyncResult = SyncResult & { error?: FlushResult['error'] };
export const syncFromVault = (): Promise<VaultSyncResult> => runVaultOperation(readVaultChanges);

async function readVaultChanges(): Promise<VaultSyncResult> {
  const handle = (await getVaultHandle()) as DirHandle | null;
  if (!handle) return { updated: 0, deleted: 0, conflicts: 0, broken: 0, error: 'not-connected' };
  const perm = await ensurePermission(handle);
  if (perm !== 'granted') return { updated: 0, deleted: 0, conflicts: 0, broken: 0, error: 'no-permission' };
  if ((await ensureVault(handle)).vaultId !== (await getVaultIdentity())?.vaultId) return { updated: 0, deleted: 0, conflicts: 0, broken: 0, error: 'conflict' };

  await migrateVaultCollections(handle);
  const scan: VaultFileScan = await scanVault(handle);
  const local = await listEntries();
  const localByKey = new Map(local.map((e) => [e.key, e]));
  const pending = await listVaultQueue();
  const pendingKeys = new Set(pending.map(write => `${write.kind}:${write.recordId}`));
  const seen = new Set<string>();
  let updated = 0;
  let conflicts = pending.filter(write => write.lastError === 'conflict' || write.lastError?.startsWith('conflict:')).length;

  for (const { record, note } of scan.vocab) {
    seen.add(record.id);
    if (pendingKeys.has(`vocab:${record.id}`)) continue;
    const localEntry = localByKey.get(record.id);
    const baseRaw = await getSyncSnapshot(record.id);
    const base = baseRaw ? (JSON.parse(baseRaw) as VaultVocabRecord & { note?: string }) : null;
    if (!localEntry) {
      // 其它浏览器 / Obsidian 新增：导入本地
      const { entry, contexts } = vaultRecordToEntry(record, note);
      if (!await importVaultEntry(entry, contexts, null)) continue;
      await setSyncSnapshot(record.id, vaultRecordJson({ ...record, note }));
      updated++;
      continue;
    }
    const localRecord = entryViewToVaultRecord(localEntry);
    const fileRecord: VaultVocabRecord & { note?: string } = { ...record, note };
    // 未确认共同文件时保留标量差异为冲突，不能把另一浏览器的选择当成覆盖依据。
    const outcome = mergeVocabRecord(base, localRecord, fileRecord);
    if (outcome.kind === 'conflict') {
      const conflict: VaultConflictRecord = {
        kind: 'vocab',
        recordId: record.id,
        fields: outcome.fields.map((f) => ({
          field: f.field,
          local: f.local,
          remote: f.file,
        })),
        local: localRecord,
        remote: fileRecord,
      };
      await putVaultRaw(`conflict:${record.id}`, conflict);
      conflicts++;
      continue; // 保留本地，待用户处理；不丢任何一方
    }
    const mergedNote = (outcome.value as { note?: string }).note ?? '';
    const { entry, contexts } = vaultRecordToEntry(outcome.value, mergedNote);
    if (vaultRecordJson(localRecord) !== vaultRecordJson(outcome.value)) {
      if (!await importVaultEntry(entry, contexts, localRecord)) continue;
      updated++;
    }
    await setSyncSnapshot(record.id, vaultRecordJson(fileRecord));
    await putVaultRaw(`conflict:${record.id}`, null);
  }

  // 删除检测：有同步快照但库中不再存在该 ID（移动保留同 ID，不会误判）。
  // 本轮有文件读取失败（权限瞬断 / IO）时扫描不完整，跳过删除检测（下次 vaultSync 重试），
  // 避免读取失败的词条被当成“文件已删”而误删本地词条与全部上下文。
  let deleted = 0;
  const pendingIds = new Set(pending.map(write => write.recordId));
  if (scan.readFailures === 0 && scan.broken.length === 0) {
    for (const id of await listSyncSnapshotIds()) {
      if (!id.startsWith('sentence:') && !id.startsWith('knowledge:') && !id.startsWith('chat:') && id !== 'preference:main' && !seen.has(id) && !pendingIds.has(id)) {
        const current = localByKey.get(id);
        if (!await deleteEntry(id, false, current ? entryViewToVaultRecord(current) : null)) continue;
        await deleteSyncSnapshot(id);
        await putVaultRaw(`conflict:${id}`, null).catch(() => {});
        deleted++;
      }
    }
  }

  const localKnowledge = new Map((await listKnowledge()).map(k => [k.id, k]));
  for (const { record } of scan.knowledge) {
    if (pendingKeys.has(`knowledge:${record.id}`)) continue;
    const current = localKnowledge.get(record.id) ?? null;
    const baseRaw = await getSyncSnapshot(`knowledge:${record.id}`);
    const outcome = current ? mergeKnowledge(baseRaw ? JSON.parse(baseRaw) : null, current, record) : { kind: 'merged' as const, value: record };
    if (outcome.kind === 'conflict') {
      await putVaultRaw(`conflict:knowledge:${record.id}`, { kind: 'knowledge', recordId: record.id, local: current, remote: record, fields: outcome.fields });
      conflicts++; continue;
    }
    if (!await upsertVaultKnowledge(outcome.value, current)) continue;
    await setSyncSnapshot(`knowledge:${record.id}`, vaultRecordJson(record));
    await putVaultRaw(`conflict:knowledge:${record.id}`, null);
    if (vaultRecordJson(current) !== vaultRecordJson(outcome.value)) updated++;
    if (vaultRecordJson(outcome.value) !== vaultRecordJson(record)) await enqueueKnowledgeWrite(outcome.value);
  }
  if (scan.readFailures === 0 && scan.broken.length === 0) {
    const present = new Set(scan.knowledge.map(k => k.record.id));
    const removed = new Set([...scan.deletedKnowledge, ...(await listSyncSnapshotIds()).filter(k => k.startsWith('knowledge:') && !present.has(k.slice(10))).map(k => k.slice(10))]);
    for (const id of removed) {
      if (pendingKeys.has(`knowledge:${id}`)) continue;
      const current = localKnowledge.get(id) ?? null;
      const base = await getSyncSnapshot(`knowledge:${id}`);
      if (current && base && vaultRecordJson(current) !== base && !scan.deletedKnowledge.includes(id)) {
        await putVaultRaw(`conflict:knowledge:${id}`, { kind: 'knowledge', recordId: id, local: current, remote: null }); conflicts++; continue;
      }
      if (!await deleteKnowledge(id, false, current)) continue;
      await deleteSyncSnapshot(`knowledge:${id}`);
      if(current)await putVaultRaw(`conflict:knowledge:${id}`, null);
      if (current) deleted++;
    }
  }

  // 句子收藏：按稳定 ID 覆盖本地（外部只补笔记/改状态，不重建历史）
  const localSentences = new Map((await listSentences()).map(sentence => [sentence.id, sentence]));
  for (const { record } of scan.sentences) {
    if (pendingKeys.has(`sentence:${record.id}`)) continue;
    const current = localSentences.get(record.id);
    if (current && vaultRecordJson(sentenceToVaultRecord(current)) === vaultRecordJson(record)) continue;
    const applied = await upsertVaultSentence({
      id: record.id,
      video: record.video,
      text: record.text,
      ...(record.translation ? { zh: record.translation } : {}),
      ...(record.translationSource ? { translationSource: record.translationSource } : {}),
      endMs: record.endMs,
      title: record.title,
      createdAt: record.createdAt,
      ...(record.language ? { language: record.language } : {}),
    }, current ?? null);
    if (!applied) continue;
    await setSyncSnapshot(`sentence:${record.id}`, vaultRecordJson(record));
    updated++;
  }
  if (scan.readFailures === 0 && scan.broken.length === 0) {
    const sentenceIds = new Set(scan.sentences.map(item => item.record.id));
    for (const key of await listSyncSnapshotIds()) {
      if (!key.startsWith('sentence:')) continue;
      const id = key.slice('sentence:'.length);
      if (!sentenceIds.has(id) && !pendingIds.has(id)) {
        if (!await deleteSentence(id, false, localSentences.get(id) ?? null)) continue;
        await deleteSyncSnapshot(key);
        deleted++;
      }
    }
  }

  const materials = new Map<string, MaterialSnapshotRecord[]>();
  for (const { path, text } of scan.materials) {
    const parsed = parseMaterialDocument(text);
    if ('error' in parsed) { scan.broken.push({ path, reason: 'material format' }); continue; }
    const snapshots = materials.get(parsed.chatId) ?? [];
    snapshots.push(parsed.snapshot);
    materials.set(parsed.chatId, snapshots);
  }
  const seenChats = new Set<string>();
  for (const { path, text } of scan.chats) {
    const parsed = parseChatDocument(text);
    if ('error' in parsed) { scan.broken.push({ path, reason: 'chat format' }); continue; }
    if (scan.deletedChats.includes(parsed.id)) continue;
    seenChats.add(parsed.id);
    if (pendingKeys.has(`chat:${parsed.id}`)) continue;
    const source = parsed.source !== undefined ? parsed.source : parsed.sourceType
      ? { sourceType: parsed.sourceType, sourceKey: '', title: parsed.title, url: parsed.sourceUrl, ...(parsed.sourceVideo ? { video: parsed.sourceVideo } : {}) } : null;
    const snapshots = (materials.get(parsed.id) ?? []).sort((a, b) => a.version - b.version).map(s => ({ ...s, source: s.source.url ? s.source : source ?? s.source }));
    const versions = new Set(snapshots.map(s => s.version));
    if (parsed.messages.some(m => m.snapshotVersion && !versions.has(m.snapshotVersion))) { scan.broken.push({ path, reason: 'missing material' }); continue; }
    const record: ChatRecord = {
      id: parsed.id,
      title: parsed.title,
      source,
      sourceKey: source?.sourceKey ?? null,
      snapshots,
      activeSnapshotVersion: parsed.activeSnapshotVersion === undefined ? snapshots.at(-1)?.version ?? null : parsed.activeSnapshotVersion,
      messages: parsed.messages,
      updatedAt: parsed.updatedAt || Date.now(),
      draft: '',
      pendingQuote: null,
    };
    if (await upsertChatRecordFromVault(record) !== 'kept-local') updated++;
    const { draft: _draft, pendingQuote: _quote, ...base } = record;
    await setSyncSnapshot(`chat:${record.id}`, vaultRecordJson(base));
  }
  if (scan.readFailures === 0 && scan.broken.length === 0) {
    const removedIds = new Set([...scan.deletedChats, ...(await listSyncSnapshotIds()).filter(id => id.startsWith('chat:') && !seenChats.has(id.slice(5))).map(id => id.slice(5))]);
    for (const id of removedIds) {
      if (pendingKeys.has(`chat:${id}`)) continue;
      const localChat = await getChat(id, () => true);
      if (localChat) {
        if (!await clearChat(id, false, localChat)) { conflicts++; continue; }
        deleted++;
      }
      await deleteSyncSnapshot(`chat:${id}`);
    }
  }

  if (!pendingKeys.has('preference:preference')) {
    const file = await readPreferenceFromVault(handle);
    if (file) {
      const local = await readLocalPreference();
      const baseRaw = await getSyncSnapshot('preference:main');
      const outcome = mergePreferenceRecord(baseRaw ? JSON.parse(baseRaw) : local, local, file);
      if (outcome.kind === 'conflict') {
        await putVaultRaw('conflict:preference', { kind: 'preference', recordId: 'preference', local, remote: file, fields: outcome.fields });
        conflicts++;
      } else {
        await setSyncSnapshot('preference:main', vaultRecordJson(file));
        await putVaultRaw('conflict:preference', null);
        if (vaultRecordJson(local) !== vaultRecordJson(outcome.value) && vaultRecordJson(await readLocalPreference()) === vaultRecordJson(local)) await storageLocal().set({ ...outcome.value });
      }
    }
  }

  return { updated, deleted, conflicts, broken: scan.broken.length,
    ...(scan.readFailures ? { error: 'io' as const } : scan.broken.length ? { error: 'format' as const } : {}) };
}

/** Manual sync publishes local pending changes and then refreshes the running copy from the shared files. */
export const synchronizeVault = () => runVaultOperation(synchronize);
async function synchronize() {
  if (await getSyncSnapshot('preference:main')) await queuePreferenceWrite();
  const flush = await flushPendingWrites();
  const sync = await readVaultChanges();
  return { ...flush, ...sync, error: flush.error ?? sync.error ?? (sync.conflicts ? 'conflict' as const : undefined) };
}

// ---- 连接 / 断开 -------------------------------------------------------------------

export const adoptVault = (prepareSwitch?: () => Promise<void>) => runVaultOperation(() => adoptConnectedVault(prepareSwitch));
async function adoptConnectedVault(prepareSwitch?: () => Promise<void>): Promise<
  { ok: true; imported: boolean; status: VaultStatus; syncError?: FlushResult['error'] } | { ok: false; error: string }
> {
  const handle = (await getVaultHandle()) as DirHandle | null;
  if (!handle) return { ok: false, error: 'no-handle' };
  const identity = await ensureVault(handle);
  const previous = await getDataVaultIdentity();
  const previousImports = await browser.storage.local.get(null);
  if (!previous && !Object.keys(previousImports).some(key => key.startsWith('vaultImported:'))) await putVaultRaw('initialImportVaultId', identity.vaultId);
  if (previous?.vaultId !== identity.vaultId) await prepareSwitch?.();
  const preference = await setVaultIdentity(identity, await readLocalPreference());
  if (previous && previous.vaultId !== identity.vaultId) await storageLocal().set({ ...(preference ?? { defaultComprehensionLang: DEFAULT_SETTINGS.defaultComprehensionLang, comprehensionOverrides: {} }) });
  let imported = false;
  if (await getVaultRaw('initialImportVaultId') === identity.vaultId) {
    // 首次连接该库：本机持久记录增量并入（幂等标记防重复导入）
    const entries = await listEntries();
    for (const e of entries) await enqueueVocabWrite(entryViewToVaultRecord(e));
    for (const s of await listSentences()) await enqueueSentenceWrite(sentenceToVaultRecord(s));
    for (const k of await listKnowledge()) await enqueueKnowledgeWrite(k);
    for (const c of await listChats()) {
      const record = await getChat(c.chatId);
      if (record) await enqueueChatWrite(record);
    }
    await putVaultRaw('initialImportVaultId', null);
    imported = true;
  }
  const result = await synchronize();
  if (result.error && result.error !== 'conflict') return { ok: false, error: result.error };
  const status = await getVaultStatus();
  return { ok: true, imported, status, syncError: result.error };
}

export const disconnectVault = () => runVaultOperation(clearVault);

async function readLocalPreference(): Promise<VaultPreferenceRecord> {
  const stored = await storageLocal().get(['defaultComprehensionLang', 'comprehensionOverrides']);
  return { defaultComprehensionLang: validSetting('defaultComprehensionLang', stored.defaultComprehensionLang) ? stored.defaultComprehensionLang as string : DEFAULT_SETTINGS.defaultComprehensionLang,
    comprehensionOverrides: validSetting('comprehensionOverrides', stored.comprehensionOverrides) ? stored.comprehensionOverrides as Record<string, string> : {} };
}

/** 设置变化时把偏好排入待写（background setSetting 后调用）。 */
export const enqueuePreferenceWrite = () => runVaultOperation(queuePreferenceWrite);
async function queuePreferenceWrite(): Promise<void> {
  const identity = await getDataVaultIdentity();
  if (!identity) return;
  const payload = await readLocalPreference();
  if (await getSyncSnapshot('preference:main') === vaultRecordJson(payload)) return;
  await enqueueVaultWrite({
    id: 'preference:main',
    kind: 'preference',
    recordId: 'preference',
    vaultId: identity.vaultId,
    payload,
    queuedAt: Date.now(),
  });
}
