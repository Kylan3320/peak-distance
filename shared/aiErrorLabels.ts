export const AI_ERROR_LABEL: Record<string, string> = {
  'invalid-config': 'AI 配置无效，请在设置中检查接口与模型',
  permission: '请在设置中重新保存 AI 配置并允许访问服务地址',
  'no-key': '尚未配置 API key，可先保存原文',
  auth: 'API key 无效或无权限',
  'rate-limit': '请求过于频繁，稍后再试',
  network: '网络错误',
  http: '服务返回异常',
  'bad-response': '服务响应无法解析',
};
