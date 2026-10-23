import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-audit-"));
const { audited, auditList, auditFeedback, aiUsage } =
  await import("../src/modules/ai/audit");
const { savePrice, estimate } = await import("../src/modules/ai/pricing");
const { saveConfig } = await import("../src/modules/ai/config");
test("调用费用快照不受后续修改单价影响", async () => {
  const owner = randomUUID(),
    id = randomUUID();
  saveConfig(owner, {
    action: "save",
    profile: {
      id,
      name: "费用测试",
      base: "https://example.com",
      model: "mock-price",
      key: "fixture-key",
      vision: false,
    },
  });
  saveConfig(owner, { action: "activate", id });
  const price = {
    model: "mock-price",
    host: "example.com",
    currency: "USD",
    input: 2,
    output: 8,
    source: "https://example.com/pricing",
    updated: "2026-10-23",
  };
  savePrice(owner, price);
  await audited(owner, "priced", async () => {
    Object.assign(aiUsage.getStore()!, {
      tokens: 1500,
      input: 1000,
      output: 500,
    });
    return { ok: true };
  });
  savePrice(owner, { ...price, input: 200 });
  const record = auditList(owner)[0];
  assert.equal(record.cost?.amount, 0.006);
  assert.equal(record.cost?.price.input, 2);
});
test("费用仅按匹配账号模型与主机计算，未知用量不计零，历史保存原价格", async () => {
  const owner = randomUUID();
  const p = {
    model: "",
    host: "",
    currency: "USD",
    input: 2,
    output: 8,
    source: "https://example.com/prices",
    updated: "2026-10-23",
  };
  // Disabled AI uses empty source metadata; direct estimation uses an explicit test model.
  const price = { ...p, model: "test-model", host: "example.com" };
  savePrice(owner, price);
  assert.equal(
    estimate(owner, price.model, price.host, 1000, 500)?.amount,
    0.006,
  );
  assert.equal(estimate(owner, price.model, price.host, null, 500), null);
  assert.equal(
    estimate(randomUUID(), price.model, price.host, 1000, 500),
    null,
  );
  assert.equal(estimate(owner, "other", price.host, 1000, 500), null);
  assert.throws(() => savePrice(owner, { ...price, input: -1 }));
  assert.throws(() =>
    savePrice(owner, { ...price, source: "javascript:alert(1)" }),
  );
});
test("调用记录保留来源与未知用量，反馈隔离账号，不保存失败敏感消息", async () => {
  const owner = randomUUID(),
    other = randomUUID();
  const result = await audited(owner, "study:organize", async () => ({
    title: "建议",
  }));
  assert.ok(result.audit.id);
  assert.equal(auditList(owner)[0].tokens, null);
  auditFeedback(owner, { id: result.audit.id, feedback: "答案需修正" });
  assert.equal(auditList(owner)[0].feedback, "答案需修正");
  assert.equal(auditList(other).length, 0);
  assert.throws(() =>
    auditFeedback(other, { id: result.audit.id, feedback: "篡改" }),
  );
  await assert.rejects(() =>
    audited(owner, "failure", async () => {
      throw new Error("SECRET_KEY");
    }),
  );
  assert.ok(!JSON.stringify(auditList(owner)).includes("SECRET_KEY"));
});
test("并行调用用量上下文互不串用", async () => {
  const a = randomUUID(),
    b = randomUUID();
  await Promise.all([
    audited(a, "a", async () => {
      aiUsage.getStore()!.tokens = 12;
      await Promise.resolve();
      return { ok: true };
    }),
    audited(b, "b", async () => {
      aiUsage.getStore()!.tokens = 27;
      return { ok: true };
    }),
  ]);
  assert.equal(auditList(a)[0].tokens, 12);
  assert.equal(auditList(b)[0].tokens, 27);
});
