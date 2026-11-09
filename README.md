<h1 align="center">Peak Distance</h1>

<p align="center">
  <a href="https://github.com/Kylan3320/peak-distance/releases/latest"><img src="https://img.shields.io/github/v/release/Kylan3320/peak-distance?style=flat-square&amp;label=Release&amp;color=3b6fa6" alt="Latest release"></a>
  <a href="#快速开始"><img src="https://img.shields.io/badge/Browsers-Chrome%20%7C%20Edge-666?style=flat-square" alt="Browsers: Chrome and Edge"></a>
  <a href="docs/specs/vault-collections-sync.md"><img src="https://img.shields.io/badge/Learning%20vault-Markdown-31796f?style=flat-square" alt="Learning vault: Markdown"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-666?style=flat-square" alt="License: MIT"></a>
</p>

<p align="center"><a href="https://github.com/Kylan3320/peak-distance/releases/latest">下载安装包</a> · <a href="#快速开始">快速开始</a> · <a href="#文档">文档</a> · <a href="README.en.md">English</a></p>

![Peak Distance 封面。方格纸上的标题下方，生词本从底边露出一条收藏句。](assets/readme/hero.jpg)

Peak Distance 是我做给自己用的浏览器扩展。读网页、刷 X 或看 YouTube 时，遇到想记住的表达，可以连同原句和来源一起收藏。下次翻生词本，还能从那句话接着学。

## 从查词到复习

在网页上选中 **slow down**，查一下意思，再点书签。回到生词本打开原句复习，那句话还在，挖空的地方留给自己想。

[![真实界面演示。左边的词卡显示 slow down、原句和实心书签，右边在同一句里挖空这个短语供复习。](assets/readme/demo.png)](assets/readme/demo.png)

看 YouTube 时，也可以开双语字幕、收藏整句或按句回听。不同语言的记录放在同一个生词本里，可以按语言筛选，也能搜原句和译文。

## 快速开始

当前发布版为 [v0.72.4](https://github.com/Kylan3320/peak-distance/releases/tag/v0.72.4)。桌面 Chrome 需要 142 或更新版本。

1. 下载并解压 [最新 Release](https://github.com/Kylan3320/peak-distance/releases/latest) 里的 `-chrome.zip`。
2. 打开 `chrome://extensions`（Edge 用 `edge://extensions`），开启「开发者模式」。
3. 点「加载已解压的扩展程序」，选择包含 `manifest.json` 的文件夹。

装好后刷新网页，选中一个词试试。升级时把新版解压到空目录，用完整文件清单替换原安装目录中的扩展文件，保留原安装路径。到扩展页点「重新加载」，再刷新网页。

## 记录存在哪里

默认存在当前浏览器。想用 Obsidian 整理，可以在「设置 → 文件共享」连接本地目录，把词语、句子和笔记写成 Markdown。同一台电脑上的 Chrome 和 Edge 可以连接同一个目录。[学习库文档](docs/specs/vault-collections-sync.md)

<details>
<summary>AI 问答和在线服务</summary>

常规查词和翻译无需 API Key。想带着原文提问，可以在「设置 → AI 服务」配置自己的服务和 Key。在线查询会把所需文本发给对应服务，AI 问答会发送问题和附上的材料。Key 保存在当前浏览器。

</details>

## 文档

| 入口 | 内容 |
| --- | --- |
| [产品说明](docs/PRD.md) | 功能和支持范围 |
| [开发](docs/ARCHITECTURE.md) | 代码入口和模块 |
| [路线图](docs/ROADMAP.md) | 下一项、缺陷与待验条件 |

<details>
<summary>从源码构建</summary>

用 Node.js 22.12 或更新版本运行 `npm ci` 和 `npm run build`，再在独立浏览器配置中加载 `.output/build/chrome-mv3`。

</details>

## 开发检查

文档核对事实和受影响的链接；逻辑修复检查复现及相邻回归；界面改动用当前构建检查相关操作。涉及浏览器差异时分别检查 Chrome／Edge。

### 发布

1. 新功能递增次版本，修复递增补丁版本。同步提交 `package.json` 和 `package-lock.json`。在版本提交上运行 `npm ci` 和 `npm run zip`。
2. 将 `.output/build` 中的待发布 ZIP 解压到空目录，确认该目录的 `manifest.json` 版本与包名一致。将 `PEAK_DISTANCE_UI_EXTENSION` 指向该目录，再运行 `npm run verify-local`；浏览器专项使用同一目录。改动界面语言或设置交互时加跑 `npm run check-ui-i18n`。
3. 通过后给版本提交打 `v<version>` 标签，上传已验收的 ZIP 为 Release 附件。Release 写本版变化，中英文 README 更新下载版本。完整工程可检出该标签。

`e2e-check` 用于实机检查；提供 `BLC_SETTINGS_PATH` 时会读取其中的 Key 并可发送真实 AI 请求。

[MIT](LICENSE)
