import "./ai-test-key";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
const folder = mkdtempSync(path.join(os.tmpdir(), "yanxi-ai-dictionaries-"));
process.env.DATA_DIR = folder;
const { db, run, one, dataDir } = await import("../src/lib/db");
const { defaults, entrySchema } = await import("../src/lib/model");
const dictionary = await import("../src/modules/dictionaries/service");
const { saveConfig } = await import("../src/modules/ai/config");
const { study, extract } = await import("../src/modules/ai/service");
const {
  extractionPatch,
  variantDraft,
  extractionSchema,
  analysisSchema,
  variantSchema,
} = await import("../src/modules/ai/contracts");
const { createEntry, addReview, attempt } =
  await import("../src/modules/entries/service");
const { relatedPreview, related } = await import("../src/modules/ai/related");
const { diagnosisPreview, diagnose } =
  await import("../src/modules/ai/diagnosis");
const { aiDictionary } = await import("../src/modules/ai/dictionaries");
beforeEach(() =>
  db.exec(
    "DELETE FROM idempotency; DELETE FROM logs; DELETE FROM reviews; DELETE FROM revisions; DELETE FROM entries; DELETE FROM attachments; DELETE FROM users;",
  ),
);
after(() => {
  db.close();
  rmSync(folder, { recursive: true, force: true });
});
function account() {
  const owner = randomUUID(),
    id = randomUUID();
  run(
    "INSERT INTO users(id,username,password,settings) VALUES(?,?,?,?)",
    owner,
    owner,
    "hash",
    JSON.stringify(defaults),
  );
  saveConfig(owner, {
    action: "save",
    profile: {
      id,
      name: "mock",
      base: "https://example.com/v1",
      model: "mock",
      key: "synthetic-fixture",
      vision: true,
    },
  });
  saveConfig(owner, { action: "activate", id });
  return owner;
}
function setup(
  template: "GENERIC" | "CS" | "VOCABULARY" | "SENTENCE" = "GENERIC",
) {
  const owner = account();
  const type = dictionary.create(owner, "TYPE", "复盘 材料", template);
  const subject = dictionary.create(owner, "SUBJECT", "线性代数");
  const cause = dictionary.create(owner, "ERROR", "遗漏 约束");
  const entry = entrySchema.parse({
    type: type.value,
    subject: subject.value,
    title: "测试",
    body: "矩阵题面",
    details: template === "GENERIC" ? { analysis_md: "我忽略了条件" } : {},
    errors: [cause.value],
  });
  return { owner, type, subject, cause, entry };
}
function mock(value: unknown, inspect?: (body: any) => void): typeof fetch {
  return async (_url, init) => {
    inspect?.(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(value) },
          },
        ],
      }),
    );
  };
}
async function image(owner: string) {
  const id = randomUUID();
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  writeFileSync(path.join(dataDir, "attachments", id), bytes);
  run(
    "INSERT INTO attachments VALUES(?,?,?,?,?,?,?)",
    id,
    owner,
    "mock.png",
    "image/png",
    bytes.length,
    "fixture",
    new Date().toISOString(),
  );
  return id;
}
const extraction = {
  type: "复盘　材料",
  subject: " 线性代数 ",
  title: "题目",
  body: "识别的原文",
  options: ["A"],
  warnings: [],
};
const analysis = {
  feedback: "检查条件",
  evidence: ["忽略了条件"],
  errorTags: ["遗漏　约束"],
  warnings: [],
};

test("提取提示词按 owner、sort_order 使用活跃标签，label 规范化映射回 value", async () => {
  const { owner, type, subject } = setup();
  const other = setup();
  dictionary.rename(other.owner, "TYPE", other.type.value, "其他账号专属", 1);
  const first = dictionary.create(owner, "TYPE", "首先类型");
  dictionary.reorder(owner, "TYPE", {
    items: [
      { value: first.value, expectedVersion: 1 },
      { value: type.value, expectedVersion: 1 },
    ],
  });
  const archived = dictionary.create(owner, "TYPE", "归档类型");
  dictionary.archive(owner, "TYPE", archived.value, 1);
  const id = await image(owner);
  let calls = 0;
  const result = await extract(
    owner,
    { attachmentIds: [id], consent: true },
    mock(extraction, (body) => {
      calls++;
      const prompt = body.messages[0].content;
      assert.ok(prompt.includes("只能从下列名称中选一个，不得新造"));
      assert.ok(prompt.indexOf("首先类型") < prompt.indexOf("复盘 材料"));
      assert.ok(prompt.includes("线性代数"));
      for (const hidden of [
        "归档类型",
        "其他账号专属",
        type.value,
        subject.value,
      ])
        assert.ok(!prompt.includes(hidden), hidden);
    }),
  );
  assert.equal(calls, 1);
  assert.equal(result.type, type.value);
  assert.equal(result.subject, subject.value);
  assert.equal(
    one("SELECT count(*) n FROM entries WHERE owner=?", owner)!.n,
    0,
  );
});

test("提取未知/归档 type 或 subject 返回 422，不新建记录或字典项", async () => {
  const { owner } = setup();
  const id = await image(owner);
  const old = dictionary.create(owner, "SUBJECT", "旧科目");
  dictionary.archive(owner, "SUBJECT", old.value, 1);
  const count = one(
    "SELECT count(*) n FROM dictionary_items WHERE owner=?",
    owner,
  )!.n;
  for (const output of [
    { ...extraction, type: "不存在" },
    { ...extraction, subject: "不存在" },
    { ...extraction, subject: "旧科目" },
  ]) {
    await assert.rejects(
      extract(owner, { attachmentIds: [id], consent: true }, mock(output)),
      { status: 422 },
    );
  }
  assert.equal(
    one("SELECT count(*) n FROM entries WHERE owner=?", owner)!.n,
    0,
  );
  assert.equal(
    one("SELECT count(*) n FROM dictionary_items WHERE owner=?", owner)!.n,
    count,
  );
});

test("分析发送标签，映射错因 value，未知或归档建议丢弃并 warning", async () => {
  const { owner, type, subject, cause, entry } = setup();
  const archived = dictionary.create(owner, "ERROR", "旧错因");
  dictionary.archive(owner, "ERROR", archived.value, 1);
  const result = await study(
    owner,
    {
      action: "analyze",
      entry: { ...entry, errors: [cause.value, archived.value] },
      consent: true,
    },
    mock(
      {
        ...analysis,
        errorTags: [
          ...analysis.errorTags,
          "未知原因",
          "旧错因",
          ...analysis.errorTags,
        ],
      },
      (body) => {
        const prompt = body.messages[0].content;
        assert.ok(prompt.includes("遗漏 约束"));
        assert.ok(!prompt.includes("旧错因"));
        const text = body.messages[1].content[0].text;
        for (const hidden of [
          type.value,
          subject.value,
          cause.value,
          archived.value,
        ])
          assert.ok(!text.includes(hidden), hidden);
        const material = JSON.parse(text);
        assert.equal(material.type, "复盘 材料");
        assert.equal(material.subject, "线性代数");
        assert.deepEqual(material.errors, ["遗漏 约束", "旧错因"]);
      },
    ),
  );
  assert.deepEqual(result.errorTags, [cause.value]);
  assert.deepEqual(result.warnings, [
    "AI 返回了未识别的错因：未知原因",
    "AI 返回了未识别的错因：旧错因",
  ]);
});

test("空字典 extract 不调用传输；空错因 analyze 可反馈且 errorTags 为空", async () => {
  const owner = account();
  let calls = 0;
  const transport = mock(extraction, () => {
    calls++;
  });
  await assert.rejects(
    extract(owner, { attachmentIds: [randomUUID()], consent: true }, transport),
    { status: 400, message: "请先创建类型" },
  );
  const type = dictionary.create(owner, "TYPE", "通用");
  await assert.rejects(
    extract(owner, { attachmentIds: [randomUUID()], consent: true }, transport),
    { status: 400, message: "请先创建科目" },
  );
  assert.equal(calls, 0);
  const entry = entrySchema.parse({
    type: type.value,
    subject: randomUUID(),
    title: "题目",
    body: "材料",
    details: { analysis_md: "我的分析" },
  });
  const result = await study(
    owner,
    { action: "analyze", entry, consent: true },
    mock({ ...analysis, errorTags: ["未配置的建议"] }, (body) => {
      assert.ok(body.messages[0].content.includes("用户尚未配置错因"));
      assert.ok(!JSON.stringify(body.messages).includes(entry.subject));
    }),
  );
  assert.deepEqual(result.errorTags, []);
  assert.equal(result.feedback, analysis.feedback);
});

test("english 按模板判断：GENERIC 拒绝，UUID VOCABULARY/SENTENCE 允许", async () => {
  const output = {
    explanation: "语境解释",
    translation: "翻译",
    structure: "",
    wordMeaning: "词义",
    collocations: [],
    warnings: [],
  };
  for (const template of ["GENERIC", "VOCABULARY", "SENTENCE"] as const) {
    const { owner, entry } = setup(template);
    let calls = 0;
    const request = study(
      owner,
      { action: "english", entry, consent: true },
      mock(output, () => {
        calls++;
      }),
    );
    if (template === "GENERIC") {
      await assert.rejects(request, {
        status: 400,
        code: "AI_TEMPLATE_MISMATCH",
      });
      assert.equal(calls, 0);
    } else assert.deepEqual(await request, output);
  }
});

test("GENERIC 可整理、提示、点评、变式；提示绑定原 value，变式可按通用字段保存", async () => {
  const { owner, entry, type, subject } = setup();
  const saved = createEntry(owner, entry);
  dictionary.rename(owner, "TYPE", type.value, "改名类型", 1);
  for (const [action, output] of [
    [
      "organize",
      {
        title: "建议",
        summary: "总结",
        tags: [],
        knowledgePoints: [],
        warnings: [],
      },
    ],
    ["hint", { hint: "提示", warnings: [] }],
    [
      "feedback",
      {
        feedback: "反馈",
        strengths: [],
        missing: [],
        rating: "GOOD",
        warnings: [],
      },
    ],
    [
      "variant",
      {
        question: "变式题面",
        solution: "变式分析",
        knowledgePoints: [],
        warnings: [],
      },
    ],
  ] as const) {
    const result = await study(
      owner,
      { action, entry, entryId: saved.id, answer: "本次作答", consent: true },
      mock(output, (body) => {
        const text = body.messages[1].content[0].text;
        assert.ok(text.includes("改名类型"));
        assert.ok(!text.includes(type.value));
        assert.ok(!text.includes(subject.value));
      }),
    );
    assert.deepEqual(result, output);
    if (action === "variant") {
      const next = variantDraft(entry, variantSchema.parse(result), "GENERIC");
      assert.equal(next.details.analysis_md, "变式分析");
      assert.ok(createEntry(owner, next));
    }
  }
  assert.deepEqual(
    extractionPatch(
      { ...extraction, type: type.value, subject: subject.value },
      undefined,
      "CS",
    ).details,
    { subtype: "QUESTION", options_json: '["A"]' },
  );
});

test("相似题与诊断材料里的科目/错因也用标签，结构化记录引用仍有效", async () => {
  const { owner, entry, type, subject, cause } = setup();
  const a = createEntry(owner, entry),
    b = createEntry(owner, { ...entry, title: "矩阵候选" });
  const preview = relatedPreview(owner, a.id);
  await related(
    owner,
    { entryId: a.id, digest: preview.digest, consent: true },
    mock(
      {
        matches: [{ id: b.id, reason: "共同知识点", difference: "条件不同" }],
        warnings: [],
      },
      (body) => {
        const text = body.messages[1].content[0].text;
        assert.ok(text.includes("线性代数"));
        assert.ok(text.includes("遗漏 约束"));
        for (const key of [type.value, subject.value, cause.value])
          assert.ok(!text.includes(key));
      },
    ),
  );
  const review = addReview(owner, a.id);
  attempt(
    owner,
    review.id,
    {
      expectedVersion: 1,
      mode: "SCHEDULED",
      rating: "GOOD",
      hintUsed: false,
      answerMd: "答案",
    },
    randomUUID(),
  );
  const p = diagnosisPreview(owner);
  await diagnose(
    owner,
    { digest: p.digest, consent: true },
    mock({ summary: "样本观察", recommendations: [], warnings: [] }, (body) => {
      const text = body.messages[1].content[0].text;
      assert.ok(text.includes("线性代数"));
      assert.ok(!text.includes(subject.value));
    }),
  );
  assert.equal(
    aiDictionary(owner).material({ subject: randomUUID() }).subject,
    "未配置科目",
  );
});

test("字符串契约保留长度数量边界，移除旧类型科目配对限制", () => {
  assert.ok(
    extractionSchema.safeParse({
      ...extraction,
      type: "自定义",
      subject: "任意科目",
    }).success,
  );
  assert.ok(!extractionSchema.safeParse({ ...extraction, type: " " }).success);
  assert.ok(
    !extractionSchema.safeParse({ ...extraction, subject: "科".repeat(101) })
      .success,
  );
  assert.ok(
    analysisSchema.safeParse({
      ...analysis,
      errorTags: Array(30).fill("自定义错因"),
    }).success,
  );
  assert.ok(
    !analysisSchema.safeParse({
      ...analysis,
      errorTags: Array(31).fill("原因"),
    }).success,
  );
  assert.ok(
    !analysisSchema.safeParse({ ...analysis, errorTags: ["因".repeat(51)] })
      .success,
  );
});
