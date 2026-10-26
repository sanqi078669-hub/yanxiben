// Explicitly opt-in: only synthetic material is sent; profile secrets stay local.
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
if (!process.argv.includes("--live")) throw Error("Explicit --live required");
const sourceIndex = process.argv.indexOf("--source-data");
assert(
  sourceIndex >= 0,
  "--source-data must name an existing isolated QA data directory",
);
const source = path.resolve(process.argv[sourceIndex + 1]),
  qaRoot = path.resolve("test-results");
assert(
  source.startsWith(qaRoot + path.sep),
  "Only test-results QA profiles may be used",
);
const sourceDb = new DatabaseSync(path.join(source, "yanxiben.sqlite"), {
  readOnly: true,
});
const candidates = readdirSync(path.join(source, "ai-private")).filter((name) =>
  /^[a-f0-9-]{36}\.json$/i.test(name),
);
assert.equal(
  candidates.length,
  1,
  "Select a QA source with exactly one saved AI account",
);
const owner = candidates[0].slice(0, -5);
assert(
  sourceDb.prepare("SELECT id FROM users WHERE id=?").get(owner),
  "QA account unavailable",
);
sourceDb.close();
const sourceFile = path.join(source, "ai-private", owner + ".json"),
  sourceHash = createHash("sha256")
    .update(readFileSync(sourceFile))
    .digest("hex");
const folder = path.join(qaRoot, "qa-ai-boundaries-" + Date.now());
mkdirSync(folder, { recursive: true });
process.env.DATA_DIR = folder;
process.env.AI_KEY_FILE = folder + "-master.key";
cpSync(path.join(source, "ai-private"), path.join(folder, "ai-private"), {
  recursive: true,
});
if (!existsSync(path.join(folder, "ai-private", "encryption-key")))
  throw Error(
    "This acceptance fixture expects a legacy key for migration validation",
  );
const { run, one } = await import("../src/lib/db");
const { defaults } = await import("../src/lib/model");
const { activeConfig, publicConfig, saveConfig } =
  await import("../src/modules/ai/config");
const { complete, aiStatus } = await import("../src/modules/ai/provider");
const { audited, auditList } = await import("../src/modules/ai/audit");
const { budgetStatus } = await import("../src/modules/ai/budget");
const { savePrice } = await import("../src/modules/ai/pricing");
run(
  "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
  owner,
  "qa-ai",
  bcrypt.hashSync("local-qa-ai-only-2026", 4),
  JSON.stringify(defaults),
  "user",
);
writeFileSync(
  path.join(folder, "session-secret"),
  createHash("sha512").update(folder).digest("hex"),
);
const config = activeConfig(owner);
assert(
  config?.host === "api.deepseek.com",
  "Only DeepSeek is authorized for this acceptance",
);
assert(
  !existsSync(path.join(folder, "ai-private", "encryption-key")) &&
    existsSync(process.env.AI_KEY_FILE),
);
const { hasKey: _hasKey, ...profile } = publicConfig(owner).profiles.find(
  (p) => p.id === publicConfig(owner).activeId,
)!;
// Synthetic price is deliberately labelled: tests estimate mechanics, not live pricing.
savePrice(owner, {
  model: config.model,
  host: config.host,
  currency: "CNY",
  input: 1,
  output: 1,
  source: "https://api-docs.deepseek.com/",
  updated: "2026-10-23",
});
const report: Record<string, unknown> = {
  timestamp: new Date().toISOString(),
  folder,
  model: config.model,
  host: config.host,
  priceBasis:
    "synthetic 1 CNY per million tokens for acceptance; not supplier tariff",
  checks: [],
};
const checks = report.checks as unknown[];
const prompt =
  '输出 JSON {"lines": string[]}，lines 恰好包含180条，每条格式为“第N条：复习时先独立作答，核对关键条件，再记录错误原因并安排下一次练习。”，N依次为1到180。完整展开全部条目，不要省略，不要用代码生成。';
try {
  saveConfig(owner, {
    action: "save",
    profile: { ...profile, key: "", maxOutputTokens: 16000 },
  });
  const result = await audited(owner, "FIX10长输出", () =>
    complete(
      prompt,
      { purpose: "合成长度验收，无个人材料" },
      z.object({ lines: z.array(z.string()).length(180) }),
      [],
      undefined,
      owner,
    ),
  );
  const long = auditList(owner).find((r) => r.id === result.audit.id)!;
  assert(
    long.cost && long.cost.outputTokens > 4000,
    "Long-output acceptance must exceed old 4000 token cap",
  );
  checks.push({
    name: "long-output",
    passed: true,
    characters: result.lines.join("\n").length,
    outputTokens: long.cost.outputTokens,
  });
  console.log("PASS long-output", long.cost.outputTokens, "tokens");
  saveConfig(owner, {
    action: "save",
    profile: { ...profile, key: "", maxOutputTokens: 4000 },
  });
  await assert.rejects(
    () =>
      audited(owner, "FIX10截断", () =>
        complete(
          prompt,
          {},
          z.object({ lines: z.array(z.string()).length(180) }),
          [],
          undefined,
          owner,
        ),
      ),
    { code: "AI_OUTPUT_TRUNCATED" },
  );
  const truncated = auditList(owner).find((r) => r.action === "FIX10截断")!;
  assert.equal(truncated.result, null);
  assert(truncated.cost && truncated.cost.outputTokens >= 4000);
  checks.push({
    name: "truncated-cost",
    passed: true,
    outputTokens: truncated.cost.outputTokens,
    knownCost: !!truncated.cost,
  });
  console.log("PASS truncated-cost");
  const calls = budgetStatus(owner).calls;
  saveConfig(owner, {
    action: "limits",
    limits: { dailyCalls: calls, dailyCost: null },
  });
  await assert.rejects(
    () =>
      complete(
        '返回 {"ok":true}',
        {},
        z.object({ ok: z.literal(true) }),
        [],
        undefined,
        owner,
      ),
    { code: "AI_DAILY_CALL_LIMIT" },
  );
  assert.equal(budgetStatus(owner).calls, calls);
  checks.push({ name: "daily-call-stop-without-send", passed: true });
  saveConfig(owner, {
    action: "limits",
    limits: {
      dailyCalls: 100,
      dailyCost: { amount: 0.000001, currency: "CNY" },
    },
  });
  await assert.rejects(
    () =>
      complete(
        '返回 {"ok":true}',
        {},
        z.object({ ok: z.literal(true) }),
        [],
        undefined,
        owner,
      ),
    { code: "AI_DAILY_COST_LIMIT" },
  );
  checks.push({ name: "daily-cost-stop-without-send", passed: true });
  saveConfig(owner, {
    action: "limits",
    limits: { dailyCalls: 100, dailyCost: null },
  });
  checks.push({ name: "legacy-key-migrated-and-usable", passed: true });
  assert.equal(one("SELECT count(*) n FROM entries")!.n, 0);
  assert.equal(
    createHash("sha256").update(readFileSync(sourceFile)).digest("hex"),
    sourceHash,
  );
  assert(
    existsSync(path.join(source, "ai-private", "encryption-key")),
    "Source legacy profile must stay unchanged",
  );
  report.status = "passed";
  report.budget = budgetStatus(owner);
  report.statusMetadata = aiStatus(owner);
} catch (e) {
  report.status = "failed";
  report.error = {
    code: (e as { code?: string }).code,
    message: (e as Error).message,
  };
  process.exitCode = 1;
} finally {
  writeFileSync(
    "test-results/ai-boundaries-live.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      status: report.status,
      checks,
      error: report.error,
      folder,
    }),
  );
}
