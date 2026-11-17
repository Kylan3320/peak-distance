# 开发指南

扩展的模块划分和代码入口见[技术边界](ARCHITECTURE.md)。

## 从源码构建

用 Node.js 22.12 或更新版本在仓库根目录运行 `npm ci` 和 `npm run build`，再在独立浏览器配置中加载 `.output/build/chrome-mv3`。

## 开发检查

验证改动和直接受影响的行为。文档改动核对事实与链接。修复缺陷时复现触发条件，并用最小的现有检查验证修复。界面交互使用本次构建，只有结论依赖具体站点、浏览器能力、目录授权或外部服务时，才跑对应实测。已有结果覆盖同一改动和构建时可复用。

从 [package.json](../package.json) 选对应命令。AI 协议和配置逻辑用 `npm run check-ai`，文案目录用 `npm run check-i18n`。实际设置交互使用 `node tools/settings-actions-ui-check.mjs`，涉及界面语言切换时用 `npm run check-ui-i18n`。原生目录授权用桌面目录验证，受控目录检查证明的是同步行为。真实站点探针报告阻塞时，该站点仍待验证。

`npm run selection-check` 默认使用受控页面。只有验证真实 YouTube 的跨字幕选区时才加 `-- --real-video`。真实字幕获取与站内导航使用 `npm run probe:youtube`。

浏览器检查使用独立配置。按脚本需要准备 Playwright Chromium，或用 `BLC_CHROME` 指定可加载解压扩展的浏览器。使用构建产物的脚本默认读取 `.output/build/chrome-mv3`，可通过 `PEAK_DISTANCE_UI_EXTENSION` 指定目录。本机日用插件更新到原安装目录，保留浏览器配置和学习数据，重载后核对加载结果。

## 发布

1. 新功能递增次版本，修复递增补丁版本。同步提交 `package.json` 和 `package-lock.json`，在版本提交上运行 `npm ci` 和 `npm run zip`。
2. 将 `.output/build` 中的待发布 ZIP 解压到空目录，确认 `manifest.json` 中的版本与包名一致。在版本提交上运行发布基线 `npm run verify-local`。通过 `PEAK_DISTANCE_UI_EXTENSION` 将加载扩展的检查指向解压目录，源码检查直接使用该提交。按改动选用上文对应的专项检查，复用覆盖同一改动和产物的结果。
3. 检查通过后，为版本提交打 `v<version>` 标签，将已验收的 ZIP 上传为 Release 附件，并在 Release 中说明本版变化。需要完整源码时，检出该版本标签。
