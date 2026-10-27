import "./ai-test-key";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-ai-"));
const { saveConfig, publicConfig, activeConfig } =
  await import("../src/modules/ai/config");
const { complete, aiStatus } = await import("../src/modules/ai/provider");
const { extract, limited, study } = await import("../src/modules/ai/service");
const { extractionPatch } = await import("../src/modules/ai/contracts");
const { run, dataDir } = await import("../src/lib/db");
const { defaults } = await import("../src/lib/model");
const { createEntry } = await import("../src/modules/entries/service");
const { ensure } = await import("../src/modules/dictionaries/ensure");
const owner = randomUUID(),
  other = randomUUID(),
  profileId = randomUUID();
run(
  "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
  owner,
  "ai-qa",
  "hash",
  JSON.stringify(defaults),
  "user",
);
run(
  "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
  other,
  "ai-other",
  "hash",
  JSON.stringify(defaults),
  "user",
);
const profile = {
  id: profileId,
  name: "模拟",
  base: "https://ai.example.com/v1",
  model: "fixture",
  key: "test-secret-never-return",
  vision: true,
  tokenParameter: "max_tokens",
};
const success = (value: unknown) => async () =>
  new Response(
    JSON.stringify({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(value) } },
      ],
    }),
  );
const result = {
  type: "408 专业课",
  subject: "数据结构",
  title: "队列",
  body: "先进先出的结构？",
  options: ["A. 栈", "B. 队列"],
  warnings: [],
};
const { entrySchema } = await import("../src/lib/model");
const draft = entrySchema.parse({
  type: "MATH",
  subject: "高等数学",
  title: "测试",
  body: "求导 x^2",
  details: { original_work_md: "我认为导数是 x。" },
});
ensure(owner, "TYPE", "CS");
ensure(owner, "SUBJECT", "数据结构");
ensure(owner, "ERROR", "方法");
test("配置加密且读取不返回密钥，账号隔离", () => {
  saveConfig(owner, { action: "save", profile });
  assert(!JSON.stringify(publicConfig(owner)).includes(profile.key));
  assert(
    !readFileSync(
      path.join(dataDir, "ai-private", owner + ".json"),
      "utf8",
    ).includes(profile.key),
  );
  assert.equal(publicConfig(other).profiles.length, 0);
  saveConfig(owner, { action: "activate", id: profileId });
  assert.equal(activeConfig(owner)?.key, profile.key);
});
test("辅助整理仅返回建议，预览材料不含身份、附件或来源，拒绝空题面", async () => {
  const output = {
    title: "求导",
    summary: "幂函数求导",
    tags: ["导数"],
    knowledgePoints: ["幂函数"],
    warnings: [],
  };
  assert.deepEqual(
    await study(
      owner,
      { action: "organize", entry: draft, consent: true },
      async (_u, init) => {
        const message = JSON.parse(String(init?.body)).messages[1].content[0]
          .text;
        assert(!message.includes('"attachments"'));
        assert(!message.includes('"source"'));
        return success(output)();
      },
    ),
    output,
  );
  await assert.rejects(() =>
    study(
      owner,
      { action: "organize", entry: { ...draft, body: "" }, consent: true },
      success(output),
    ),
  );
  await assert.rejects(() =>
    study(
      owner,
      { action: "organize", entry: draft, consent: false },
      success(output),
    ),
  );
});
test("错因分析需要原作答，未知错因丢弃并提示", async () => {
  await assert.rejects(() =>
    study(
      owner,
      { action: "analyze", entry: { ...draft, details: {} }, consent: true },
      success({}),
    ),
  );
  const output = {
    feedback: "遗漏系数2",
    evidence: ["导数是 x"],
    errorTags: ["方法"],
    warnings: [],
  };
  assert.deepEqual(
    await study(
      owner,
      { action: "analyze", entry: draft, consent: true },
      success(output),
    ),
    output,
  );
  const unknown = await study(
    owner,
    { action: "analyze", entry: draft, consent: true },
    success({ ...output, errorTags: ["不聪明"] }),
  );
  assert.deepEqual(unknown.errorTags, []);
  assert.deepEqual(unknown.warnings, ["AI 返回了未识别的错因：不聪明"]);
});
test("分级提示不发送答案、总结或原解法，限制三级", async () => {
  const saved = createEntry(owner, draft);
  for (const hintLevel of [1, 2, 3]) {
    const value = await study(
      owner,
      {
        action: "hint",
        entryId: saved.id,
        entry: {
          ...draft,
          summary: "SECRET_ANSWER",
          details: {
            solution_md: "SECRET_ANSWER",
            original_work_md: "SECRET_WORK",
          },
        },
        hintLevel,
        consent: true,
      },
      async (_u, init) => {
        const text = JSON.parse(String(init?.body)).messages[1].content[0].text;
        assert(!text.includes("SECRET_"));
        assert.equal(JSON.parse(text).hintLevel, hintLevel);
        return success({ hint: "想想幂函数求导法则", warnings: [] })();
      },
    );
    assert.equal((value as any).hint, "想想幂函数求导法则");
  }
  await assert.rejects(() =>
    study(owner, { action: "hint", entry: draft, hintLevel: 4, consent: true }),
  );
});
test("作答点评需本次答案，提示后建议评分强制不高于掌握", async () => {
  await assert.rejects(() =>
    study(
      owner,
      { action: "feedback", entry: draft, consent: true },
      success({}),
    ),
  );
  const value = await study(
    owner,
    {
      action: "feedback",
      entry: draft,
      answer: "2x",
      hintUsed: true,
      consent: true,
    },
    success({
      feedback: "答案正确",
      strengths: ["计算正确"],
      missing: [],
      rating: "EASY",
      warnings: [],
    }),
  );
  assert.equal(value.rating, "GOOD");
});
test("英语解析仅支持英语模板并保留语境", async () => {
  await assert.rejects(() =>
    study(
      owner,
      { action: "english", entry: draft, consent: true },
      success({}),
    ),
  );
  const english = entrySchema.parse({
    type: "VOCABULARY",
    subject: "英语",
    title: "persist",
    body: "persist",
    contexts: [
      {
        sentence_text: "She persisted despite the difficulty.",
        meaning_md: "",
        source: "",
        collocation: "",
      },
    ],
  });
  const result = {
    explanation: "结合原句表示坚持",
    translation: "她不顾困难继续坚持。",
    structure: "",
    wordMeaning: "persist: 坚持",
    collocations: ["persist in doing"],
    warnings: [],
  };
  assert.deepEqual(
    await study(
      owner,
      { action: "english", entry: english, consent: true },
      async (_u, init) => {
        assert(String(init?.body).includes("despite the difficulty"));
        return success(result)();
      },
    ),
    result,
  );
});
test("变式草稿不覆盖原题且不携带原题附件、计划、原解法", async () => {
  const { variantDraft } = await import("../src/modules/ai/contracts");
  const result = {
    question: "求x^3的导数",
    solution: "3x^2",
    knowledgePoints: ["幂函数"],
    warnings: [],
  };
  const next = variantDraft(draft, result);
  assert.equal(next.body, result.question);
  assert.equal(next.details.solution_md, "3x^2");
  assert(!next.details.original_work_md);
  assert.equal(next.status, "INBOX");
  assert.deepEqual(next.attachments, []);
  assert.equal(draft.body, "求导 x^2");
});
test("修改端点须重新提供密钥，配置验证阻止明文HTTP", () => {
  assert.throws(() =>
    saveConfig(owner, {
      action: "save",
      profile: { ...profile, key: "", base: "https://other.example.com" },
    }),
  );
  assert.throws(() =>
    saveConfig(owner, {
      action: "save",
      profile: { ...profile, base: "http://example.com" },
    }),
  );
  assert.throws(() => saveConfig(other, { action: "activate", id: profileId }));
});
test("模型可切换或关闭，密钥保留编辑不丢失", () => {
  saveConfig(owner, {
    action: "save",
    profile: { ...profile, key: "", name: "改名" },
  });
  assert.equal(activeConfig(owner)?.key, profile.key);
  saveConfig(owner, { action: "activate", id: null });
  assert.equal(aiStatus(owner).ready, false);
  saveConfig(owner, { action: "activate", id: profileId });
});
test("真实协议构造与结构校验，状态不暴露密钥", async () => {
  assert(!JSON.stringify(aiStatus(owner)).includes(profile.key));
  const transport: typeof fetch = async (url, init) => {
    assert.equal(url, profile.base + "/chat/completions");
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "fixture");
    assert.equal(body.max_tokens, 4000);
    return success({ ok: true })();
  };
  assert.deepEqual(
    await complete(
      "test",
      {},
      z.object({ ok: z.literal(true) }),
      [],
      transport,
      owner,
    ),
    { ok: true },
  );
});
test("确认后切换模型会阻止旧目标请求，关闭AI不回退环境配置", async () => {
  let called = false;
  await assert.rejects(() =>
    complete(
      "test",
      {},
      z.object({ ok: z.literal(true) }),
      [],
      async () => {
        called = true;
        return success({ ok: true })();
      },
      owner,
      "0".repeat(64),
    ),
  );
  assert.equal(called, false);
  process.env.AI_BASE_URL = "https://example.com";
  process.env.AI_MODEL = "environment";
  process.env.AI_API_KEY = "fixture";
  saveConfig(owner, { action: "activate", id: null });
  assert.equal(aiStatus(owner).ready, false);
  saveConfig(owner, { action: "activate", id: profileId });
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
  delete process.env.AI_API_KEY;
});
test("服务失败、截断、无效结构不会返回伪成功或泄露响应", async () => {
  for (const transport of [
    async () => new Response("private upstream data", { status: 401 }),
    success({ wrong: 1 }),
    async () => new Response('{"choices":[{"finish_reason":"length"}]}'),
    async () => {
      throw new Error("private token");
    },
  ]) {
    await assert.rejects(
      () =>
        complete(
          "test",
          {},
          z.object({ ok: z.literal(true) }),
          [],
          transport,
          owner,
        ),
      (e: any) => !e.message.includes("private") && e.status === 502,
    );
  }
});
test("同账号并发请求被拒绝，结束后可继续", async () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  const first = limited(other, () => wait);
  await assert.rejects(() => limited(other, async () => true));
  release();
  await first;
  assert.equal(await limited(other, async () => true), true);
});
test("图片识别检查归属及明确同意，输出完整选项", async () => {
  const id = randomUUID(),
    bytes = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
  writeFileSync(path.join(dataDir, "attachments", id), bytes);
  run(
    "INSERT INTO attachments VALUES(?,?,?,?,?,?,?)",
    id,
    owner,
    "fixture.png",
    "image/png",
    bytes.length,
    "fixture",
    new Date().toISOString(),
  );
  await assert.rejects(() =>
    extract(other, { attachmentIds: [id], consent: true }, success(result)),
  );
  await assert.rejects(() =>
    extract(owner, { attachmentIds: [id], consent: false }, success(result)),
  );
  const value = await extract(
    owner,
    { attachmentIds: [id], consent: true },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert(
        body.messages[1].content[1].image_url.url.startsWith(
          "data:image/png;base64,",
        ),
      );
      return success(result)();
    },
  );
  assert.deepEqual(value, { ...result, type: "CS" });
  assert.equal(
    extractionPatch(value).details.options_json,
    '["A. 栈","B. 队列"]',
  );
  assert.throws(() => extractionPatch(value, "MATH"));
});
import { providerError, providerPresets } from "../src/modules/ai/presets";
test("服务商预设使用HTTPS，失败分类不展示上游敏感消息", () => {
  assert(providerPresets.every((p) => new URL(p.base).protocol === "https:"));
  assert.match(providerError(401), /认证/);
  assert.match(providerError(404), /不存在/);
  assert.match(providerError(429), /限流/);
  assert.match(providerError(503), /暂时不可用/);
});
