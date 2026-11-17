# M9：AI 服务配置

本文维护 AI 服务的协议、授权和配置行为。

## 交付边界

- 服务商预设：DeepSeek、OpenAI、Anthropic、Gemini、GLM、Kimi。预设选择后填写 Key，手动保存后启用；协议、Base URL、模型按需展开修改，自定义服务使用相同表单。
- 文本请求支持 OpenAI Chat Completions、Anthropic Messages、Gemini generateContent / streamGenerateContent。
- 各服务配置分开持久化；旧 `deepseekApiKey` 在未建立新配置时继续读取，首次保存纳入 DeepSeek 配置，清除 DeepSeek Key 同时清除旧字段。
- 新地址只申请对应 HTTPS 域名权限；失败不替换活动服务，保留输入。地址／协议变更不自动复用原 Key。
- 解释、字幕和问答共用活动配置；每个已开始请求固定配置快照。缓存区分服务、协议、地址、模型；AI 字幕收到配置变化后取消旧请求、清理译文与失败状态，重取当前窗口。
- 高级设置按接口、地址和模型提供可用的推理档位，随服务配置保存。默认档位省略推理参数，兼容已有配置。更换模型或接口使原档位不可用时，表单恢复默认并就地提示。缓存同时区分生效的推理档位。

- 快调页对当前配置即时保存推理档位。已确认支持的 OpenAI 官方直连接口可显式切换 Fast 与标准档，按对应 API 档位计费。已有配置沿用项目的默认档位。服务档位随配置保存，也纳入 AI 缓存范围。 [OpenAI Fast 文档](https://developers.openai.com/api/docs/guides/fast-mode)

## 官方接口依据

- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat)、[GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)、[流式事件](https://platform.claude.com/docs/en/build-with-claude/streaming)、[模型 ID](https://platform.claude.com/docs/en/models/overview)
- [Gemini 内容生成与流式协议](https://ai.google.dev/api/generate-content)
- [DeepSeek](https://api-docs.deepseek.com/)、[GLM 快速开始](https://docs.bigmodel.cn/cn/guide/start/quick-start)、[Kimi Chat Completions](https://platform.kimi.com/docs/api/chat)
- [Chrome 可选权限](https://developer.chrome.com/docs/extensions/reference/api/permissions)

模型预设由 [aiConfig.ts](../../shared/aiConfig.ts) 定义。
