# README 视觉素材

- [首图底图](grid-art.jpg) 由 imagegen 生成，构图参考 [OpenAI LifeVal 宣传片](https://x.com/OpenAI/status/2117307611338997846)。标题单独排版，真实生词本截图从底边裁切。
- 正文演示使用实际扩展界面。示例网页、收藏句和有道查词返回值均为受控演示数据。词卡的收藏与同一句的复习由扩展处理。
- [render.mjs](render.mjs) 在独立的浏览器配置中采集简体中文和英文界面，导出中英文首图和演示图。

先构建扩展，再在项目根目录运行：

```sh
npm run build
node assets/readme/source/render.mjs
```

默认使用本机 Windows Edge。可用 `BLC_CHROME` 指定支持加载解压扩展的 Chromium 可执行文件，或用 `PEAK_DISTANCE_UI_EXTENSION` 指定构建目录。
