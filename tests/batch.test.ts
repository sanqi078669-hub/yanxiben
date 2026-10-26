import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-batch-"));
const { run, one, db } = await import("../src/lib/db");
const { entrySchema, defaults } = await import("../src/lib/model");
const { createEntry, getEntry, updateEntry, addReview } =
  await import("../src/modules/entries/service");
const { batchTags, batchPause, batchReviewPreview, undoBatch } =
  await import("../src/modules/entries/batch");
const owner = randomUUID(),
  other = randomUUID();
for (const id of [owner, other])
  run(
    "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
    id,
    id,
    "hash",
    JSON.stringify(defaults),
    "user",
  );
const make = (id = owner) =>
  createEntry(
    id,
    entrySchema.parse({
      type: "MATH",
      title: "批量验收",
      subject: "高等数学",
      body: "题面",
      tags: ["原标签"],
    }),
  );
test("批量暂停回执失败时计划回滚，已提交项仍可撤销", () => {
  const a = make(),
    b = make();
  const ra = addReview(owner, a.id),
    rb = addReview(owner, b.id);
  db.exec(
    "CREATE TEMP TRIGGER fail_pause_receipt BEFORE UPDATE ON batch_edits WHEN json_array_length(NEW.payload)=2 BEGIN SELECT RAISE(ABORT,'synthetic pause receipt failure'); END",
  );
  try {
    const result = batchPause(owner, {
      confirm: true,
      items: [
        { id: a.id, version: a.version, reviewVersion: ra.version },
        { id: b.id, version: b.version, reviewVersion: rb.version },
      ],
    });
    assert.deepEqual(
      result.results.map((row) => row.ok),
      [true, false],
    );
    assert.equal(
      one("SELECT stage FROM reviews WHERE id=?", ra.id)!.stage,
      "PAUSED",
    );
    assert.equal(
      one("SELECT stage FROM reviews WHERE id=?", rb.id)!.stage,
      rb.stage,
    );
    assert.equal(
      one("SELECT version FROM reviews WHERE id=?", rb.id)!.version,
      rb.version,
    );
    assert.equal(
      JSON.parse(
        one("SELECT payload FROM batch_edits WHERE id=?", result.id)!.payload,
      ).length,
      1,
    );
    assert.equal(undoBatch(owner, { id: result.id }).results[0].ok, true);
  } finally {
    db.exec("DROP TRIGGER fail_pause_receipt");
  }
});
test("批量逐条验证账号与版本，部分成功明确反馈且可撤销", () => {
  const a = make(),
    b = make(other),
    c = make(),
    untouched = make();
  updateEntry(owner, c.id, { expectedVersion: 1, title: "后续修改" });
  const receipt = batchTags(owner, {
    items: [a, b, c].map((e) => ({ id: e.id, version: 1 })),
    tag: "新标签",
    confirm: true,
  });
  assert.deepEqual(
    receipt.results.map((r) => r.ok),
    [true, false, false],
  );
  assert.deepEqual(getEntry(owner, a.id).tags, ["原标签", "新标签"]);
  assert.deepEqual(getEntry(owner, untouched.id).tags, ["原标签"]);
  assert.throws(() => undoBatch(other, { id: receipt.id }));
  assert.equal(undoBatch(owner, { id: receipt.id }).results[0].ok, true);
  assert.deepEqual(getEntry(owner, a.id).tags, ["原标签"]);
});
test("撤销不覆盖后续编辑，拒绝重复选择和超出当前页范围", () => {
  const e = make();
  const receipt = batchTags(owner, {
    items: [{ id: e.id, version: 1 }],
    tag: "新增",
    confirm: true,
  });
  updateEntry(owner, e.id, { expectedVersion: 2, title: "保留新标题" });
  assert.equal(undoBatch(owner, { id: receipt.id }).results[0].ok, false);
  assert.equal(getEntry(owner, e.id).title, "保留新标题");
  assert.throws(() =>
    batchTags(owner, {
      items: Array(21).fill({ id: e.id, version: 3 }),
      tag: "标签",
      confirm: true,
    }),
  );
});
test("批量暂停检查预览时的计划版本，部分失败可见，撤销保留日期与历史", () => {
  const a = make(),
    b = make(),
    c = make(),
    ra = addReview(owner, a.id),
    rb = addReview(owner, b.id);
  const items = [a, b, c].map((e) => ({ id: e.id, version: e.version })),
    preview = batchReviewPreview(owner, items);
  run("UPDATE reviews SET version=version+1 WHERE id=?", rb.id);
  const receipt = batchPause(owner, {
    items: items.map((i) => ({
      ...i,
      reviewVersion: preview.find((p) => p.id === i.id)!.reviewVersion,
    })),
    confirm: true,
  });
  assert.deepEqual(
    receipt.results.map((r) => r.ok),
    [true, false, false],
  );
  assert.equal(
    one("SELECT stage FROM reviews WHERE id=?", ra.id)!.stage,
    "PAUSED",
  );
  assert.equal(undoBatch(owner, { id: receipt.id }).results[0].ok, true);
  assert.equal(
    one("SELECT stage FROM reviews WHERE id=?", ra.id)!.stage,
    ra.stage,
  );
  assert.equal(
    one("SELECT due_on FROM reviews WHERE id=?", ra.id)!.due_on,
    ra.due_on,
  );
  assert.equal(
    one("SELECT count(*) n FROM logs WHERE review_id=?", ra.id)!.n,
    0,
  );
});
