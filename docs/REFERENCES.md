# 来源与复用

## 实现参考

| 来源 | 用途与状态 |
| --- | --- |
| [yt-dual-subs](https://github.com/Gythiro/yt-dual-subs) | 移植字幕获取、tlang URL 构造及 Google 翻译 |
| [Saladict](https://github.com/crimx/ext-saladict) | M6 在线词典调研参考，未复制其源码；本地解析按实际响应实现。参考 [剑桥](https://github.com/crimx/ext-saladict/blob/dev/src/components/dictionaries/cambridge/engine.ts)、[牛津](https://github.com/crimx/ext-saladict/blob/dev/src/components/dictionaries/oaldict/engine.ts)、[有道](https://github.com/crimx/ext-saladict/blob/dev/src/components/dictionaries/youdao/engine.ts) |
| [Language Reactor](https://www.languagereactor.com/) | 产品交互参考；[开发者说明](https://forum.languagelearningwithnetflix.com/t/user-dictionary-syntax/994)确认外部词典 URL 模板，不据此推断内置词典来源 |
| [asbplayer](https://github.com/asbplayer/asbplayer) | 字幕学习与播放交互参考 |
| [WXT](https://wxt.dev/guide/installation.html) | 扩展工程文档 |

## 历史来源：删除按钮

旧实现适配自 Moumen Soliman 的 [NativeDelete](https://21st.dev/@moumensoliman/components/delete-button)。官方页面未提供对应旧源码的版本与许可，当前使用项目自有的 [删除确认](../shared/deleteButton.ts)；[旧移植记录](https://github.com/Rayyy3320/peak-distance/blob/41398a81381312a142e0a8029dab4621c194921e/docs/REFERENCES.md#m10-删除交互移植)保留作者、来源和历史落点。

## 品牌与设计素材

- 用户提供的 ChatGPT 生图包括[山峰原图](../design/brand/peak-mark.png)、[纸纹](../public/brand/paper-tile.png)及[停用的山海插画](https://github.com/Rayyy3320/peak-distance/blob/41398a81381312a142e0a8029dab4621c194921e/public/brand/mountain-coast.png)。
- [图标生成脚本](../tools/make-brand-assets.py)用山峰原图与纸纹生成[工具栏图标](../public/brand/peak-icon.png)。
- [五张界面确认稿](../design.md#界面确认稿)由 ImageGen 基于用户提供的旧方案生成，经用户确认后保存在 `design/ui-refresh/`。

## 已移植：yt-dual-subs

commit：[5657c8a18ca30c84b5d4662bca58e3e9214ffdff](https://github.com/Gythiro/yt-dual-subs/commit/5657c8a18ca30c84b5d4662bca58e3e9214ffdff)；本地参考副本 `.upstream/yt-dual-subs` 不入库。

| 原文件 | 本地落点 | 范围 |
| --- | --- | --- |
| inject.js | entrypoints/youtube-inject.content.ts、shared/youtube.ts、shared/subtitleTracker.ts | timedtext 捕获、json3 解析、来源身份、播放器字幕恢复；M6 增加 buildUrl 的 fmt/tlang 规则 |
| content.js | entrypoints/youtube.content.ts | CC 驱动、导航清理与消息过期判断 |
| inject.js 协议 | shared/protocol.ts | MAIN / ISOLATED 字幕桥 |

各移植文件头部保留来源。MIT，Copyright (c) 2026 Gythiro：

  > Permission is hereby granted, free of charge, to any person obtaining a copy
  > of this software and associated documentation files (the "Software"), to deal
  > in the Software without restriction, including without limitation the rights
  > to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  > copies of the Software, and to permit persons to whom the Software is
  > furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in all
  > copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  > IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  > FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  > AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  > LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  > OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  > SOFTWARE.


Google 翻译移植自同一提交的 `background.js` 中的 `gtxFetch`，本地落点为 [regularTranslation.ts](../lib/regularTranslation.ts)。yt-dual-subs 的许可同上。
