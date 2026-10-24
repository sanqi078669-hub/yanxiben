import "./ai-test-key";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID, randomBytes, createCipheriv } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { z } from "zod";
process.env.DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-ai-boundaries-"),
);
const { publicAddress, publicTarget, resolvePublic, createPublicTransport } =
  await import("../src/modules/ai/network");
const { masterKey, decryptWithKey } =
  await import("../src/modules/ai/master-key");
const { saveConfig, activeConfig, publicConfig } =
  await import("../src/modules/ai/config");
const { complete, aiStatus } = await import("../src/modules/ai/provider");
const { budgetStatus, reserveBudget } =
  await import("../src/modules/ai/budget");
const { audited, auditList } = await import("../src/modules/ai/audit");
const { savePrice } = await import("../src/modules/ai/pricing");
const { run } = await import("../src/lib/db");
const { defaults } = await import("../src/lib/model");
function account() {
  const owner = randomUUID(),
    id = randomUUID();
  run(
    "INSERT INTO users VALUES(?,?,?,?)",
    owner,
    owner,
    "fixture",
    JSON.stringify(defaults),
  );
  const profile = {
    id,
    name: "测试",
    base: "https://example.com/v1",
    model: "fixture",
    vision: false,
    key: "synthetic-fixture-key",
  };
  saveConfig(owner, { action: "save", profile });
  saveConfig(owner, { action: "activate", id });
  return { owner, profile };
}
const response = (
  finish = "stop",
  usage: unknown = {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
  },
) =>
  new Response(
    JSON.stringify({
      usage,
      choices: [{ finish_reason: finish, message: { content: '{"ok":true}' } }],
    }),
  );
const price = {
  model: "fixture",
  host: "example.com",
  currency: "USD",
  input: 2,
  output: 8,
  source: "https://example.com/price",
  updated: "2026-10-23",
};

test("公网目标拒绝私网、特殊地址、IPv6、URL 伪装和混合 DNS", async () => {
  for (const ip of [
    "0.0.0.0",
    "127.0.0.1",
    "10.1.2.3",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "64:ff9b::7f00:1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  for (const url of [
    "https://localhost",
    "https://foo.localhost",
    "https://service.local",
    "https://0x7f000001",
    "https://2130706433",
    "https://[::1]",
    "http://example.com",
    "https://a:b@example.com",
    "https://example.com?q=1",
  ])
    assert.throws(() => publicTarget(url), /公网/);
  for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])
    assert.equal(publicAddress(ip), true);
  const dns = (answers: { address: string; family: number }[]) => async () =>
    answers;
  await assert.rejects(
    () =>
      resolvePublic(
        "https://example.com",
        dns([{ address: "127.0.0.1", family: 4 }]),
      ),
    /公网/,
  );
  await assert.rejects(
    () =>
      resolvePublic(
        "https://example.com",
        dns([
          { address: "1.1.1.1", family: 4 },
          { address: "10.0.0.1", family: 4 },
        ]),
      ),
    /公网/,
  );
  assert.equal(
    (
      await resolvePublic(
        "https://example.com",
        dns([{ address: "1.1.1.1", family: 4 }]),
      )
    ).address,
    "1.1.1.1",
  );
});

test("连接固定已检查 IP 并保留 TLS 主机；拒绝重定向，DNS 等待可以取消", async () => {
  let status = 200,
    lookupCount = 0;
  const dns = async () => {
    lookupCount++;
    return [{ address: "1.1.1.1", family: 4 }];
  };
  const send = ((url: URL, options: any, callback: (res: any) => void) => {
    assert.equal(url.hostname, "example.com");
    assert.equal(options.agent, false);
    assert.equal(options.family, 4);
    options.lookup(
      "example.com",
      {},
      (error: unknown, address: string, family: number) => {
        assert.equal(error, null);
        assert.equal(address, "1.1.1.1");
        assert.equal(family, 4);
      },
    );
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      const res = Object.assign(Readable.from([Buffer.from("ok")]), {
        statusCode: status,
        rawHeaders: ["Content-Type", "text/plain"],
      });
      callback(res);
    };
    return req;
  }) as typeof import("node:https").request;
  const transport = createPublicTransport(dns, send);
  assert.equal(
    await (await transport("https://example.com/chat/completions")).text(),
    "ok",
  );
  assert.equal(lookupCount, 1);
  status = 302;
  await assert.rejects(() => transport("https://example.com"), /重定向/);
  const controller = new AbortController();
  const waiting = createPublicTransport(
    (() => new Promise(() => {})) as typeof dns,
    send,
  )("https://example.com", { signal: controller.signal });
  controller.abort();
  await assert.rejects(() => waiting);
});

test("旧加密主密钥验证密文后迁出数据目录；丢失、冲突和错误目录不会重置", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "yanxi-key-")),
    data = path.join(root, "data"),
    dir = path.join(data, "ai-private");
  const prior = process.env.AI_KEY_FILE;
  try {
    mkdirSync(dir, { recursive: true });
    const key = randomBytes(32),
      iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    const bytes = Buffer.concat([
      cipher.update("synthetic-key", "utf8"),
      cipher.final(),
    ]);
    const encrypted = Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString(
      "base64",
    );
    const legacy = path.join(dir, "encryption-key");
    writeFileSync(legacy, key);
    writeFileSync(
      path.join(dir, randomUUID() + ".json"),
      JSON.stringify({ profiles: [{ encrypted }] }),
    );
    process.env.AI_KEY_FILE = path.join(root, "outside-data", "master.key");
    assert.equal(
      decryptWithKey(encrypted, masterKey(data, false)),
      "synthetic-key",
    );
    assert(!existsSync(legacy));
    assert.deepEqual(readFileSync(process.env.AI_KEY_FILE), key);
    unlinkSync(process.env.AI_KEY_FILE);
    assert.throws(() => masterKey(data, true), /主密钥不可用/);
    assert(!existsSync(process.env.AI_KEY_FILE));
    writeFileSync(legacy, key);
    writeFileSync(process.env.AI_KEY_FILE, randomBytes(32));
    assert.throws(() => masterKey(data, false), /主密钥不可用/);
    assert(existsSync(legacy));
    process.env.AI_KEY_FILE = path.join(data, "bad.key");
    assert.throws(() => masterKey(data, false), /DATA_DIR 之外/);
  } finally {
    if (prior === undefined) delete process.env.AI_KEY_FILE;
    else process.env.AI_KEY_FILE = prior;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("输出上限兼容旧配置，改变上限使旧目标失效，截断保留费用而不返回建议", async () => {
  const { owner, profile } = account();
  savePrice(owner, price);
  assert.equal(activeConfig(owner)?.maxOutputTokens, 4000);
  const target = aiStatus(owner).target;
  saveConfig(owner, {
    action: "save",
    profile: { ...profile, key: "", maxOutputTokens: 16000 },
  });
  assert.equal(activeConfig(owner)?.key, profile.key);
  assert.equal(publicConfig(owner).profiles[0].maxOutputTokens, 16000);
  await assert.rejects(
    () =>
      complete(
        "",
        {},
        z.object({ ok: z.boolean() }),
        [],
        async () => response(),
        owner,
        target,
      ),
    { code: "AI_TARGET_CHANGED" },
  );
  assert.equal(budgetStatus(owner).calls, 0);
  await audited(owner, "long", () =>
    complete(
      "",
      {},
      z.object({ ok: z.literal(true) }),
      [],
      async (_url, init) => {
        assert.equal(JSON.parse(String(init?.body)).max_tokens, 16000);
        return response();
      },
      owner,
    ),
  );
  await assert.rejects(
    () =>
      audited(owner, "truncated", () =>
        complete(
          "",
          {},
          z.object({ ok: z.literal(true) }),
          [],
          async () => response("length"),
          owner,
        ),
      ),
    { code: "AI_OUTPUT_TRUNCATED" },
  );
  const record = auditList(owner).find((r) => r.action === "truncated")!;
  assert.equal(record.status, "failed");
  assert.equal(record.result, null);
  assert.equal(record.tokens, 150);
  assert.equal(record.cost?.amount, 0.0006);
  assert.equal(budgetStatus(owner).calls, 2);
  assert.equal(budgetStatus(owner).amounts[0].unknown, 0);
  assert.throws(() =>
    saveConfig(owner, {
      action: "save",
      profile: { ...profile, maxOutputTokens: 999999 },
    }),
  );
});

test("预算按账号与本地日历持久化，原子预留拦截并发和次数，未知费用不当作零", async () => {
  const { owner } = account(),
    { owner: other } = account();
  saveConfig(owner, {
    action: "limits",
    limits: { dailyCalls: 1, dailyCost: null },
  });
  const finish = reserveBudget(owner, "fixture", "example.com");
  assert.throws(() => reserveBudget(owner, "fixture", "example.com"), {
    code: "AI_BUSY",
  });
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import {reserveBudget} from './src/modules/ai/budget.ts'; try { reserveBudget('${owner}','fixture','example.com'); process.exitCode=1; } catch(e) {console.log(e.code)}`,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /AI_BUSY/);
  finish(null, null);
  assert.throws(() => reserveBudget(owner, "fixture", "example.com"), {
    code: "AI_DAILY_CALL_LIMIT",
  });
  saveConfig(owner, {
    action: "limits",
    limits: { dailyCalls: 10, dailyCost: { amount: 1, currency: "USD" } },
  });
  assert.throws(() => reserveBudget(owner, "fixture", "example.com"), {
    code: "AI_PRICE_REQUIRED",
  });
  savePrice(owner, price);
  assert.throws(() => reserveBudget(owner, "fixture", "example.com"), {
    code: "AI_COST_UNKNOWN",
  });
  assert.equal(budgetStatus(other).calls, 0);
  savePrice(other, price);
  saveConfig(other, {
    action: "limits",
    limits: { dailyCalls: 10, dailyCost: { amount: 0.0005, currency: "USD" } },
  });
  const settled = reserveBudget(other, "fixture", "example.com");
  settled(100, 50);
  settled(100, 50);
  assert.equal(budgetStatus(other).amounts[0].spent, 0.0006);
  assert.throws(() => reserveBudget(other, "fixture", "example.com"), {
    code: "AI_DAILY_COST_LIMIT",
  });
  // A prior calendar day does not consume today's count or unknown-cost checks.
  run("UPDATE ai_daily_budget SET day='2000-01-01' WHERE owner=?", owner);
  reserveBudget(owner, "fixture", "example.com")(0, 0);
  assert.equal(budgetStatus(owner).calls, 1);
});
