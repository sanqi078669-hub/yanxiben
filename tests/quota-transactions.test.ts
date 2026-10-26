import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
process.env.DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-quota-transactions-"),
);
process.env.CAPACITY_POLICY = "invited";
const { db, run, one, all } = await import("../src/lib/db");
const { defaults, fields } = await import("../src/lib/model");
const { createEntry, getEntry } =
  await import("../src/modules/entries/service");
const { mergePreview, mergeKnowledge, undoKnowledgeMerge } =
  await import("../src/modules/entries/knowledge");
const { batchTags, undoBatch } = await import("../src/modules/entries/batch");
const { accountUsage } = await import("../src/modules/data-management/quota");
const limit = 80 * 1024 * 1024;
function setup(count = 3, large = false) {
  const owner = randomUUID(),
    source = randomUUID(),
    target = randomUUID();
  run(
    "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
    owner,
    owner,
    "synthetic",
    JSON.stringify(defaults),
    "user",
  );
  for (const node of [source, target])
    run(
      "INSERT INTO knowledge VALUES(?,?,?,NULL,?,'',0)",
      node,
      owner,
      "高等数学",
      node,
    );
  const entries = Array.from({ length: count }, () =>
    createEntry(owner, {
      type: "MATH",
      subject: "高等数学",
      title: "合成容量测试",
      body: "x".repeat(50000),
      knowledgeIds: [source, target],
      details: large
        ? Object.fromEntries(
            fields.MATH.map(([key]) => [key, "y".repeat(50000)]),
          )
        : {},
    }),
  );
  const filler = randomUUID();
  run("INSERT INTO ai_audit_extras VALUES(?,?,?)", filler, owner, "");
  return { owner, source, target, entries, filler };
}
function fillTo(owner: string, filler: string, target: number) {
  const current = accountUsage(owner).bytes;
  const old = Number(
    one("SELECT length(payload) n FROM ai_audit_extras WHERE id=?", filler)!.n,
  );
  const size = target - current + old;
  assert(size >= 0);
  run(
    "UPDATE ai_audit_extras SET payload=printf('%.*c',?,'x') WHERE id=?",
    size,
    filler,
  );
  assert.equal(accountUsage(owner).bytes, target);
}
function state(owner: string) {
  return Object.fromEntries(
    [
      "entries",
      "revisions",
      "knowledge",
      "knowledge_aliases",
      "knowledge_merges",
      "entry_search",
      "entry_filter_values",
      "batch_edits",
    ].map((table) => [
      table,
      all(`SELECT * FROM ${table} WHERE owner=? ORDER BY 1,2,3`, owner),
    ]),
  );
}
function merge(fixture: ReturnType<typeof setup>) {
  const { owner, source, target } = fixture;
  return mergeKnowledge(owner, {
    sourceId: source,
    targetId: target,
    digest: mergePreview(owner, source, target).digest,
    confirm: true,
  });
}
test("接近 80 MiB 时大范围合并预估历史放大并拒绝，所有业务/历史/派生表及回执不变", () => {
  const fixture = setup(10, true);
  fillTo(fixture.owner, fixture.filler, limit - 4 * 1024 * 1024);
  const before = state(fixture.owner),
    usage = accountUsage(fixture.owner).bytes;
  assert.throws(() => merge(fixture), { code: "CAPACITY_LIMIT" });
  assert.deepEqual(state(fixture.owner), before);
  assert.equal(accountUsage(fixture.owner).bytes, usage);
  assert.equal(db.isTransaction, false);
});
test("合并可提交时派生数据一致，接近上限的撤销整体回滚，腾出空间后可重试", () => {
  const fixture = setup(3),
    { owner, filler } = fixture;
  const result = merge(fixture);
  assert.equal(result.affected, 3);
  assert.equal(
    all(
      "SELECT * FROM entry_filter_values WHERE owner=? AND kind='knowledge' AND value=?",
      owner,
      fixture.source,
    ).length,
    0,
  );
  fillTo(owner, filler, limit - 1000);
  const before = state(owner),
    usage = accountUsage(owner).bytes;
  assert.throws(() => undoKnowledgeMerge(owner, result.id), {
    code: "CAPACITY_LIMIT",
  });
  assert.deepEqual(state(owner), before);
  assert.equal(accountUsage(owner).bytes, usage);
  fillTo(owner, filler, limit - 500000);
  undoKnowledgeMerge(owner, result.id);
  assert.equal(
    one("SELECT undone FROM knowledge_merges WHERE id=?", result.id)!.undone,
    1,
  );
  assert.equal(
    all(
      "SELECT * FROM entry_filter_values WHERE owner=? AND kind='knowledge' AND value=?",
      owner,
      fixture.source,
    ).length,
    3,
  );
  assert(accountUsage(owner).bytes <= limit);
});
test("批量第 2 条超限时第 1 条已提交，第 2/3 条无半成品，回执只记成功项", () => {
  const { owner, filler, entries } = setup(3);
  fillTo(owner, filler, limit - 80000);
  const before = entries.map((entry) => getEntry(owner, entry.id));
  const result = batchTags(owner, {
    items: entries.map((entry) => ({ id: entry.id, version: entry.version })),
    tag: "new",
    confirm: true,
  });
  assert.deepEqual(
    result.results.map((item) => item.ok),
    [true, false, false],
  );
  const receipt = JSON.parse(
    one("SELECT payload FROM batch_edits WHERE id=?", result.id)!.payload,
  );
  assert.deepEqual(receipt, [{ id: entries[0].id, version: 2, tags: [] }]);
  assert.deepEqual(getEntry(owner, entries[0].id).tags, ["new"]);
  for (const index of [1, 2]) {
    assert.deepEqual(getEntry(owner, entries[index].id), before[index]);
    assert.equal(
      one(
        "SELECT count(*) n FROM revisions WHERE entry_id=?",
        entries[index].id,
      )!.n,
      0,
    );
    assert.equal(
      one(
        "SELECT count(*) n FROM entry_filter_values WHERE entry_id=? AND kind='tag'",
        entries[index].id,
      )!.n,
      0,
    );
  }
  assert.equal(
    one("SELECT count(*) n FROM revisions WHERE entry_id=?", entries[0].id)!.n,
    1,
  );
  assert(accountUsage(owner).bytes <= limit);
  // Undo also adds history; failure must preserve both the committed entry and receipt.
  const committed = state(owner);
  assert.deepEqual(
    undoBatch(owner, { id: result.id }).results.map((item) => item.ok),
    [false],
  );
  assert.deepEqual(state(owner), committed);
  fillTo(owner, filler, limit - 200000);
  assert.deepEqual(
    undoBatch(owner, { id: result.id }).results.map((item) => item.ok),
    [true],
  );
  assert.deepEqual(getEntry(owner, entries[0].id).tags, []);
  assert.equal(
    one("SELECT id FROM batch_edits WHERE id=?", result.id),
    undefined,
  );
});
test("批量回执写入异常会连同记录、历史和派生数据回滚", () => {
  const { owner, entries } = setup(1);
  const before = getEntry(owner, entries[0].id);
  db.exec(
    "CREATE TEMP TRIGGER fail_batch_receipt BEFORE UPDATE ON batch_edits BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END",
  );
  try {
    const result = batchTags(owner, {
      items: [{ id: before.id, version: before.version }],
      tag: "new",
      confirm: true,
    });
    assert.deepEqual(
      result.results.map((item) => item.ok),
      [false],
    );
    assert.equal(
      one("SELECT payload FROM batch_edits WHERE id=?", result.id)!.payload,
      "[]",
    );
    assert.deepEqual(getEntry(owner, before.id), before);
    assert.equal(
      one("SELECT count(*) n FROM revisions WHERE entry_id=?", before.id)!.n,
      0,
    );
    assert.equal(
      one(
        "SELECT count(*) n FROM entry_filter_values WHERE entry_id=? AND kind='tag'",
        before.id,
      )!.n,
      0,
    );
  } finally {
    db.exec("DROP TRIGGER fail_batch_receipt");
  }
});
