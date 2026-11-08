# 当前任务与交付状态

## 当前任务

本轮文档收口已完成，暂无指定的功能实施规格。

当前公开发布版为 [v0.72.3](https://github.com/Kylan3320/peak-distance/releases/tag/v0.72.3)。发布后主线交付了词条收藏／复习选择分离和剑桥发音隔离播放器，默认词典为剑桥英汉、有道备用。

本机 Chrome／Edge 共用安装目录 `.output/chrome-mv3` 已更新，浏览器重新加载及网页刷新待完成。

2026-11-08 按用户要求，以当前主线实现替换 v0.72.3 安装包，版本号和既有标签保留；替换包的源码提交由 Release 说明明确链接。发布检查复用同一解包产物，修正新增夹具后只续跑受影响及未执行的专项。

## 最近交付与证据

| 交付 | 结果与证据 |
| --- | --- |
| 字幕入口与目录授权 | 播放器仅保留字幕开关，详细设置进入侧栏，恢复原目录权限后继续同步。相关构建、界面和共享库检查通过。见 `5a021d6`、`c9fb9de` |
| 双主题与输入区 | 原生侧栏、主题写入、草稿保留和关闭已在 Chrome／Edge 检查，固定／浮动往返及手动恢复在 Edge 检查。见[UI 规格](specs/ui-refresh.md)、`11c0638`、`4287303` |
| 文档与翻译来源收口 | 补齐三项已复现缺陷及关闭条件，发布检查不重复构建；常规字幕回执透传实际来源，内置／Google 翻译经生产字幕行收藏后译文及署名检查通过。其他已知缺陷未关闭 |
| 收藏与发音 | 词卡书签原位反馈，收藏与复习选择分离，发音使用扩展播放器。播放器按可见内容自适应高度，不预留错误提示空白；提示展开及界面语言切换后重新校准词卡位置。相关词卡及双浏览器发音专项通过。见 `662a9f2`、`b1d244d`、`b1f2ab0` |

## 未完成项

| 范围 | 下一步与通过条件 |
| --- | --- |
| 已登录 YouTube | 用当前构建确认字幕读取、重试、换轨、侧栏收藏整句、逐句暂停，以及侧栏跨项选区和页面正文添加到对话。见[字幕阅读](specs/subtitle-reading-fixes.md)和[选区验收](specs/selection-chat-actions-verification.md) |
| X 选区 | 在真实帖子选取正文并添加到对话，确认材料属于目标帖子。见[选区验收](specs/selection-chat-actions-verification.md) |
| 工作区 | Chrome 固定／浮动往返保持输入和材料，两种模式下选区入口可点击。约一分钟偶发白屏的直接原因待定位，排查暂缓。见 [M10 报告](specs/m10-verification-report.md)及[后续修复](specs/m10-followup-verification.md) |
| 共享学习库 | 用原生目录确认授权恢复、Obsidian 编辑读回、跨程序同时写入时冲突可见且内容保留。冲突版本选择、分叉续聊保存为两个会话尚未实现。见 [M11](specs/m11-multilingual-local-vault.md)及[混用版本限制](specs/vault-collections-sync.md#混用版本限制) |
| 词条原文语言 | 词卡和已保存词条的语言纠正尚未实现。是否排期及已存词条合并规则待定。见 [M11](specs/m11-multilingual-local-vault.md#32-内容语言与理解语言) |
| NativeDelete 来源 | 对应源码版本与许可待补。见[来源记录](REFERENCES.md#m10-删除交互移植) |

后续候选为 Anki、X thread、Netflix。

## 已复现缺陷

原五项在 `e7109d3` 复现；前三项及下列新增三项在 `b1f2ab0` 用隔离数据复现。按下列条件关闭。表中的脚本是补充回归的落点，并不表示目前已覆盖该场景或检查通过即可关闭缺陷。

| 优先级与缺陷 | 复现条件 | 关闭条件 |
| --- | --- | --- |
| P1 问答同步覆盖远端续问 | A 生成中，B 提交新一轮，A 先读回再完成并写入 | 延后导入时保留原共同基准。A 完成后仍能读取 B 的历史，并能恢复 A 的结果。补测须包含生成中读回远端再完成的时序，落点 `tools/vault-sync-check.mjs` |
| P1 删除词条丢笔记或复活词条 | 两端从同一版本起步，一端删除，另一端改笔记，交换提交顺序 | 两种顺序均报告冲突，保留可恢复的笔记与删除意图。见 `tools/vault-sync-check.mjs` |
| P1 视频旧列表写入新库 | A、B 有同名词和同 ID 收藏句，从 A 切到 B 后触发 A 行的操作 | 旧行改状态和取消收藏均被拒绝，B 的记录保留。补测须操作视频收藏列表，而非仅全局词卡，落点 `tools/vocab-ownership-check.mjs` |
| P2 翻译故障让未请求的字幕失去调度资格 | 首句收到 503，批次提前终止，随后渠道恢复 | 未尝试项仍可调度，已成功项保留，恢复后可补齐译文。见 `tools/translation-reliability-runtime-check.mjs` |
| P1 同步重建上下文导致释义回填丢失 | 先收藏、完成一次共享库写入，再向收藏返回的上下文 ID 回填释义 | 同步保留相同上下文 ID，迟到释义落入原记录；覆盖正常发布及读回。补入 `tools/vault-sync-check.mjs` |
| P2 知识点删除失败后丢失重试 | 删除标记已写入，知识点 Markdown 写入失败，再同步 | 重试完成可见记录删除及元数据清理后才移除待办；文件与本机一致。补入 `tools/vault-sync-check.mjs` |
| P2 截断问答被保存为完成 | 流有正文但无终止事件便 EOF，或以长度上限结束 | 保留正文并标记可恢复的中断／截断，不作为完成回答参与历史；各协议正常结束仍可完成。补入 `tools/ai-services-check.ts` 与 `tools/chat-lifecycle-check.ts` |
| P2 偏好写入覆盖外部编辑 | 读取偏好后、提交前，另一端修改同一文件 | 保留外部修改与本机待办，并报告冲突。见 `tools/vault-sync-check.mjs` |

## 历史规格与证据

| 主题 | 已交付行为与证据 |
| --- | --- |
| 侧栏学习句 | 本地提取句界并保留来源范围。按词段锚点定位，缺少锚点时逐项导航并按区间暂停。收藏和译文按学习项关联，换轨拒绝旧行操作。见[实施规格](specs/subtitle-sentence-units.md)与 `tools/subtitle-reading-check.mjs`。 |
| 字幕读取与收藏 | [v0.70.0](https://github.com/Kylan3320/peak-distance/releases/tag/v0.70.0) 修复获取、收藏与阅读位置。侧栏显示学习句，播放器显示短片段。见[字幕规格](specs/subtitle-reading-fixes.md)及[选轨报告](specs/youtube-subtitle-language-verification.md) |
| 选区翻译与文章学习 | [v0.6.9](https://github.com/Kylan3320/peak-distance/releases/tag/v0.6.9) 交付独立知识点、摘录收藏及后台回填。[v0.69.1](https://github.com/Kylan3320/peak-distance/releases/tag/v0.69.1) 接入内置翻译。见[翻译规格](specs/translation-learning.md)和[文章规格](specs/current-content-learning.md) |
| 学习库与可靠性 | [M11 规格与阶段证据](specs/m11-verification-report.md)、[集合格式与同步](specs/vault-collections-sync.md)、[后续可靠性修复](specs/code-quality-review-20261013.md#2026-10-15长期可靠性修复) |
| 网页、字幕与问答闭环 | [M1 规格](specs/m1-web-learning.md)、[M2–M4 验收](specs/m2-m4-verification-report.md)、[M5 问答验收](specs/m5-verification-report.md)、[M6 来源验收](specs/m6-verification-report.md)、[M7 视频实机](specs/m7-verification-report.md) |
| 工作区、界面语言与 AI | [M8 工作区验收](specs/m8-verification-report.md)、[M9 AI 接口](specs/m9-ai-services.md)、[问答发送与恢复](specs/chat-interaction-fix-verification.md)。当前界面约定见[设计](../design.md)、[界面语言](specs/ui-i18n.md)和[文案](ui-copy.md) |

## Git 与发布约定

- `main` 是唯一长期主线，保存最新通过检查的完整工程；源码、规格、设计与检查工具一起维护。`codex/<topic>` 从最新 `main` 创建，完成后合入并删除；未完成的功能留在功能分支。
- 已发布版本由 `v<version>` 标签与 GitHub Release 标识，`main` 可以领先于最新 Release。README 描述主线功能，「当前发布版」单独指向实际安装包；不再维护另一份筛选后的源码分支。
- 旧 `develop`、`codex/m11-integration` 与本地 UI 快照通过 `archive/*-2026-10-12` 标签保留原历史。归档标签只用于追溯与恢复，不是版本发布，也不继续开发。后续功能从 `main` 派生。
- 换机器前提交并推送当前功能分支；另一台机器先 `git fetch --prune origin`，再跟踪同一分支。接续主线使用 `git switch main`、`git pull --ff-only`。有未提交改动或本地提交时先核对差异，再明确选择保存、合并或变基；不要用强推覆盖另一台机器的工作。
- 主线更新使用经过验证的普通提交或功能分支合并；保留现有发布历史，不重写已经发布的提交和版本标签。

发布步骤：

1. 新规格进 minor 位，修复批次进 patch 位。`package.json` 与 `package-lock.json` 同步更新并提交。在版本提交上运行 `npm ci` 和 `npm run zip`，安装包生成在 `.output/build`。
2. 将待发布 ZIP 解压到独立的空目录，把 `PEAK_DISTANCE_UI_EXTENSION` 设为该解包目录，在同一提交运行一次 `npm run verify-local`；该命令不再构建，浏览器专项复用此待发布产物。涉及界面语言或设置交互时运行 `npm run check-ui-i18n`。其他专项只补具体覆盖缺口，沿用同一解包目录。只为本机安装已发布的包时，按 README 的升级步骤检查浏览器实际运行结果。
3. 检查通过后为版本提交打 `v<version>` 标签，并将已验收的 ZIP 上传为 Release 的唯一附件。说明只保留「本版更新」。源码可从版本标签获取，手动源码归档的排除规则由 `.gitattributes` 定义。发布成功后同步中英文 README 的当前发布版及 ROADMAP，清理本次验收用的解包目录。
