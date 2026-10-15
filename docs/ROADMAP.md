# 当前任务与交付状态

本文维护当前任务、待办与验收入口；产品约定见 [PRD](PRD.md)，技术边界见 [ARCHITECTURE](ARCHITECTURE.md)，布局与视觉见 [design.md](../design.md)。阶段规格和报告保留当时的决策、实现及验收范围，不作为当前任务的自动执行清单。

## 当前基线：v0.6.8（2026-10-15）

- [v0.6.8 已发布](https://github.com/Rayyy3320/peak-distance/releases/tag/v0.6.8)：聊天普通保存补齐共同基准和材料内容核对，分歧保留双方；修复缓存落盘失败影响查询、网页标记分片及动态文本遗漏；优化词条语境关联与集合批量写入。Release 提供安装包和同标签源码包。
- 上一版 [v0.6.7](https://github.com/Rayyy3320/peak-distance/releases/tag/v0.6.7) 包含长期可靠性修复：换库归属、临时材料与窗口状态清理、聊天恢复与删除、语言身份和偏好同步。
- v0.6.6（2026-10-13）：问答启动／发送、材料移除／历史恢复、输入框上边缘调节与紧凑布局，以及查词路由、AI 缓存／显示、内容脚本失效提示修复。
- 本轮修复依据与最终验收：[代码质量审查及问答／查词修复](specs/code-quality-review-20261013.md) 的 2026-10-15 两节。前序启动与 Enter 修复证据见 [问答发送与工作区恢复](specs/chat-interaction-fix-verification.md)。已完成部分不再标为正在实施。
- 五语言界面已接入主线。多语言与本地学习库主体已实现，剩余缺陷、未实现目标和实机项见下节；正式发布不代表这些出口全部通过。
- 当前版本由 `package.json` 与发布标签确定；具体检查以对应提交上的结果为准。受控服务、类型检查和构建不能替代真实网络或用户实机验收。

## 未完成项与修复入口

| 范围 | 状态与入口 |
| --- | --- |
| 可靠性与性能接续（v0.6.8） | 聊天保存、缓存、标记及批量读写修复已随 v0.6.8 发布。验证入口为 `npm run verify-local` 中的回归、生命周期、可靠性及学习库同步检查；冲突选择界面、原生目录跨程序互斥和多日压力边界仍保留 |
| 可靠性源码修复 | 前批四类长期积累／误删问题及遗留七项之后，复核发现的换库归属、断开重连、双窗口材料覆盖、删除遇到外部更新和冲突残留已接续修复，范围与验证见[审查报告](specs/code-quality-review-20261013.md#2026-10-15库归属与提交契约接续)。已随 v0.6.7 发布；原生目录与用户实机边界保持下列记录 |
| 学习库目标与实机 | [M11 报告](specs/m11-verification-report.md)保留冲突版本选择界面未实现、双浏览器分叉续聊未实测等缺口。[集合文档与同步](specs/vault-collections-sync.md)记录后续词语／句子修复；原生目录授权恢复、Obsidian 应用编辑、跨程序同时写入与互斥仍未完成实机验证 |
| 选区材料 | [选区验收](specs/selection-chat-actions-verification.md)保留真实 YouTube 侧栏跨项选择与页面正文、真实 X 帖子，以及用户固定／浮动面板气泡点击的实机项 |
| 字幕获取与选轨 | 2026-10-05 等待修复通过受控检查，修复后的已登录实机待复验；2026-10-06 新原文语言控件的实机项见 [选轨验收](specs/youtube-subtitle-language-verification.md)。M7 已验证真实人工／自动英文视频的可见对应译文，M6 逐来源时间对齐与缓存网络归因仍保留原检查边界 |
| 工作区与外部服务 | [M8 报告](specs/m8-verification-report.md)保留已登录 YouTube 当前构建复验与真实 Google 限流边界；[M10 报告](specs/m10-verification-report.md)保留用户 Chrome 原生侧栏关闭检查。后续重载或问答实机通过不能自动补齐这些专项 |
| 历史浮动白屏 | [M10 后续修复](specs/m10-followup-verification.md)已补诊断、失败反馈及手动恢复，约一分钟偶发白屏的直接原因仍未定位；用户要求不扩大排查。旧空会话未批量清理 |
| 服务与来源 | [M9 spec](specs/m9-ai-services.md)的受控协议检查不能代表六家供应商的用户账号实测；NativeDelete 发布 commit 与许可仍不可得，来源缺口见 [REFERENCES](REFERENCES.md) |

## 规格与验收索引

已确认但未实现的目标继续保留在规格中；后续规格明确替代的内容不再作为旧阶段约束。下表索引决策与证据，当前完成状态以上两节为准。

| 阶段／变更 | 规格或依据 | 验收与边界 |
| --- | --- | --- |
| M0–M1：字幕获取、网页／X 学习闭环 | [M1](specs/m1-web-learning.md) | 早期方案与验收要求保留在规格中 |
| M2–M4：双语字幕、识别、控制与复习 | [M2–M4](specs/m2-m4-learning-loop.md) | [报告](specs/m2-m4-verification-report.md) |
| M5：材料问答、引用与历史 | [M5](specs/m5-context-chat.md) | [报告](specs/m5-verification-report.md) |
| M6：免 Key 来源、独立会话与缓存／复习 | [M6](specs/m6-online-services-and-chat.md) | [报告](specs/m6-verification-report.md)；真实视频可见译文的补充证据在 M7 报告末节 |
| M7：YouTube 学习与播放交互 | [M7](specs/m7-youtube-learning-workspace.md) | [报告](specs/m7-verification-report.md)，保留普通／剧场／全屏及人工／自动字幕实机证据 |
| M8：品牌、统一工作区与选区翻译 | [M8](specs/m8-peak-distance-uiux.md) | [报告](specs/m8-verification-report.md) |
| M9：多供应商与三种 AI 接口 | [M9](specs/m9-ai-services.md) | 规格内的 0.4.0 验证记录 |
| M10：首次发送保存、临时编辑与删除交互 | [M10](specs/m10-chat-and-popup-interactions.md)、[后续诊断](specs/m10-followup-diagnosis.md) | [报告](specs/m10-verification-report.md)、[后续修复](specs/m10-followup-verification.md) |
| M11：多语言与本地 Markdown 学习库 | [M11](specs/m11-multilingual-local-vault.md) | [报告](specs/m11-verification-report.md)；[执行组织](specs/m11-parallel-development.md)仅保留阶段接续依据 |
| 集合文档与双向同步修订 | [规格及验收](specs/vault-collections-sync.md) | 替代 M11 逐词／逐句文件组织；词语／句子交换与完整字段恢复通过受控检查 |
| 选区查词与加入对话 | [规格](specs/selection-chat-actions.md) | [报告](specs/selection-chat-actions-verification.md) |
| 原文字幕语言修复 | [排查及验收](specs/youtube-subtitle-language-verification.md) | 替代旧选轨偏好协议及无依据的首轨兜底 |
| 五语言界面与设置整理 | [界面语言规范](specs/ui-i18n.md)、[文案约定](ui-copy.md) | 检查入口见语言规范；生产产物验证见 v0.6.6 审查报告 |
| 问答发送、工作区恢复与紧凑输入 | [修复验收](specs/chat-interaction-fix-verification.md) | 启动时序、键盘、材料移除与历史恢复；后续上边缘调节以 v0.6.6 审查报告为准 |
| 输入框边缘调整与查词修复 | [审查及验收](specs/code-quality-review-20261013.md) | 当前已修与待修逐项记录 |

## 补充修复记录

### YouTube 字幕持续等待（2026-10-05）

- 实机只读取证：视频 `MM-C3JqCXBk` 的轨道首项为阿拉伯语；未取得原文时错误发送 `prefer ar`，失败分支退出却不终止加载。Resource Timing 显示有效英文字幕已返回（约 735 KB），但同轨道 pot 更新只保存来源、不触发恢复。
- 修复先沿用播放器当前轨道，取得原文后才尝试同语言人工轨；新令牌接管并取消旧请求。移除嵌套网络重试与全局产出队列，保留一次未捕获时的播放器唤醒；等待有截止时间，失败提供重试，成功前不隐藏原生字幕，导航清理旧来源与延迟动作。选轨及获取生命周期随后由 2026-10-06 修复收口，见上表。
- 旧构建复现失败、修复后通过；类型、构建、既有回归和受控双入口渲染检查覆盖首轨语言不符、新令牌接管、旧请求取消、空响应、失效来源重试与 MAIN 无响应，原有翻译／取消／显隐通过。源码独立复核完成。已登录 YouTube 的修复后实机验收未完成；当时自动浏览器策略阻止访问扩展管理页。

### 问答欢迎标题（2026-10-06）

欢迎标题的循环与减少动态效果约定维护在 [design.md](../design.md)。启动中隐藏再显示曾使业务活动状态保持 false，标题永久冻结；动画改为独立读取文档可见性。`verify-local` 与 `tools/check-chat-welcome.mjs` 通过，生产产物验证自然打字／删除循环、光标、布局稳定与暂停恢复；2026-10-13 的再次验证见问答修复报告。

### 全仓审查修复（0.5.1）

- P0：修复语言作用域键与去重／解析路径脱节导致的重复语境、状态重置和词卡找不到记录；e2e 增加保存去重断言。
- P1：引用定位在无 tabs 权限时按 chatEnsure 记录的 tabId 回验；词卡携带 lookup intent，悬停不触发 AI 兜底。
- P2：区分学习库读取失败与文件不存在；字幕轮询分快慢路径；问答轮询补生成态及迟到终态保护；迁移拆分组落盘前剔除 forms/note；选区分类三处共用；e2e 载荷补语言。另清理监听器、重复样式、节流／防抖与死代码。
- 当时本地检查通过，e2e 唯一未通过项需真实 API Key。此记录只说明该批次修复范围，不覆盖后来审查发现的新缺陷。

## 后续候选

Anki、X thread、Netflix。学习数据文件夹共享与恢复已纳入 M11；选区查词与加入对话已经实施，不再列为候选。

## Git 与发布约定

- `main` 是唯一长期主线，保存最新通过检查的完整工程；源码、规格、设计与检查工具一起维护。`codex/<topic>` 从最新 `main` 创建，完成后合入并删除；未完成的功能留在功能分支。
- 已发布版本由 `v<version>` 标签与 GitHub Release 标识，`main` 可以领先于最新 Release。README 描述主线功能，「当前发布版」单独指向实际安装包；不再维护另一份筛选后的源码分支。
- 旧 `develop`、`codex/m11-integration` 与本地 UI 快照通过 `archive/*-2026-10-12` 标签保留原历史。归档标签只用于追溯与恢复，不是版本发布，也不继续开发。后续功能从 `main` 派生。
- 换机器前提交并推送当前功能分支；另一台机器先 `git fetch --prune origin`，再跟踪同一分支。接续主线使用 `git switch main`、`git pull --ff-only`。有未提交改动或本地提交时先核对差异，再明确选择保存、合并或变基；不要用强推覆盖另一台机器的工作。
- 主线更新使用经过验证的普通提交或功能分支合并；保留现有发布历史，不重写已经发布的提交和版本标签。

发布步骤：

1. 在待发布提交执行 `npm ci` 与 `npm run verify-local`；界面变更补充 `npm run check-ui-i18n` 等对应检查。测试响应不能代表真实服务或用户实机已通过；范围按对应规格记录。
2. 新规格进 minor 位，修复批次进 patch 位；`package.json` 与 `package-lock.json` 同步更新。版本提交完成后，从该提交构建并打 `v<version>` 标签。
3. `npm run zip` 生成安装包；源码包使用 `git archive --format=zip --prefix=peak-distance/ -o .output/peak-distance-<version>-source.zip v<version>`。`.gitattributes` 是源码包排除规则的唯一实现；工程资料保留在仓库，归档仍包含构建依赖及 package 脚本引用的检查工具。
4. 发布安装包、同一版本标签的源码包和两空格格式 SHA256SUMS；Release 说明包含「本版更新」。中英文 README 的「当前发布版」随实际 Release 更新；hero 文案变更时重导出并目检。
5. 普通主线提交不等于安装包已更新。只有完成上述步骤才记录正式发布；所有修复在同一主线维护，无需在工程与发布分支之间来回复制。
