# 来源与复用

## 实现参考

| 来源 | 用途与状态 |
| --- | --- |
| [yt-dual-subs](https://github.com/Gythiro/yt-dual-subs) | 已移植字幕获取、tlang URL 构造及 Google 翻译；真实服务与逐来源检查边界见 [M6 报告](specs/m6-verification-report.md)，视频观看实机证据见 [M7 报告](specs/m7-verification-report.md) |
| [Saladict](https://github.com/crimx/ext-saladict) | M6 在线词典调研参考，未复制其源码；本地解析按实际响应实现。参考 [剑桥](https://github.com/crimx/ext-saladict/blob/dev/src/components/dictionaries/cambridge/engine.ts)、[牛津](https://github.com/crimx/ext-saladict/blob/dev/src/components/dictionaries/oaldict/engine.ts)、[有道](https://github.com/crimx/ext-saladict/blob/dev/src/components/dictionaries/youdao/engine.ts) |
| [Language Reactor](https://www.languagereactor.com/) | 产品交互参考；[开发者说明](https://forum.languagelearningwithnetflix.com/t/user-dictionary-syntax/994)确认外部词典 URL 模板，不据此推断内置词典来源 |
| [asbplayer](https://github.com/asbplayer/asbplayer) | 字幕学习与播放交互参考 |
| [WXT](https://wxt.dev/guide/installation.html) | 扩展工程文档 |

## 历史来源：删除按钮

旧实现适配自 Moumen Soliman 的 [NativeDelete](https://21st.dev/@moumensoliman/components/delete-button)。官方页面未提供对应旧源码的版本与许可，当前使用项目自有的 [删除确认](../shared/deleteButton.ts)；[旧移植记录](https://github.com/Rayyy3320/peak-distance/blob/41398a81381312a142e0a8029dab4621c194921e/docs/REFERENCES.md#m10-删除交互移植)保留作者、来源和历史落点。

## 品牌与设计素材

- 用户提供的 ChatGPT 生图包括[山峰原图](../design/brand/peak-mark.png)、[纸纹](../public/brand/paper-tile.png)及[停用的山海插画](https://github.com/Rayyy3320/peak-distance/blob/41398a81381312a142e0a8029dab4621c194921e/public/brand/mountain-coast.png)。
- [图标生成脚本](../tools/make-brand-assets.py)用山峰原图与纸纹生成[工具栏图标](../public/brand/peak-icon.png)。
- [五张界面确认稿](specs/ui-refresh.md#确认稿)由 ImageGen 基于用户提供的旧方案生成，经用户确认后保存在 `design/ui-refresh/`。

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

## M6 接入记录

2026-10-02 的词典与翻译服务响应样例见[历史调查](https://github.com/Kylan3320/peak-distance/blob/b1f2ab02fd907e2b8f4e3aa2804194d3a85ef8cc/docs/REFERENCES.md#m6-接入记录)。当前词典优先级见 [PRD](PRD.md#查询与调用)，请求及解析由来源模块维护。

Google 路径参考 / 移植自 [yt-dual-subs commit 5657c8a](https://github.com/Gythiro/yt-dual-subs/commit/5657c8a18ca30c84b5d4662bca58e3e9214ffdff) 的 `background.js` `gtxFetch`；本地落点 `lib/regularTranslation.ts`。MIT，Copyright (c) 2026 Gythiro；许可全文见上节。词典模块 `lib/onlineDictionary.ts` 按本轮实际响应实现，未复制 Saladict 源码。

M6 产品接入：`entrypoints/youtube-inject.content.ts` 复用同一 commit 的 `inject.js` `buildUrl` 参数规则；中文独立轨道按时间交集对齐，平台配对先按时间匹配再随 ASR 合并转换。对齐与取消实现位于 `shared/cues.ts` 及两个 YouTube 入口。当时受控测试与真实视频验证边界记录在 [M6 报告](specs/m6-verification-report.md)，后续人工／自动英文视频观看证据见 [M7 报告](specs/m7-verification-report.md)。
