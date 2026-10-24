// Official endpoint references checked 2026-10-23. Model IDs remain user-selected.
export const providerPresets = [
  {
    name: "DeepSeek",
    base: "https://api.deepseek.com",
    model: "deepseek-flash",
    tokenParameter: "max_tokens",
    docs: "https://api-docs.deepseek.com/",
  },
  {
    name: "OpenAI",
    base: "https://api.openai.com/v1",
    model: "",
    tokenParameter: "max_completion_tokens",
    docs: "https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create",
  },
  {
    name: "通义千问 · 北京",
    base: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "",
    tokenParameter: "max_tokens",
    docs: "https://help.aliyun.com/en/model-studio/base-url",
  },
  {
    name: "通义千问 · 新加坡",
    base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    model: "",
    tokenParameter: "max_tokens",
    docs: "https://help.aliyun.com/en/model-studio/base-url",
  },
] as const;
export function providerError(status: number) {
  if (status === 401)
    return "服务商拒绝认证，请检查密钥、账号区域与接口地址是否匹配";
  if (status === 403) return "当前账号无权使用此服务或模型，请检查服务商权限";
  if (status === 404) return "接口或模型不存在，请检查基础地址和模型名称";
  if (status === 429) return "服务商限流或额度不足，请检查配额后稍后重试";
  if (status === 400 || status === 422)
    return "服务商不接受本次参数，请检查模型、图片能力和输出长度参数";
  if (status >= 500) return "服务商暂时不可用，请稍后重试";
  return "AI 调用失败，请检查服务配置";
}
