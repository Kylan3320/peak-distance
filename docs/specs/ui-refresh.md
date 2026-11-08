# 整体前端改造：简约与经典主题

状态：方案于 2026-11-06 确认，代码已实施并通过本轮验收。交付证据和既有待验项见 [ROADMAP](../ROADMAP.md)。

## 1. 目标与依据

让 Peak Distance 在网页、X、YouTube 和所有扩展界面中呈现克制、成熟、一致的工具感：学习内容更易读，重复信息更少，常用操作易找到，切换外观不中断正在做的事。主题规则见 [PRD](../PRD.md#工作区与设置)。

本规格维护本轮覆盖范围、技术边界和完成条件；[design.md](../../design.md)是共用布局、主题取值和控件规则的唯一设计来源；[PRD](../PRD.md)维护产品行为。图片提供视觉参考，未画出的现有能力按行为规格保留。历史文档中被替代的视觉要求不再作为本轮验收依据，其数据、播放、会话和来源规则仍有效。

### 确认稿

| 页面 | 已确认图片 |
| --- | --- |
| 当前内容 | [01-current-content.png](../../design/ui-refresh/01-current-content.png) |
| 生词本 | [02-vocabulary.png](../../design/ui-refresh/02-vocabulary.png) |
| AI 问答 | [03-chat.png](../../design/ui-refresh/03-chat.png) |
| 设置 | [04-settings.png](../../design/ui-refresh/04-settings.png) |
| 复习 | [05-review.png](../../design/ui-refresh/05-review.png) |

五图是同一体系的代表页，不能把其中的展开状态、示例数据、遗漏字段或不同模式图标当成产品默认值。图稿像素不是 CSS 尺寸；未画页面按 design 中对应组件延展，不再探索另一套风格。

## 2. 覆盖范围

覆盖下列所有用户可见界面及其中已有的加载、空、错误、编辑和确认状态；只实现实际存在的状态，不为表格补虚构流程。

| 范围 | 包含内容 | 主要代码入口 |
| --- | --- | --- |
| 工作区外壳 | 原生侧栏、浮动面板、全屏内浮动面板、拖动与失败重试 | `entrypoints/sidepanel/index.html`、`style.css`、`main.ts`；`shared/floatingPanel.ts` |
| 当前文章 | 网页／X 标题、选区、生词、知识点、范围筛选 | `entrypoints/sidepanel/articleLearning.ts` |
| 全局学习库 | 词语、句子、知识点；搜索、详情、笔记、来源、删除 | `entrypoints/sidepanel/main.ts`、`knowledgeView.ts` |
| 复习 | 全局／文章／视频词汇及文章知识点；选语言、切题、完成与返回 | `entrypoints/sidepanel/main.ts` |
| 问答 | 空态、对话与生成状态、历史、引用、材料、标记及知识点编辑、删除确认 | `entrypoints/sidepanel/chatView.ts`、`knowledgeView.ts`；`shared/deleteButton.*` |
| 设置 | 面板与独立设置页；语言规则、AI 草稿、文件夹授权／同步与恢复 | `shared/settingsView.ts`；`entrypoints/options/` |
| 就地学习 | 网页／X／字幕选区浮条、查词卡、翻译卡及内部菜单 | `shared/selectionPill.ts`、`selectionActions.css`、`lookupPopup.ts`、`translationPopup.ts` |
| YouTube | 字幕／词语／已保存、播放工具及设置菜单、字幕、词汇标记 | `shared/youtubeWorkspace.ts`、`readingIcons.ts`；`entrypoints/youtube.content.ts` |
| 辅助界面 | 网页词汇标记、内置翻译准备页、共用提示／菜单／反馈 | `shared/marker.ts`、`uiControls.ts`、`controls.css`；`entrypoints/native-translator/main.ts` 的可见分支 |

扩展名称与浏览器工具栏图标保留；浏览器权限框、文件选择器使用原生界面。不可见的 offscreen 翻译宿主无需视觉改造。

## 3–5. 当前规则与实现

产品行为与主题默认值见 [PRD](../PRD.md)，布局与主题视觉见 [design.md](../../design.md)，主题存储和消息边界见 [ARCHITECTURE](../ARCHITECTURE.md#外观主题)。当时的实施顺序与边界见[历史版本](https://github.com/Kylan3320/peak-distance/blob/b1f2ab02fd907e2b8f4e3aa2804194d3a85ef8cc/docs/specs/ui-refresh.md)。

## 6. 验收标准：以使用结果为准

测试命令和截图是证据手段，不是产品完成条件。不得为通过旧选择器、截图或测试次数删功能、改含义、弱化错误与状态保护。

| 用户需要 | 完成时必须成立 |
| --- | --- |
| 随处获得同一种新体验 | 第 2 节所有可见界面都采用共用规则；简约中无残留山景、纸纹、品牌口号、逐词语言标签和常驻图标说明；design 中明确的字段、来源及危险确认等文字例外完整保留 |
| 内容更易读、操作仍可发现 | 主内容先于辅助信息；列表详情按需展开，状态、来源、筛选、编辑和恢复入口可找到；图标可通过悬停／键盘提示识别，功能没有因图稿省略而消失 |
| 默认正确且主题可换 | 默认值符合 PRD；主动选择任一主题后重开仍保持；两种主题覆盖所有承载界面，经典没有恢复另一套旧布局，宿主网页未被换肤 |
| 学习可以连续完成 | 选词 → 收藏 → 查阅原句与笔记 → 复习 → 返回来源可完成；翻译摘录仍保存为独立知识点并可回到来源；状态、语言、来源与保存内容正确，字幕定位及 AP 不因新控件退化 |
| 操作过程中可换主题 | 未保存输入、材料、AI 配置草稿、展开／滚动、文本选区、复习揭示／进度及视频播放意图保持；切换本身没有新的查词、翻译或 AI 请求 |
| 窄栏与失败状态仍能用 | 长词／长值在窄栏和缩放下可读可操作，无横向溢出或关键控件遮挡；失败保留原文／输入并有真实恢复入口；新增文案覆盖现有五语言 |

### 阶段验证入口

- `node tools/check-chat-welcome.mjs` 检查加载、失败恢复、空态和主题保存。
- `node tools/check-chat-interactions.mjs` 检查输入区、发送／停止、材料和草稿。
- `npm run check-ui-i18n` 检查五语言及设置交互。

当时的完整验收范围见[历史版本](https://github.com/Kylan3320/peak-distance/blob/b1f2ab02fd907e2b8f4e3aa2804194d3a85ef8cc/docs/specs/ui-refresh.md)，实际完成结果及待验项见 [ROADMAP](../ROADMAP.md)。
