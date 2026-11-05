# 当前任务与交付状态

## 当前任务

暂无指定的功能实施规格。

安装基线为 [v0.70.1](https://github.com/Kylan3320/peak-distance/releases/tag/v0.70.1)。发布后的主线改动见 Git。

## 未完成项

| 范围 | 下一步与通过条件 |
| --- | --- |
| 已登录 YouTube | 用当前构建确认字幕读取、重试、换轨、侧栏收藏整句、逐句暂停，以及侧栏跨项选区和页面正文添加到对话。见[字幕阅读](specs/subtitle-reading-fixes.md)和[选区验收](specs/selection-chat-actions-verification.md) |
| X 选区 | 在真实帖子选取正文并添加到对话，确认材料属于目标帖子。见[选区验收](specs/selection-chat-actions-verification.md) |
| 工作区 | 在用户 Chrome 中验证固定／浮动切换保留输入和材料，两种模式均可点击选区入口，明确关闭原生侧栏清除未发送内容。约一分钟偶发白屏的直接原因待定位，排查暂缓。见 [M10 报告](specs/m10-verification-report.md)及[后续修复](specs/m10-followup-verification.md) |
| 共享学习库 | 用原生目录确认授权恢复、Obsidian 编辑读回、跨程序同时写入时冲突可见且内容保留。冲突版本选择、分叉续聊保存为两个会话尚未实现。混用版本的格式兼容策略待定。见 [M11](specs/m11-multilingual-local-vault.md)及[同步修订](specs/vault-collections-sync.md) |
| 词条原文语言 | 词卡和已保存词条的语言纠正尚未实现。是否排期及已存词条合并规则待定。见 [M11](specs/m11-multilingual-local-vault.md#32-内容语言与理解语言) |
| NativeDelete 来源 | 对应源码版本与许可待补。见[来源记录](REFERENCES.md#m10-删除交互移植) |

后续候选为 Anki、X thread、Netflix。

## 规格与历史证据

| 主题 | 已交付行为与证据 |
| --- | --- |
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

1. 在待发布提交执行 `npm ci` 与 `npm run verify-local`；涉及界面语言或设置交互时补跑 `npm run check-ui-i18n`，其他专项按发布改动选择。
2. 新规格进 minor 位，修复批次进 patch 位；`package.json` 与 `package-lock.json` 同步更新。版本提交完成后，从该提交构建并打 `v<version>` 标签。
3. `npm run zip` 生成安装包。源码保留在仓库及对应版本标签，不再额外制作或上传 Release 源码附件；手动源码归档的排除规则仍由 `.gitattributes` 定义。
4. Release 仅附安装包，不生成或上传独立校验文件；说明只保留「本版更新」。发布成功后同步中英文 README 的「当前发布版」及 ROADMAP，不把普通主线提交记为正式发布。
