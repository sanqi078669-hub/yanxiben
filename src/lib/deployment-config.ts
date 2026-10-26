/** Local HTTP remains supported; invited HTTPS deployments must opt in explicitly. */
export function validateDeploymentConfig(
  env: Record<string, string | undefined> = process.env,
) {
  for (const [key, values] of Object.entries({
    YANXI_DEPLOYMENT: ["local", "invited"],
    CAPACITY_POLICY: ["invited"],
    RESTORE_MODE: ["local", "admin"],
    SECURE_COOKIES: ["0", "1"],
    AI_ENABLED: ["0", "1"],
  })) {
    if (env[key] !== undefined && !values.includes(env[key]!))
      throw new Error(`配置无效：${key}`);
  }
  let origin: URL | undefined;
  if (env.PUBLIC_ORIGIN) {
    try {
      origin = new URL(env.PUBLIC_ORIGIN);
    } catch {
      throw new Error("配置无效：PUBLIC_ORIGIN");
    }
    if (
      origin.origin !== env.PUBLIC_ORIGIN ||
      !["http:", "https:"].includes(origin.protocol)
    )
      throw new Error("配置无效：PUBLIC_ORIGIN");
  }
  if (env.YANXI_DEPLOYMENT === "invited" || origin?.protocol === "https:") {
    const required = {
      YANXI_DEPLOYMENT: env.YANXI_DEPLOYMENT === "invited",
      PUBLIC_ORIGIN: origin?.protocol === "https:",
      PROXY_SECRET: (env.PROXY_SECRET?.length || 0) >= 32,
      SECURE_COOKIES: env.SECURE_COOKIES === "1",
      CAPACITY_POLICY: env.CAPACITY_POLICY === "invited",
      RESTORE_MODE: env.RESTORE_MODE === "admin",
      AI_ENABLED: ["0", "1"].includes(env.AI_ENABLED || ""),
    };
    for (const [key, valid] of Object.entries(required))
      if (!valid) throw new Error(`正式部署缺少或错误配置：${key}`);
  }
}
