# Peak Distance

个人自用的多语言学习扩展，覆盖桌面 Chrome / Edge 上的网页 / X 与 YouTube。

## 按任务查阅

- 产品约定：[docs/PRD.md](docs/PRD.md)
- 界面布局、视觉与素材：[design.md](design.md)
- 界面语言与文案：[docs/specs/ui-i18n.md](docs/specs/ui-i18n.md)、[docs/ui-copy.md](docs/ui-copy.md)
- 技术边界与代码入口：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 当前任务、状态与出口：[docs/ROADMAP.md](docs/ROADMAP.md)
- 上游来源与许可：[docs/REFERENCES.md](docs/REFERENCES.md)
- 启动、使用与检查：[README.md](README.md)

## 项目约定

- ROADMAP 指定当前任务和验收出口；已完成的规格或报告按相关功能引用。
- main 为唯一长期主线。跨机器接续前推送功能分支，接续主线用 git pull --ff-only。发布步骤见 [README](README.md#发布)。
- 默认复用合适的当前检出目录。另开工作树前确认隔离需求和如何回到原目录。工作结束后核对提交与未跟踪文件，交回原目录并归档不再使用的工作树。
- 网页与视频共用词汇和学习状态；来源差异留在内容模块。
- 复制上游代码时记录 commit、原文件、本地落点并保留许可声明。
- 类型、schema、配置是实现事实的依据。仅在本次任务改变相应内容时同步文档：产品决策改 PRD，技术边界改 ARCHITECTURE，进度改 ROADMAP；无需逐项更新，不重复维护字段、常量或测试次数。

## 开发收尾

- 任务完成并通过必要验证后，检查改动归属与远端状态，只提交本任务的改动；符合主线约定时合入并推送 `main`。
- 任务未完成或验证未通过时，保留并推送功能分支以便接续，不合入 `main`；没有改动时不创建空提交。
- 遇到无关改动或远端分叉，保留现有内容，只处理能安全辨认的部分；无法安全处理时说明阻碍，不强推或覆盖。
- 默认不改版本号、不打标签、不创建 Release、不更新浏览器插件；仅在用户明确要求时发布。
