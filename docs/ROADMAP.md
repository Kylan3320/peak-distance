# 当前任务与待验项

## 下一项

优先修复下列 P1 数据完整性缺陷。从「问答同步覆盖远端续问」开始，按各项复现和关闭条件验收。

## 已复现缺陷

| 优先级与缺陷 | 复现条件 | 关闭条件 |
| --- | --- | --- |
| P1 问答同步覆盖远端续问 | A 生成中，B 提交新一轮，A 先读回再完成并写入 | 延后导入时保留原共同基准。A 完成后仍能读取 B 的历史，并能恢复 A 的结果。补测须包含生成中读回远端再完成的时序，落点 `tools/vault-sync-check.mjs` |
| P1 删除词条丢笔记或复活词条 | 两端从同一版本起步，一端删除，另一端改笔记，交换提交顺序 | 两种顺序均报告冲突，保留可恢复的笔记与删除意图。见 `tools/vault-sync-check.mjs` |
| P1 视频旧列表写入新库 | A、B 有同名词和同 ID 收藏句，从 A 切到 B 后触发 A 行的操作 | 旧行改状态和取消收藏均被拒绝，B 的记录保留。补测须操作视频收藏列表，而非仅全局词卡，落点 `tools/vocab-ownership-check.mjs` |
| P2 翻译故障让未请求的字幕失去调度资格 | 首句收到 503，批次提前终止，随后渠道恢复 | 未尝试项仍可调度，已成功项保留，恢复后可补齐译文。见 `tools/translation-reliability-runtime-check.mjs` |
| P2 知识点删除失败后丢失重试 | 删除标记已写入，知识点 Markdown 写入失败，再同步 | 重试完成可见记录删除及元数据清理后才移除待办；文件与本机一致。补入 `tools/vault-sync-check.mjs` |
| P2 截断问答被保存为完成 | 流有正文但无终止事件便 EOF，或以长度上限结束 | 保留正文并标记可恢复的中断／截断，不作为完成回答参与历史；各协议正常结束仍可完成。补入 `tools/ai-services-check.ts` 与 `tools/chat-lifecycle-check.ts` |
| P2 偏好写入覆盖外部编辑 | 读取偏好后、提交前，另一端修改同一文件 | 保留外部修改与本机待办，并报告冲突。见 `tools/vault-sync-check.mjs` |

## 未完成项

| 范围 | 状态与验收 |
| --- | --- |
| 已登录 YouTube | 待实机验证字幕读取、重试、换轨、整句收藏、逐句暂停、侧栏跨项选区与正文添加到对话。见[字幕阅读](specs/subtitle-reading-fixes.md)和[选区验收](specs/selection-chat-actions-verification.md) |
| X 选区 | 待在真实帖子验证选取正文并添加到对话，材料须属于目标帖子。见[选区验收](specs/selection-chat-actions-verification.md) |
| 工作区 | 待在 Chrome 验证固定／浮动往返保留输入与材料，两种模式的选区入口均可点击。偶发浮动白屏暂缓定位，已有[恢复入口](specs/m10-followup-verification.md) |
| 共享学习库实机 | 用原生目录确认 Chrome／Edge 恢复授权后能提交待办且不重复写入。Obsidian 修改的笔记和状态能读回；同字段并发修改时两边内容保留且冲突可见。 |
| 冲突版本选择、分叉续聊 | 待排期，见 [M11 验收条件](specs/m11-multilingual-local-vault.md#6-待实现目标)。 |
| 词条原文语言 | P1 修复后再排期，见 [M11 验收条件](specs/m11-multilingual-local-vault.md#6-待实现目标)。 |
