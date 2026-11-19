# 开发指南

扩展的模块划分和代码入口见[技术边界](ARCHITECTURE.md)。

## 从源码构建

用 Node.js 22.12 或更新版本在仓库根目录运行 `npm ci` 和 `npm run build`。Chrome 构建产物在 `.output/build/chrome-mv3`。

## 开发验收

验收本次改动和直接受影响的功能，通过即停。文档改动核对涉及的事实与链接。缺陷修复用原触发场景确认结果。选能证明结果的现有专项检查或手工操作，已有结果覆盖同一行为及相关条件时直接复用。现有命令见 [package.json](../package.json)。

需要浏览器验证时，使用当前构建与独立配置。仅在结论依赖实际站点、浏览器能力、目录授权或外部服务时做对应实测。浏览器检查可用 `BLC_CHROME` 指定浏览器，用 `PEAK_DISTANCE_UI_EXTENSION` 指定构建目录。

## 本机插件更新

更新日用插件时，将构建产物放到 Chrome 和 Edge 的原安装路径，保留浏览器配置和学习数据。分别重载并确认已加载目标构建。本步骤只核对加载结果。

## 发布

仅在明确要求发布时执行。

1. 新功能递增次版本，修复递增补丁版本。同步提交 `package.json` 和 `package-lock.json`，在版本提交上运行 `npm ci` 和 `npm run zip`。
2. 将 `.output/build` 中的待发布 ZIP 解压到空目录，确认 `manifest.json` 中的版本与包名一致。在版本提交上运行发布基线 `npm run verify-local`。通过 `PEAK_DISTANCE_UI_EXTENSION` 将加载扩展的检查指向解压目录，源码检查直接使用该提交。复用已覆盖本版改动及产物的专项验收结果。
3. 检查通过后，为版本提交打 `v<version>` 标签，将已验收的 ZIP 上传为 Release 附件，并在 Release 中说明本版变化。需要完整源码时，检出该版本标签。
