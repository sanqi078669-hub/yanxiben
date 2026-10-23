import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
process.env.DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-review-rules-"),
);
const { run, one } = await import("../src/lib/db");
const { defaults, entrySchema } = await import("../src/lib/model");
const { createEntry, addReview, attempt, recordEntryHint, serverHintUsed } =
  await import("../src/modules/entries/service");
const { study } = await import("../src/modules/ai/service");
const { saveConfig } = await import("../src/modules/ai/config");
const { activeStage } = await import("../src/modules/review/schedule");

function setup() {
  const owner = randomUUID();
  run(
    "INSERT INTO users VALUES(?,?,?,?)",
    owner,
    owner,
    "hash",
    JSON.stringify(defaults),
  );
  const input = entrySchema.parse({
    type: "MATH",
    subject: "高等数学",
    title: "hint test",
    body: "求 x² 导数",
  });
  const entry = createEntry(owner, input);
  return { owner, input, entry };
}
const body = {
  expectedVersion: 1,
  mode: "PRACTICE",
  rating: "EASY",
  hintUsed: false,
  answerMd: "2x",
};
const response = () =>
  Response.json({
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({ hint: "考虑幂函数求导", warnings: [] }),
        },
      },
    ],
  });
function configure(owner: string) {
  const id = randomUUID();
  saveConfig(owner, {
    action: "save",
    profile: {
      id,
      name: "fixture",
      model: "fixture",
      base: "https://ai.example.com/v1",
      vision: false,
      key: "synthetic-fixture-key",
      tokenParameter: "max_tokens",
    },
  });
  saveConfig(owner, { action: "activate", id });
}

test("提示使用由服务端判定；false 无法绕过，成功后新一轮不被永久锁定", () => {
  const { owner, entry } = setup();
  const review = addReview(owner, entry.id);
  recordEntryHint(owner, entry.id, 1);
  assert.throws(() => attempt(owner, review.id, body, "lying-hint"), /提示/);
  const accepted = { ...body, rating: "GOOD" };
  const result = attempt(owner, review.id, accepted, "accepted-hint");
  assert.equal(
    JSON.parse(
      one("SELECT payload FROM logs WHERE id=?", result.attemptId)!.payload,
    ).hintUsed,
    true,
  );
  assert.deepEqual(
    attempt(owner, review.id, accepted, "accepted-hint"),
    result,
  );
  assert.equal(serverHintUsed(owner, entry.id, 1), false);
  assert.ok(attempt(owner, review.id, body, "new-round").attemptId);
  assert.throws(() => recordEntryHint(randomUUID(), entry.id, 1), /不存在/);
  assert.throws(() => recordEntryHint(owner, entry.id, 99), /变化/);
});

test("未加入计划时的提示保留到第一次复习，完成后不误伤未来轮次", () => {
  const { owner, entry } = setup();
  recordEntryHint(owner, entry.id, 0);
  const review = addReview(owner, entry.id);
  assert.throws(
    () =>
      attempt(owner, review.id, { ...body, mode: "SCHEDULED" }, "early-hint"),
    /提示/,
  );
  attempt(
    owner,
    review.id,
    { ...body, mode: "SCHEDULED", rating: "GOOD" },
    "early-good",
  );
  assert.ok(
    attempt(owner, review.id, { ...body, expectedVersion: 2 }, "later-round"),
  );
});

test("AI 提示绑定本人记录，成功才记使用；失败及跨归属不会写入", async () => {
  const { owner, input, entry } = setup();
  configure(owner);
  const review = addReview(owner, entry.id);
  await assert.rejects(
    () =>
      study(owner, { action: "hint", entry: input, consent: true }, async () =>
        response(),
      ),
    /绑定/,
  );
  await assert.rejects(
    () =>
      study(
        randomUUID(),
        { action: "hint", entryId: entry.id, entry: input, consent: true },
        async () => response(),
      ),
    /不存在/,
  );
  await assert.rejects(() =>
    study(
      owner,
      { action: "hint", entryId: entry.id, entry: input, consent: true },
      async () => Response.json({}, { status: 503 }),
    ),
  );
  assert.equal(serverHintUsed(owner, entry.id, 1), false);
  await study(
    owner,
    { action: "hint", entryId: entry.id, entry: input, consent: true },
    async () => response(),
  );
  assert.equal(serverHintUsed(owner, entry.id, 1), true);
  assert.throws(() => attempt(owner, review.id, body, "ai-false-hint"), /提示/);
});

test("生成提示期间计划改变，不将旧响应记录到新轮次", async () => {
  const { owner, input, entry } = setup();
  configure(owner);
  const review = addReview(owner, entry.id);
  await assert.rejects(
    () =>
      study(
        owner,
        { action: "hint", entryId: entry.id, entry: input, consent: true },
        async () => {
          run("UPDATE reviews SET version=version+1 WHERE id=?", review.id);
          return response();
        },
      ),
    /变化/,
  );
  assert.equal(serverHintUsed(owner, entry.id, 2), false);
});

test("暂停恢复与调度共用阶段推导", () => {
  assert.equal(activeStage({ stage_index: -1, success_streak: 0 }), "NEW");
  assert.equal(activeStage({ stage_index: 2, success_streak: 2 }), "LEARNING");
  assert.equal(
    activeStage({ stage_index: 3, success_streak: 3 }),
    "MAINTENANCE",
  );
});

test("永久清理记录时不会留下阻塞删除的提示外键", () => {
  const { owner, entry } = setup();
  recordEntryHint(owner, entry.id, 0);
  run("DELETE FROM entries WHERE id=? AND owner=?", entry.id, owner);
  assert.equal(one("SELECT count(*) n FROM entry_hint_usage WHERE entry_id=?", entry.id)!.n, 0);
});
