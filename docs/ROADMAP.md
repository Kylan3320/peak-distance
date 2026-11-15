# 当前任务与待验项

## 下一项

优先修复下列 P1 数据完整性缺陷。下一项为「删除词条丢笔记或复活词条」。

问答同步覆盖远端续问已修复。A 生成中延后导入 B 的新一轮时保留原共同基准。A 完成后同步报告冲突，B 的文件和续问保留，A 的结果可从本机待办和冲突副本恢复。双端回归见 `node tools/vault-sync-check.mjs --chat-conflict-only`。

## 已复现缺陷

| 优先级与缺陷 | 复现条件 | 关闭条件 |
| --- | --- | --- |
| P1 删除词条丢笔记或复活词条 | 两端从同一版本起步，一端删除，另一端改笔记，交换提交顺序 | 两种顺序均报告冲突，保留可恢复的笔记与删除意图。见 `tools/vault-sync-check.mjs` |
| P1 视频旧列表写入新库 | A、B 有同名词和同 ID 收藏句。收藏汇总已携带库身份，但切到 B 后重放 A 的字幕行会删掉 B 的句子 | 字幕行与收藏汇总的旧操作均被拒绝，B 的记录保留。同库内收藏或取消按点击意图执行。汇总回归补入 `tools/vocab-ownership-check.mjs`，字幕行回归补入 `tools/subtitle-reading-check.mjs` |
| P2 同一句译文和 AI 语境解释互相覆盖 | 两端从同一句起步，一端补普通译文，另一端补 AI 解释，先后提交均报告成功 | 交换提交顺序，两端和共享文件均保留两项内容。补入 `tools/vault-sync-check.mjs` |
| P2 字幕轮询使收藏汇总丢弃慢回执 | 同一视频、同一库，延迟列表回执超过一次字幕轮询，数据库已有收藏但计数仍为 0 | 同一视频和库的有效回执能更新计数与列表，切视频或换库后的旧回执不生效。补入 `tools/subtitle-reading-check.mjs` |
| P2 翻译故障让未请求的字幕失去调度资格 | 首句收到 503，批次提前终止，随后渠道恢复 | 在实际内容脚本中确认已成功译文保留，未尝试项恢复后能补出译文。补入 `tools/youtube-translation-language-check.mjs`；后台批次回执继续由 `tools/translation-reliability-runtime-check.mjs` 检查 |
| P2 切换常规翻译服务后字幕不恢复 | Google 返回 503，保持视频、轨道及目标语言不变，改用浏览器内置翻译 | 当前待译字幕会请求新服务并显示译文，旧服务迟到回执不覆盖新译文，已有平台字幕可继续使用。补入 `tools/youtube-translation-language-check.mjs` |
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
