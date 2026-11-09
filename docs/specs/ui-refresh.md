# 双主题界面确认稿

界面规则见 [设计](../../design.md)，主题默认值和持久化见 [PRD](../PRD.md#工作区与设置)。

## 确认稿

| 页面 | 已确认图片 |
| --- | --- |
| 当前内容 | [01-current-content.png](../../design/ui-refresh/01-current-content.png) |
| 生词本 | [02-vocabulary.png](../../design/ui-refresh/02-vocabulary.png) |
| AI 问答 | [03-chat.png](../../design/ui-refresh/03-chat.png) |
| 设置 | [04-settings.png](../../design/ui-refresh/04-settings.png) |
| 复习 | [05-review.png](../../design/ui-refresh/05-review.png) |


## 定向检查

- `node tools/check-chat-welcome.mjs` 检查加载、失败恢复、空态和主题保存。
- `node tools/check-chat-interactions.mjs` 检查发送、停止、材料和草稿。
- `npm run check-ui-i18n` 检查五语言及设置交互。

[改造范围与阶段验收](https://github.com/Rayyy3320/peak-distance/blob/41398a81381312a142e0a8029dab4621c194921e/docs/specs/ui-refresh.md)。
