import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
process.env.DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-query-parity-"),
);
const { db, all, run } = await import("../src/lib/db");
const { defaults } = await import("../src/lib/model");
const {
  entries,
  createEntry,
  updateEntry,
  addReview,
  unpack,
  reviewQueue,
  dashboard,
} = await import("../src/modules/entries/service");
const { backup } = await import("../src/modules/data-management/backup");
const { unzipSync, strFromU8 } = await import("fflate");
const { summarize, learningStatistics } =
  await import("../src/modules/review/statistics");
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
const nodeId = randomUUID();
run(
  "INSERT INTO knowledge VALUES(?,?,?,?,?,?,0)",
  nodeId,
  owner,
  "高等数学",
  null,
  "导数",
  "",
);
for (let i = 0; i < 60; i++) {
  const type = (["MATH", "CS", "VOCABULARY", "SENTENCE"] as const)[i % 4];
  const subject =
    type === "MATH" ? "高等数学" : type === "CS" ? "数据结构" : "英语";
  const e = createEntry(owner, {
    type,
    subject,
    title: "题目 " + i,
    body: `original_${i}% Unicode İSTANBUL ΟΣ`,
    source: "来源" + i,
    summary: "总结 " + i,
    details:
      type === "MATH"
        ? { takeaway_md: "细节汉字唯一" }
        : type === "VOCABULARY"
          ? { lemma: "lemma" + i, part_of_speech: "n." }
          : {},
    knowledgeIds: type === "MATH" ? [nodeId] : [],
    errors: i % 2 ? ["概念"] : ["方法"],
    tags: ["Topic" + (i % 3)],
    status: i % 2 ? "ORGANIZED" : "INBOX",
  });
  run(
    "UPDATE entries SET updated_at=?,deleted_at=? WHERE id=?",
    `2026-10-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    null,
    e.id,
  );
  if (i === 4)
    run(
      "UPDATE entries SET payload=replace(payload,'汉',?) WHERE id=?",
      "\\u6c49",
      e.id,
    );
  const r = addReview(owner, e.id);
  if (i % 19 === 0)
    run(
      "UPDATE entries SET deleted_at=? WHERE id=?",
      "2026-10-22T00:00:00.000Z",
      e.id,
    );
  for (let j = 0; j < 4; j++)
    run(
      "INSERT INTO logs VALUES(?,?,?,?,?,?,?,?)",
      randomUUID(),
      owner,
      r.id,
      j % 2 ? "PRACTICE" : "SCHEDULED",
      ["HARD", "HARD", "GOOD", "EASY"][j],
      `2026-${j < 2 ? "09" : "10"}-0${j + 1}`,
      JSON.stringify({
        hintUsed: j === 2,
        ...(j === 0
          ? {}
          : { errorCauses: j === 1 ? ["计算", "计算", "方法"] : [] }),
      }),
      `2026-10-${String(j + 1).padStart(2, "0")}T00:00:00.000Z`,
    );
}
createEntry(other, {
  type: "MATH",
  subject: "高等数学",
  title: "private-other",
  body: "细节汉字唯一",
});

function reference(q: URLSearchParams) {
  let result = all(
    "SELECT * FROM entries WHERE owner=? ORDER BY updated_at DESC,id",
    owner,
  )
    .map(unpack)
    .filter((e) => (q.get("trash") === "1" ? !!e.deleted_at : !e.deleted_at));
  for (const key of ["type", "subject", "status"] as const)
    if (q.get(key)) result = result.filter((e) => e[key] === q.get(key));
  if (q.get("q"))
    result = result.filter((e) =>
      [
        e.title,
        e.body,
        e.summary,
        e.source,
        JSON.stringify(e.details),
        JSON.stringify(e.contexts),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q.get("q")!.toLowerCase()),
    );
  if (q.get("knowledge"))
    result = result.filter((e) => e.knowledgeIds.includes(q.get("knowledge")!));
  if (q.get("error"))
    result = result.filter((e) => e.errors.includes(q.get("error")!));
  if (q.get("tag"))
    result = result.filter((e) =>
      e.tags.includes(q.get("tag")!.trim().toLowerCase()),
    );
  const limit = +(q.get("limit") || 20),
    page = +(q.get("page") || 1);
  return {
    ids: result.slice((page - 1) * limit, page * limit).map((e) => e.id),
    total: result.length,
  };
}
test("SQL 列表筛选/搜索/排序/分页与原语义一致，列表不携带详情材料", () => {
  for (const query of [
    "",
    "page=2&limit=7",
    "page=999",
    "trash=1",
    "type=MATH&status=INBOX",
    "subject=英语",
    "q=%",
    "q=_",
    "q=İSTANBUL",
    "q=ΟΣ",
    "q=汉字唯一",
    "q=takeaway_md",
    "q=' OR 1=1 --",
    "tag= TOPIC1 &error=概念",
    `knowledge=${nodeId}&type=MATH`,
    "q=总结&tag=topic0&subject=高等数学",
  ]) {
    const q = new URLSearchParams(query),
      expected = reference(q),
      actual = entries(owner, q);
    assert.deepEqual(
      { ids: actual.items.map((e) => e.id), total: actual.total },
      expected,
      query,
    );
    for (const item of actual.items) {
      assert.equal("details" in item, false);
      assert.equal("contexts" in item, false);
      assert.equal("payload" in item, false);
    }
  }
});
test("统计 SQL 聚合与原口径一致，覆盖重复错因、空样本、时间/科目/模式", () => {
  for (const filters of [
    {},
    { subject: "英语" },
    { mode: "PRACTICE" },
    { from: "2026-10-01" },
    { from: "2090-01-01", to: "2090-01-02" },
  ]) {
    const query = {
      from: "2026-09-01",
      to: "2026-10-31",
      subject: "",
      mode: "",
      ...filters,
    };
    const rows = all(
      "SELECT l.*,e.id entryId,e.subject FROM logs l JOIN reviews r ON r.id=l.review_id JOIN entries e ON e.id=r.entry_id WHERE l.owner=? AND e.owner=? AND e.deleted_at IS NULL ORDER BY l.created_at,l.id",
      owner,
      owner,
    ).filter(
      (r) =>
        r.local_date >= query.from &&
        r.local_date <= query.to &&
        (!query.subject || query.subject === r.subject) &&
        (!query.mode || query.mode === r.mode),
    );
    const expected = summarize(
      rows.map((r) => {
        const p = JSON.parse(r.payload);
        return {
          id: r.id,
          entryId: r.entryId,
          date: r.local_date,
          rating: r.rating,
          mode: r.mode,
          hint: !!p.hintUsed,
          errorCauses: p.errorCauses,
        };
      }),
    );
    const { query: _query, ...actual } = learningStatistics(owner, query);
    assert.deepEqual(actual, expected);
  }
});
test("队列和首页数据库往返数量固定，不随题目数增加；查询使用组合索引", (t) => {
  const prepare = db.prepare.bind(db);
  let count = 0;
  t.mock.method(db, "prepare", (sql: string) => {
    count++;
    return prepare(sql);
  });
  assert.ok(reviewQueue(owner).items.length > 0);
  assert.equal(count, 2);
  count = 0;
  assert.ok(dashboard(owner).total > 0);
  assert.equal(count, 6);
  const plan = all(
    "EXPLAIN QUERY PLAN SELECT id FROM entries WHERE owner=? AND deleted_at IS NULL AND type=? ORDER BY updated_at DESC,id LIMIT 20",
    owner,
    "MATH",
  );
  assert.ok(
    plan.some((row) => row.detail.includes("entries_owner_type_recent")),
  );
});

test("派生搜索与筛选随编辑和删除同步，备份只保留业务原数据", () => {
  const entry = createEntry(owner, {
    type: "MATH",
    subject: "高等数学",
    title: "cache-only",
    body: "原始材料",
    details: { takeaway_md: "old-search-marker" },
    tags: ["old-tag"],
  });
  assert.equal(
    entries(owner, new URLSearchParams("q=old-search-marker&tag=old-tag"))
      .total,
    1,
  );
  updateEntry(owner, entry.id, {
    expectedVersion: 1,
    details: { takeaway_md: "new-search-marker" },
    tags: ["new-tag"],
  });
  assert.equal(
    entries(owner, new URLSearchParams("q=old-search-marker")).total,
    0,
  );
  assert.equal(
    entries(owner, new URLSearchParams("q=new-search-marker&tag=new-tag"))
      .total,
    1,
  );
  assert.equal(entries(owner, new URLSearchParams("tag=old-tag")).total, 0);
  const data = JSON.parse(strFromU8(unzipSync(backup(owner))["data.json"]));
  assert.equal("entry_search" in data, false);
  assert.equal("entry_filter_values" in data, false);
  run("DELETE FROM revisions WHERE entry_id=?", entry.id);
  run("DELETE FROM entries WHERE id=?", entry.id);
  assert.equal(
    all("SELECT entry_id FROM entry_search WHERE entry_id=?", entry.id).length,
    0,
  );
  assert.equal(
    all("SELECT entry_id FROM entry_filter_values WHERE entry_id=?", entry.id)
      .length,
    0,
  );
});
