# 当前任务与交付状态

## 本轮交付：字幕入口与文件夹授权

播放器仅保留双语字幕开关，学习面板从浏览器扩展按钮打开；详细设置按既有设置页规范重排，区分通用偏好与当前视频；文件共享实时显示权限，复用原目录授权并在恢复后继续同步。产品与边界见 PRD、ARCHITECTURE，布局见 design.md。

类型、生产构建、五语言与设置交互、字幕阅读、双浏览器共享库和 OPFS 扩展端到端检查通过。旧 `render-check` 的阻碍来自过时测试契约：缺少显示语言、旧文字按钮、无效页面来源、旧字幕载荷、翻译调度 ID 与截止时间假设。现已按当前协议与界面更新，完整渲染检查通过；当前安装目录的产物也通过界面语言及设置交互检查。

2026-11-08 已发布 v0.72.3，词卡收藏按钮在首位原位切换状态，收藏成功时轻微回弹；重开已收藏原句不重复播放动效。发布 ZIP 解包后通过完整本地验证和五语言界面检查，公开下载的 SHA-256 校验一致。Chrome／Edge 共用的原安装目录 `.output/chrome-mv3` 已更新并与发布包逐文件核对，旧版安装包、备份和验收解包目录已清理。浏览器配置与学习数据库保留；两个浏览器仍需手动重新加载扩展，随后刷新 YouTube。

## 最近交付

主线已修复剑桥发音在严格媒体策略网页中无法播放的问题：使用扩展自己的播放器页面，词卡收藏、解释和迟到查询响应保持播放，关闭／换词／切来源结束旧播放，支持播放器内 Esc 关闭及加载失败后的手动重试。默认词典调整为剑桥英汉、有道备用，保留已保存的显式偏好。双浏览器专项（含原 Anthropic 页面与剑桥真实音频）、词卡渲染、五语言设置、类型及回归检查通过。本机共用安装目录已更新，浏览器界面自动化因无法可靠识别当前网址而停止，仍需手动重新加载扩展并刷新网页。

[整体前端改造：简约与经典主题](specs/ui-refresh.md) 已实施并通过本轮验收。工作区、就地浮层、视频界面和独立页面共用双主题，首次使用默认经典。侧栏采用图标导航和折叠学习记录，原句复习、问答、设置沿用既有数据和操作流程。

生产构建通过类型与五语言检查。已在 Chrome、Edge 实际原生侧栏检查导航、主题写入、草稿保留与关闭，在 Edge 检查固定／浮动往返和工作区加载失败后的手动恢复，草稿均保留。视频全屏检查了主题同步、模式提示和关闭。受控学习链路覆盖词卡、翻译摘录、知识点、复习、问答和字幕收藏／定位／逐句暂停。布局检查覆盖 320／400／600 CSS px、125% 浏览器缩放及德语长设置值。

按五张确认稿复核后，收细了标题、词头、图标和边线，侧栏悬浮采用中性浅底。问答输入框改用浅底、大圆角及原位切换的发送与停止按钮。浏览器专项检查覆盖首字返回前的停止按钮、拖动上缘、键盘调高、输入法和两种主题。

上一项[侧栏学习句：本地断句与来源定位](specs/subtitle-sentence-units.md) 已复验；已登录 YouTube 等待验项继续保留下方，不因 UI 规格完成而关闭。

当前公开发布版为 [v0.72.3](https://github.com/Kylan3320/peak-distance/releases/tag/v0.72.3)。发布后的主线改动见 Git。

## 未完成项

| 范围 | 下一步与通过条件 |
| --- | --- |
| 已登录 YouTube | 用当前构建确认字幕读取、重试、换轨、侧栏收藏整句、逐句暂停，以及侧栏跨项选区和页面正文添加到对话。见[字幕阅读](specs/subtitle-reading-fixes.md)和[选区验收](specs/selection-chat-actions-verification.md) |
| X 选区 | 在真实帖子选取正文并添加到对话，确认材料属于目标帖子。见[选区验收](specs/selection-chat-actions-verification.md) |
| 工作区 | 在用户 Chrome 中验证固定／浮动切换保留输入和材料，两种模式均可点击选区入口，明确关闭原生侧栏清除未发送内容。约一分钟偶发白屏的直接原因待定位，排查暂缓。见 [M10 报告](specs/m10-verification-report.md)及[后续修复](specs/m10-followup-verification.md) |
| 共享学习库 | 用原生目录确认授权恢复、Obsidian 编辑读回、跨程序同时写入时冲突可见且内容保留。冲突版本选择、分叉续聊保存为两个会话尚未实现。见 [M11](specs/m11-multilingual-local-vault.md)及[混用版本限制](specs/vault-collections-sync.md#混用版本限制) |
| 词条原文语言 | 词卡和已保存词条的语言纠正尚未实现。是否排期及已存词条合并规则待定。见 [M11](specs/m11-multilingual-local-vault.md#32-内容语言与理解语言) |
| NativeDelete 来源 | 对应源码版本与许可待补。见[来源记录](REFERENCES.md#m10-删除交互移植) |

后续候选为 Anki、X thread、Netflix。

## 已复现缺陷

在 `e7109d3` 上用隔离浏览器和受控数据复现。按下列条件关闭，并把相应场景纳入现有专项检查。

| 优先级与缺陷 | 复现条件 | 关闭条件 |
| --- | --- | --- |
| P1 问答同步覆盖远端续问 | A 生成中，B 提交新一轮，A 先读回再完成并写入 | 延后导入时保留原共同基准。A 完成后仍能读取 B 的历史，并能恢复 A 的结果。见 `tools/vault-sync-check.mjs` |
| P1 删除词条丢笔记或复活词条 | 两端从同一版本起步，一端删除，另一端改笔记，交换提交顺序 | 两种顺序均报告冲突，保留可恢复的笔记与删除意图。见 `tools/vault-sync-check.mjs` |
| P1 视频旧列表写入新库 | A、B 有同名词和同 ID 收藏句，从 A 切到 B 后触发 A 行的操作 | 旧行改状态和取消收藏均被拒绝，B 的记录保留。见 `tools/vocab-ownership-check.mjs` |
| P2 翻译故障让未请求的字幕失去调度资格 | 首句收到 503，批次提前终止，随后渠道恢复 | 未尝试项仍可调度，已成功项保留，恢复后可补齐译文。见 `tools/translation-reliability-runtime-check.mjs` |
| P2 偏好写入覆盖外部编辑 | 读取偏好后、提交前，另一端修改同一文件 | 保留外部修改与本机待办，并报告冲突。见 `tools/vault-sync-check.mjs` |

## 规格与历史证据

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
2. 将待发布 ZIP 解压到独立的空目录，把 `PEAK_DISTANCE_UI_EXTENSION` 设为该解包目录，在同一提交运行一次 `npm run verify-local`。涉及界面语言或设置交互时运行 `npm run check-ui-i18n`。其他专项只补具体覆盖缺口，沿用同一解包目录。只为本机安装已发布的包时，按 README 的升级步骤检查浏览器实际运行结果。
3. 检查通过后为版本提交打 `v<version>` 标签，并将已验收的 ZIP 上传为 Release 的唯一附件。说明只保留「本版更新」。源码可从版本标签获取，手动源码归档的排除规则由 `.gitattributes` 定义。发布成功后同步中英文 README 的当前发布版及 ROADMAP，清理本次验收用的解包目录。
