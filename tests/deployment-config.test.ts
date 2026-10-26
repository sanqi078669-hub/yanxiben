import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDeploymentConfig } from "../src/lib/deployment-config";
test("正式配置缺项或拼错必须拒绝，本地 HTTP 可启动", () => {
  validateDeploymentConfig({});
  validateDeploymentConfig({
    PUBLIC_ORIGIN: "http://127.0.0.1:3000",
    RESTORE_MODE: "local",
  });
  const valid = {
    YANXI_DEPLOYMENT: "invited",
    PUBLIC_ORIGIN: "https://study.example.org",
    PROXY_SECRET: "a".repeat(48),
    SECURE_COOKIES: "1",
    CAPACITY_POLICY: "invited",
    RESTORE_MODE: "admin",
    AI_ENABLED: "0",
  };
  validateDeploymentConfig(valid);
  for (const key of Object.keys(valid)) {
    const env: Record<string, string | undefined> = { ...valid };
    delete env[key];
    assert.throws(() => validateDeploymentConfig(env), key);
    env[key] = "typo";
    assert.throws(() => validateDeploymentConfig(env), key);
  }
});
