# 当前任务与交付状态

本文维护当前任务、待办与验收入口；产品约定见 [PRD](PRD.md)，技术边界见 [ARCHITECTURE](ARCHITECTURE.md)，布局与视觉见 [design.md](../design.md)。阶段规格和报告保留当时的决策、实现及验收范围，不作为当前任务的自动执行清单。

## 当前基线：v0.6.9（2026-10-22）

- [v0.6.9 已发布](https://github.com/Kylan3320/peak-distance/releases/tag/v0.6.9)：新增当前文章学习、独立知识点与翻译摘录收藏，支持后台译文回填及有期限的查询缓存；整理生词本、问答与设置界面，修复字幕缓存、跨库操作与词形增删同步。Release 仅附 Chrome 安装包。共享学习库的浏览器需一并升级；新格式学习库拒绝旧版写入。发布检查见[翻译学习规格第 8.4 节](specs/translation-learning.md#84-v069-发布检查2026-10-22)，既有实机未验范围保留。

- [v0.6.8 已发布](https://github.com/Kylan3320/peak-distance/releases/tag/v0.6.8)：聊天普通保存补齐共同基准和材料内容核对，分歧保留双方；修复缓存落盘失败影响查询、网页标记分片及动态文本遗漏；优化词条语境关联与集合批量写入。Release 提供安装包和同标签源码包。
- 上一版 [v0.6.7](https://github.com/Kylan3320/peak-distance/releases/tag/v0.6.7) 包含长期可靠性修复：换库归属、临时材料与窗口状态清理、聊天恢复与删除、语言身份和偏好同步。
- v0.6.6（2026-10-13）：问答启动／发送、材料移除／历史恢复、输入框上边缘调节与紧凑布局，以及查词路由、AI 缓存／显示、内容脚本失效提示修复。
- 发布修复依据与验收见[代码质量审查及问答／查词修复](specs/code-quality-review-20261013.md)的 2026-10-15 两节；前序启动与 Enter 修复证据见 [问答发送与工作区恢复](specs/chat-interaction-fix-verification.md)。
- 五语言界面、多语言与本地学习库主体已接入主线；未完成目标和实机项见下文。当前版本由 `package.json` 与发布标签确定。

## 当前执行任务：选区翻译、收藏与响应优化

- 唯一执行规格：[选区翻译：浮窗、收藏与响应优化](specs/translation-learning.md)。2026-10-22 实现与必要受控检查已完成，已随 v0.6.9 发布；生产扩展已走通翻译、移动、收藏、后台回填与知识点查找。原生侧栏切换、用户目录授权及登录态站点仍待实机验收，边界见规格第 8 节。
- 范围：翻译卡移动与生命周期、翻译摘录收藏到当前学习库 `知识点.md`、知识点查找、语言与输入保真、有期限且有容量上限的查询缓存；Google 连接预热仅按规格的测量门槛决定是否保留。
- 2026-10-22 UI 接续：统一下拉展开态，翻译卡改为相邻图标操作，收紧生词本与笔记图标编辑，整理当前文章的来源／选区／分类计数／复习入口与筛选空态，压缩设置行并将反馈贴近字段，同时统一问答纸纹与工具栏；后续收敛生词本页头／复习入口、单项删除 SVG，以及文件共享和 AI 服务的状态与操作层级，统一设置表单对齐及面板顶部 SVG 操作；当前布局规则维护在 [design.md](../design.md)。
- 沿用免费服务、词典网络顺序与既有学习库机制；默认查询的缓存命中与选区翻译语言优先级按该规格第 4 节。验收集中在第 7 节。
- 2026-10-24 接续：Google 限流后的停止与冷却、全失败返回失败已修复。浏览器内置翻译已接入选区、查词译文兜底与字幕，并在 Chrome／Edge 实测取消、关闭后重开、收藏后后台补全及隐藏承载重建；默认来源已切换，保留明确选择的 Google 配置。模型须先在可见页面准备；旧 Chrome 探针配置的组件缺失及实测边界见[规格 8.6](specs/translation-learning.md#86-内置翻译接入与默认渠道2026-10-24)。当前构建尚未发布。

## 前序任务：当前文章学习与独立知识点

- 规格及验收：[当前文章学习与独立知识点](specs/current-content-learning.md)。2026-10-17 数据、本机事务、学习库生命周期、文章列表、独立知识点和固定范围复习及接续修复已合入 `main`，已随 v0.6.9 发布。类型／构建、回归、同步、五语言界面与真实 BBC 链路已验证；原生侧栏切换及用户原生目录实机项仍保留。
- 用户复验后的释义／收藏回填、复习与定位修正见[规格第 6.2 节](specs/current-content-learning.md#62-用户复验后的修正2026-10-17)；字幕缓存、知识点格式及跨库操作修复见[第 6.3 节](specs/current-content-learning.md#63-审查发现的三项接续修复2026-10-17)，词形增删同步见[第 6.4 节](specs/current-content-learning.md#64-词形移除与新增的三方合并2026-10-17)。各项证据与检查入口保留在规格中。

## 未完成项与修复入口

| 范围 | 状态与入口 |
| --- | --- |
| 可靠性与性能接续（v0.6.8） | 聊天保存、缓存、标记及批量读写修复已随 v0.6.8 发布。验证入口为 `npm run verify-local` 中的回归、生命周期、可靠性及学习库同步检查；冲突选择界面、原生目录跨程序互斥和多日压力边界仍保留 |
| 可靠性源码修复 | 前批四类长期积累／误删问题及遗留七项之后，复核发现的换库归属、断开重连、双窗口材料覆盖、删除遇到外部更新和冲突残留已接续修复，范围与验证见[审查报告](specs/code-quality-review-20261013.md#2026-10-15库归属与提交契约接续)。已随 v0.6.7 发布；原生目录与用户实机边界保持下列记录 |
| 学习库目标与实机 | 冲突版本选择界面及 M11 要求的“分叉续聊保存为两个可读会话”尚未实现；现有聊天路径保留冲突副本与待办。阶段证据见 [M11 报告](specs/m11-verification-report.md)，词语／句子修复见[集合文档与同步](specs/vault-collections-sync.md)。原生目录授权恢复、Obsidian 应用编辑、跨程序同时写入与互斥仍待实机验证 |
| 选区材料 | [选区验收](specs/selection-chat-actions-verification.md)保留真实 YouTube 侧栏跨项选择与页面正文、真实 X 帖子，以及用户固定／浮动面板气泡点击的实机项 |
| 字幕获取与选轨 | 2026-10-05 等待修复通过受控检查，修复后的已登录实机待复验；2026-10-06 新原文语言控件的实机项见 [选轨验收](specs/youtube-subtitle-language-verification.md)。M7 已验证真实人工／自动英文视频的可见对应译文，M6 逐来源时间对齐与缓存网络归因仍保留原检查边界 |
| 工作区与外部服务 | [M8 报告](specs/m8-verification-report.md)保留已登录 YouTube 当前构建复验与真实 Google 限流边界；[M10 报告](specs/m10-verification-report.md)保留用户 Chrome 原生侧栏关闭检查。后续重载或问答实机通过不能自动补齐这些专项 |
| 历史浮动白屏 | [M10 后续修复](specs/m10-followup-verification.md)已补诊断、失败反馈及手动恢复，约一分钟偶发白屏的直接原因仍未定位；用户要求不扩大排查。旧空会话未批量清理 |
| 服务与来源 | [M9 spec](specs/m9-ai-services.md)的受控协议检查不能代表六家供应商的用户账号实测；NativeDelete 发布 commit 与许可仍不可得，来源缺口见 [REFERENCES](REFERENCES.md) |

## 规格与验收索引

已确认但未实现的目标继续保留在规格中；后续规格明确替代的内容不再作为旧阶段约束。下表索引决策与证据，当前完成状态以上两节为准。

| 阶段／变更 | 规格或依据 | 验收与边界 |
| --- | --- | --- |
| 选区翻译、收藏与响应优化 | [当前执行 spec](specs/translation-learning.md) | 实现及必要受控检查已完成，待实机；预热测量触发停止条件，省略运行实现，见规格第 8 节 |
| 当前文章学习与独立知识点 | [规格及验收](specs/current-content-learning.md) | 代码与必要受控检查、真实 BBC 链路已完成；原生侧栏切换及用户原生目录待实机，证据见 spec 第 6.1 节 |
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
3. `npm run zip` 生成安装包。源码保留在仓库及对应版本标签，不再额外制作或上传 Release 源码附件；手动源码归档的排除规则仍由 `.gitattributes` 定义。
4. Release 仅附安装包，不生成或上传独立校验文件；说明只保留「本版更新」。发布成功后同步中英文 README 的「当前发布版」及 ROADMAP，不把普通主线提交记为正式发布。
