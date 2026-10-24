import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { statisticsDates } from "../src/lib/statistics-dates";
import { assertQaPath } from "../scripts/qa-path";

process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-remaining-"));
const { run, one, dataDir } = await import("../src/lib/db");
const { defaults, entrySchema } = await import("../src/lib/model");
const { createEntry, updateEntry } =
  await import("../src/modules/entries/service");
const { exportArchive, EXPORT_TTL } =
  await import("../src/modules/data-management/exports");
const { learningStatistics } = await import("../src/modules/review/statistics");

test("统计默认日期按用户时区，上海凌晨跨月仍包含当天", () => {
  for (const hour of [0, 1, 7]) {
    const now = new Date(`2026-11-01T0${hour}:15:00+08:00`);
    assert.deepEqual(statisticsDates("Asia/Shanghai", now), {
      from: "2026-10-02",
      to: "2026-11-01",
    });
    assert.equal(statisticsDates("America/Los_Angeles", now).to, "2026-10-31");
  }
  const owner = randomUUID(),
    entry = randomUUID(),
    review = randomUUID();
  run(
    "INSERT INTO users VALUES(?,?,?,?)",
    owner,
    owner,
    "hash",
    JSON.stringify(defaults),
  );
  createEntry(
    owner,
    entrySchema.parse({
      type: "MATH",
      subject: "高等数学",
      title: "凌晨练习",
      body: "1+1",
    }),
  );
  // Use the persisted record ID for a same-day log at the UTC previous date.
  const id = one("SELECT id FROM entries WHERE owner=?", owner)!.id;
  run(
    "INSERT INTO reviews(id,owner,entry_id,stage,stage_index,success_streak,due_on,version) VALUES(?,?,?,'NEW',-1,0,'2026-11-01',1)",
    review,
    owner,
    id,
  );
  run(
    "INSERT INTO logs(id,owner,review_id,mode,rating,local_date,payload,created_at) VALUES(?,?,?,'PRACTICE','GOOD','2026-11-01','{}','2026-10-31T16:15:00Z')",
    entry,
    owner,
    review,
  );
  assert.equal(
    learningStatistics(
      owner,
      statisticsDates("Asia/Shanghai", new Date("2026-10-31T16:15:00Z")),
    ).total,
    1,
  );
});

test("QA 路径守卫拒绝相似名称、越界及 junction", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "yanxi-path-"));
  mkdirSync(path.join(root, "test-results"));
  const allowed = path.join(root, "test-results", "new", "qa");
  assert.equal(assertQaPath(allowed, root), allowed);
  for (const target of [
    undefined,
    path.join(root, "test-results"),
    path.join(root, "test-results-evil", "qa"),
    path.join(root, "test-results", "..", "data"),
  ])
    assert.throws(() => assertQaPath(target, root));
  mkdirSync(path.join(root, "outside"));
  symlinkSync(
    path.join(root, "outside"),
    path.join(root, "test-results", "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() =>
    assertQaPath(path.join(root, "test-results", "link", "qa"), root),
  );
});

test("导出同键固定快照、隔离用户、到期清理且不更新备份时间", () => {
  const owners = [randomUUID(), randomUUID()];
  for (const owner of owners)
    run(
      "INSERT INTO users VALUES(?,?,?,?)",
      owner,
      owner,
      "hash",
      JSON.stringify(defaults),
    );
  const owner = owners[0];
  const entry = createEntry(
    owner,
    entrySchema.parse({
      type: "MATH",
      subject: "高等数学",
      title: "旧快照",
      body: "x",
    }),
  );
  const key = randomUUID();
  const first = exportArchive(owner, "BACKUP", key, 1000);
  const timestamp = one(
    "SELECT created FROM backup_status WHERE owner=?",
    owner,
  );
  updateEntry(owner, entry.id, {
    ...entrySchema.parse({
      type: "MATH",
      subject: "高等数学",
      title: "新内容",
      body: "y",
    }),
    expectedVersion: entry.version,
  });
  assert.deepEqual(exportArchive(owner, "BACKUP", key, 2000), first);
  assert.deepEqual(
    one("SELECT created FROM backup_status WHERE owner=?", owner),
    timestamp,
  );
  assert.throws(() => exportArchive(owner, "MARKDOWN", key, 2000), /不同类型/);
  assert.notDeepEqual(exportArchive(owners[1], "BACKUP", key, 2000), first);
  assert.notDeepEqual(
    exportArchive(owner, "BACKUP", randomUUID(), 2000),
    first,
  );
  assert.equal(readdirSync(path.join(dataDir, "export-cache")).length, 3);
  assert.notDeepEqual(
    exportArchive(owner, "BACKUP", key, EXPORT_TTL + 3000),
    first,
  );
  assert.equal(readdirSync(path.join(dataDir, "export-cache")).length, 1);
});
