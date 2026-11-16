# 开发指南

扩展的模块划分和代码入口见[技术边界](ARCHITECTURE.md)。

## 从源码构建

用 Node.js 22.12 或更新版本在仓库根目录运行 `npm ci` 和 `npm run build`，再在独立浏览器配置中加载 `.output/build/chrome-mv3`。

## 开发检查

- 改文档时，核对改动涉及的事实和链接。
- 修复逻辑问题时，先复现问题，再检查修复结果和可能受影响的相关行为。
- 改界面时，用当前构建验证相关操作。涉及浏览器差异时，分别在 Chrome 和 Edge 检查。

同一提交和构建产物的检查结果可以复用。`e2e-check` 用于实机检查。提供 `BLC_SETTINGS_PATH` 时，它会读取现有设置中的 Key，可能发送真实 AI 请求。

## 发布

1. 新功能递增次版本，修复递增补丁版本。同步提交 `package.json` 和 `package-lock.json`，在版本提交上运行 `npm ci` 和 `npm run zip`。
2. 将 `.output/build` 中的待发布 ZIP 解压到空目录，确认 `manifest.json` 中的版本与包名一致。将 `PEAK_DISTANCE_UI_EXTENSION` 指向该目录，再运行 `npm run verify-local`。浏览器专项检查也使用同一目录。改动界面语言或设置交互时，加跑 `npm run check-ui-i18n`。
3. 检查通过后，为版本提交打 `v<version>` 标签，将已验收的 ZIP 上传为 Release 附件，并在 Release 中说明本版变化。需要完整源码时，检出该版本标签。
