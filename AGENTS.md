# Peak Distance

个人自用的多语言学习扩展，覆盖桌面 Chrome / Edge 上的网页 / X 与 YouTube。

## 按任务查阅

- 产品约定：[docs/PRD.md](docs/PRD.md)
- 界面布局、视觉与素材：[docs/DESIGN.md](docs/DESIGN.md)
- 界面语言与文案：[docs/specs/ui-i18n.md](docs/specs/ui-i18n.md)
- 技术边界与代码入口：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 阶段目标与优先顺序：[docs/ROADMAP.md](docs/ROADMAP.md)
- 已确认缺陷与单项验收：[GitHub Issues](https://github.com/Kylan3320/peak-distance/issues)
- 上游来源与许可：[docs/REFERENCES.md](docs/REFERENCES.md)
- 安装与使用：[README.md](README.md)
- 构建、检查与发布：[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

## 项目约定

- 仅在已确认的阶段目标、优先顺序或准出条件变化时更新 ROADMAP。缺陷的复现、关闭条件和单项待验维护在对应 Issue；达成关闭条件后关闭 Issue。历史证据引用具体版本或提交。
- main 为唯一长期主线。跨机器接续前推送功能分支，接续主线用 git pull --ff-only。
- 默认复用合适的当前检出目录。另开工作树前确认隔离需求和如何回到原目录。工作结束后核对提交与未跟踪文件，交回原目录并归档不再使用的工作树。
- 网页与视频共用词汇和学习状态；来源差异留在内容模块。
- 复制上游代码时记录 commit、原文件、本地落点并保留许可声明。
- 类型、schema、配置是实现事实的依据。仅在本次任务改变相应内容时同步文档：产品决策改 PRD，长期行为改对应规格，技术边界改 ARCHITECTURE；无需逐项更新，不重复维护字段、常量或测试次数。

## 开发收尾

- 验收只覆盖本次改动和直接受影响的功能。用能证明结果的最小检查，已有证据覆盖时直接复用。必要验收通过即停止测试，具体做法见[开发指南](docs/DEVELOPMENT.md#开发验收)。
- 任务完成且本次必要验收通过后，检查改动归属与远端状态，只提交本任务的改动。符合主线约定时合入并推送 `main`。
- 扩展改动完成并验证后，更新本机 Chrome 和 Edge 的插件，保留学习数据与浏览器设置，并核对加载结果。
- 任务未完成或本次必要验收未通过时，保留并推送功能分支以便接续，不合入 `main`。没有改动时不创建空提交。
- 遇到无关改动或远端分叉，保留现有内容，只处理能安全辨认的部分；无法安全处理时说明阻碍，不强推或覆盖。
- 默认不改版本号、不打标签、不创建 Release；仅在用户明确要求时发布。
