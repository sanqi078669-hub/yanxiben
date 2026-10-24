import "./ai-test-key";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-related-"));
const { run } = await import("../src/lib/db");
const { defaults, entrySchema } = await import("../src/lib/model");
const { createEntry, trashEntry, updateEntry } =
  await import("../src/modules/entries/service");
const { relatedPreview, related } = await import("../src/modules/ai/related");
const { saveConfig } = await import("../src/modules/ai/config");
const owner = randomUUID(),
  other = randomUUID();
for (const id of [owner, other])
  run(
    "INSERT INTO users VALUES(?,?,?,?)",
    id,
    id,
    "hash",
    JSON.stringify(defaults),
  );
const profile = {
  id: randomUUID(),
  name: "模拟",
  base: "https://example.com",
  model: "mock",
  key: "fixture",
  vision: false,
};
saveConfig(owner, { action: "save", profile });
saveConfig(owner, { action: "activate", id: profile.id });
const input = entrySchema.parse({
  type: "MATH",
  subject: "高等数学",
  title: "导数",
  body: "求幂函数导数",
  tags: ["导数"],
});
const source = createEntry(owner, input),
  candidate = createEntry(owner, { ...input, title: "另一道导数题" }),
  hidden = createEntry(other, input),
  deleted = createEntry(owner, input);
trashEntry(owner, deleted.id);
test("候选只包含本人未删除的其他同科目记录", () => {
  const preview = relatedPreview(owner, source.id);
  assert.deepEqual(
    preview.material.candidates.map((e) => e.id),
    [candidate.id],
  );
  assert.throws(() => relatedPreview(other, source.id));
  assert(!JSON.stringify(preview).includes(hidden.id));
});
test("语义比较候选覆盖不同措辞，删除编辑即时生效，保留基础回退", () => {
  const a = createEntry(owner, {
    ...input,
    title: "曲线",
    body: "求曲线在某点处的瞬时斜率",
    tags: [],
  });
  const b = createEntry(owner, {
    ...input,
    title: "计算",
    body: "计算函数的微商",
    tags: [],
  });
  const basic = relatedPreview(owner, a.id, "basic"),
    semantic = relatedPreview(owner, a.id, "semantic");
  assert.ok(!basic.material.candidates.some((e) => e.id === b.id));
  assert.ok(semantic.material.candidates.some((e) => e.id === b.id));
  assert.ok(
    !semantic.material.candidates.some(
      (e) => e.id === hidden.id || e.id === deleted.id,
    ),
  );
  updateEntry(owner, b.id, { expectedVersion: 1, title: "更新后的表达" });
  assert.notEqual(
    relatedPreview(owner, a.id, "semantic").digest,
    semantic.digest,
  );
  trashEntry(owner, b.id);
  assert.ok(
    !relatedPreview(owner, a.id, "semantic").material.candidates.some(
      (e) => e.id === b.id,
    ),
  );
});
test("相似题拒绝虚构引用和过期预览", async () => {
  const p = relatedPreview(owner, source.id),
    request = { entryId: source.id, digest: p.digest, consent: true };
  const response = (id: string) => async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                matches: [
                  { id, reason: "共同考查导数", difference: "系数不同" },
                ],
                warnings: [],
              }),
            },
          },
        ],
      }),
    );
  await assert.rejects(() => related(owner, request, response(hidden.id)));
  assert.equal(
    (await related(owner, request, response(candidate.id))).matches[0].id,
    candidate.id,
  );
  updateEntry(owner, candidate.id, {
    expectedVersion: 1,
    title: "已改变的题面",
  });
  await assert.rejects(() => related(owner, request, response(candidate.id)));
});
test("学习诊断不发作答原文，空历史拒绝，统计不跨账号", async () => {
  const { diagnosisPreview, diagnose } =
    await import("../src/modules/ai/diagnosis");
  await assert.rejects(() =>
    diagnose(owner, { digest: diagnosisPreview(owner).digest, consent: true }),
  );
  const { addReview, attempt } = await import("../src/modules/entries/service");
  const review = addReview(owner, source.id, true);
  attempt(
    owner,
    review.id,
    {
      expectedVersion: review.version,
      mode: "PRACTICE",
      rating: "HARD",
      hintUsed: true,
      answerMd: "SECRET_ANSWER",
    },
    randomUUID(),
  );
  const p = diagnosisPreview(owner);
  assert.equal(p.material.sampleSize, 1);
  assert.equal(p.material.distinctEntries, 1);
  assert.equal(p.material.smallSample, true);
  assert.match(p.material.from!, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(p.material.from, p.material.to);
  assert.equal(p.material.entries[0].hard, 1);
  assert.equal(p.material.entries[0].hints, 1);
  assert.equal(p.material.entries[0].practice, 1);
  assert(!JSON.stringify(p).includes("SECRET_ANSWER"));
  assert.equal(diagnosisPreview(other).material.sampleSize, 0);
  const output = {
    summary: "样本有限",
    recommendations: [
      {
        title: "复习导数",
        reason: "一次困难",
        nextStep: "再练习一次",
        entryIds: [source.id],
      },
    ],
    warnings: [],
  };
  const transport = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(output) },
          },
        ],
      }),
    );
  assert.deepEqual(
    await diagnose(owner, { digest: p.digest, consent: true }, transport),
    output,
  );
});
