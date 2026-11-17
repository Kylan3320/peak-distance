export type AiProtocol = 'openai' | 'anthropic' | 'gemini';
export type AiReasoningEffort = 'off' | 'low' | 'high' | 'max';
export interface AiProfile { protocol: AiProtocol; baseUrl: string; model: string; apiKey: string; reasoningEffort?: AiReasoningEffort; serviceTier?: 'fast' | 'default' }
export const AI_PRESETS = {
  deepseek: { label: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  openai: { label: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  anthropic: { label: 'Anthropic · Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5' },
  gemini: { label: 'Google · Gemini', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.8-flash' },
  glm: { label: '智谱 · GLM', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3' },
  kimi: { label: '月之暗面 · Kimi', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3' },
  custom: { label: '自定义服务', protocol: 'openai', baseUrl: '', model: '' },
} satisfies Record<string, { label: string; protocol: AiProtocol; baseUrl: string; model: string }>;
export type AiProvider = keyof typeof AI_PRESETS;
export interface AiServices { active: AiProvider; profiles: Partial<Record<AiProvider, AiProfile>> }
export type AiConfig = AiProfile & { provider: AiProvider };

type ReasoningParameters = {
  reasoning_effort?: 'none' | 'low' | 'high' | 'xhigh' | 'max';
  thinking?: { type: 'disabled' | 'enabled' | 'between_tools'; budget_tokens?: number };
  output_config?: { effort: 'low' | 'high' | 'max' };
  thinkingConfig?: { thinkingLevel: 'low' | 'high' };
};
type ReasoningOptions = Partial<Record<AiReasoningEffort, ReasoningParameters>>;

const effortOptions = {
  low: { reasoning_effort: 'low' },
  high: { reasoning_effort: 'high' },
  max: { reasoning_effort: 'max' },
} satisfies ReasoningOptions;
const off = { reasoning_effort: 'none' } satisfies ReasoningParameters;
const claudeEffort = {
  low: { output_config: { effort: 'low' } },
  high: { output_config: { effort: 'high' } },
  max: { output_config: { effort: 'max' } },
} satisfies ReasoningOptions;

export function aiReasoningOptions(profile: Pick<AiProfile, 'protocol' | 'baseUrl' | 'model'>): ReasoningOptions {
  let host: string;
  try { host = new URL(normalizeAiBaseUrl(profile.baseUrl)).hostname; } catch { return {}; }
  const model = profile.model.replace(/^(models\/)|-\d{4}-?\d{2}-?\d{2}$/g, '');
  if (profile.protocol === 'openai') {
    if (host === 'api.openai.com') {
      if (/^(gpt-6\.1-terra|gpt-6-(sol|luna))$/.test(model)) return { off, ...effortOptions };
      if (/^(gpt-6-astra|gpt-6\.1-sol|gpt-5\.6-(sol|terra|luna))$/.test(model)) return effortOptions;
      if (/^gpt-5\.(5|4(-mini)?|2)$/.test(model)) return { off, ...effortOptions, max: { reasoning_effort: 'xhigh' } };
    }
    if (host === 'api.deepseek.com' && /^deepseek-(flash|v4-pro)$/.test(model)) return { off, ...effortOptions };
    if (host === 'open.bigmodel.cn' && model === 'glm-5.3') return effortOptions;
    if (host === 'api.moonshot.cn' && /^kimi-k3(\.1-pro(-highspeed)?)?$/.test(model)) return effortOptions;
  }
  if (profile.protocol === 'anthropic' && host === 'api.anthropic.com') {
    if (model === 'claude-haiku-4-5') {
      return {
        off: { thinking: { type: 'disabled' } },
        low: { thinking: { type: 'enabled', budget_tokens: 1024 } },
        high: { thinking: { type: 'enabled', budget_tokens: 2048 } },
        max: { thinking: { type: 'enabled', budget_tokens: 3072 } },
      };
    }
    if (model === 'claude-sonnet-5-5') return { off: { thinking: { type: 'between_tools' } }, ...claudeEffort };
    if (/^claude-(haiku-5-5|opus-5|sonnet-5)$/.test(model)) return { off: { thinking: { type: 'disabled' }, output_config: { effort: 'high' } }, ...claudeEffort };
    if (/^claude-(opus-5-5|(fable|mythos)-5(-[12])?)$/.test(model)) return claudeEffort;
  }
  if (profile.protocol === 'gemini' && host === 'generativelanguage.googleapis.com'
    && /^gemini-3\.[5678]-flash$/.test(model)) {
    return { low: { thinkingConfig: { thinkingLevel: 'low' } }, high: { thinkingConfig: { thinkingLevel: 'high' } } };
  }
  return {};
}

export function aiReasoningParameters(profile: AiProfile): ReasoningParameters {
  return profile.reasoningEffort ? aiReasoningOptions(profile)[profile.reasoningEffort] ?? {} : {};
}

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && Object.hasOwn(AI_PRESETS, value);
}
export function defaultAiProfile(provider: AiProvider): AiProfile {
  const { protocol, baseUrl, model } = AI_PRESETS[provider];
  return { protocol, baseUrl, model, apiKey: '' };
}
export function normalizeAiBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('请填写不含凭据、查询参数或片段的 HTTPS API 地址');
  url.pathname = url.pathname.replace(/\/(chat\/completions|messages)\/?$/, '');
  return url.href.replace(/\/+$/, '');
}
// Models with a documented OpenAI API Fast tier. Compatible gateways have their own contracts.
const fastModels = new Set(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol']);
export function supportsAiFast(profile: Pick<AiProfile, 'protocol' | 'baseUrl' | 'model'>): boolean {
  if (profile.protocol !== 'openai' || !fastModels.has(profile.model)) return false;
  try { return normalizeAiBaseUrl(profile.baseUrl) === AI_PRESETS.openai.baseUrl; }
  catch { return false; }
}

export function validateAiProfile(profile: AiProfile): string | null {
  if (!['openai', 'anthropic', 'gemini'].includes(profile.protocol)) return '请选择接口格式';
  try { normalizeAiBaseUrl(profile.baseUrl); } catch { return '请填写有效的 HTTPS API 地址（Base URL）'; }
  if (!profile.model.trim() || profile.model.length > 200 || /[\s?#]/.test(profile.model)) return '请填写有效的模型 ID';
  if (profile.reasoningEffort && !Object.hasOwn(aiReasoningOptions(profile), profile.reasoningEffort)) return '此模型不支持所选推理强度';
  if (!profile.apiKey.trim() || /[\r\n]/.test(profile.apiKey) || profile.apiKey.length > 4096) return '请填写有效的 API Key';
  return null;
}
export function readAiServices(stored: Record<string, unknown>): AiServices {
  // Legacy key stays usable until the first settings save; canonical storage then owns all profiles.
  if (stored.aiServices === undefined) return { active: 'deepseek', profiles: { deepseek: { ...defaultAiProfile('deepseek'), apiKey: typeof stored.deepseekApiKey === 'string' ? stored.deepseekApiKey.trim() : '' } } };
  const value = stored.aiServices as AiServices;
  const profiles: AiServices['profiles'] = {};
  for (const provider of Object.keys(AI_PRESETS) as AiProvider[]) {
    const p = value?.profiles?.[provider];
    if (p && ['openai', 'anthropic', 'gemini'].includes(p.protocol) && ['baseUrl','model','apiKey'].every(k => typeof p[k as keyof AiProfile] === 'string')) {
      const profile: AiProfile = { protocol: p.protocol, baseUrl: p.baseUrl, model: p.model, apiKey: p.apiKey };
      if (p.reasoningEffort && Object.hasOwn(aiReasoningOptions(profile), p.reasoningEffort)) profile.reasoningEffort = p.reasoningEffort;
      if ((p.serviceTier === 'fast' || p.serviceTier === 'default') && supportsAiFast(profile)) profile.serviceTier = p.serviceTier;
      profiles[provider] = profile;
    }
  }
  return { active: isAiProvider(value?.active) ? value.active : 'custom', profiles };
}
export function aiCacheScope(config: AiConfig): string {
  const scope = [config.provider, config.protocol, normalizeAiBaseUrl(config.baseUrl), config.model];
  if (config.reasoningEffort) scope.push(config.reasoningEffort);
  if (config.serviceTier && supportsAiFast(config)) scope.push('tier=' + config.serviceTier);
  return JSON.stringify(scope);
}
