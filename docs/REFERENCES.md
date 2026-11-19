# 来源与复用

## 实现参考

英文字幕断句使用离线的 [Edge-Punct-Casing 模型](https://huggingface.co/frankyoujian/Edge-Punct-Casing/tree/bde453bde24b544f38ffdd56398bfadcd22ce935)。原作者归档中的模型和词表经 [sherpa-onnx 标点模型包](https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-online-punct-en-2024-08-06.tar.bz2) 发布，本地使用其中的 `model.int8.onnx` 和 `bpe.vocab`。Web 运行时使用 [sherpa_onnx_web 2.0.2](https://pub.dev/packages/sherpa_onnx_web/versions/2.0.2) 的同名 `assets/sherpa-onnx-wasm-web.{js,wasm}` 和 `assets/sherpa-onnx-punctuation.js`，对应 [sherpa-onnx 提交 5d2bd37](https://github.com/k2-fsa/sherpa-onnx/tree/5d2bd37de78b223a2e8e00e25483d12c5b164299)。原文件位于 `public/subtitle-segmentation/`，许可随扩展分发。

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
- [界面确认稿及历史设置图](DESIGN.md#界面确认稿)由 ImageGen 基于用户提供的旧方案生成，经用户确认。

## 已移植：yt-dual-subs

commit：[5657c8a18ca30c84b5d4662bca58e3e9214ffdff](https://github.com/Gythiro/yt-dual-subs/commit/5657c8a18ca30c84b5d4662bca58e3e9214ffdff)；本地参考副本 `.upstream/yt-dual-subs` 不入库。

| 原文件 | 本地落点 | 范围 |
| --- | --- | --- |
| inject.js | entrypoints/youtube-inject.content.ts、shared/youtube.ts、shared/subtitleTracker.ts | timedtext 捕获、json3 解析、来源身份、播放器字幕恢复；M6 增加 buildUrl 的 fmt/tlang 规则 |
| content.js | entrypoints/youtube.content.ts | CC 驱动、导航清理与消息过期判断 |
| inject.js 协议 | shared/protocol.ts | MAIN / ISOLATED 字幕桥 |

Google 翻译移植自同一提交的 `background.js` 中的 `gtxFetch`，本地落点为 [regularTranslation.ts](../lib/regularTranslation.ts)。各移植文件头部保留来源，Gythiro 的版权与 MIT 许可全文见[分发声明](../public/THIRD_PARTY_NOTICES.txt)。
