import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-restore-ui-"));
const { run, one } = await import("../src/lib/db");
const { defaults, entrySchema } = await import("../src/lib/model");
const { createEntry } = await import("../src/modules/entries/service");
const { backup } = await import("../src/modules/data-management/backup");
const { previewRestore, backupStatus, recordBackup, launchRestore } =
  await import("../src/modules/data-management/restore-workspace");
test("恢复向导在隔离目录校验并保留当前数据库，损坏包拒绝", async () => {
  const owner = randomUUID();
  run(
    "INSERT INTO users VALUES(?,?,?,?)",
    owner,
    owner,
    "hash",
    JSON.stringify(defaults),
  );
  const entry = createEntry(
    owner,
    entrySchema.parse({
      type: "MATH",
      title: "恢复验收",
      subject: "高等数学",
      body: "题目",
    }),
  );
  const bytes = backup(owner),
    preview = await previewRestore(owner, bytes);
  assert.equal(preview.counts.entries, 1);
  assert.ok(existsSync(path.join(preview.folder, "yanxiben.sqlite")));
  assert.equal(
    one("SELECT title FROM entries WHERE id=?", entry.id)?.title,
    "恢复验收",
  );
  await assert.rejects(() => previewRestore(owner, new Uint8Array([1, 2, 3])));
  await assert.rejects(() =>
    launchRestore(randomUUID(), { id: preview.id, confirm: true }),
  );
  assert.equal(backupStatus(owner).created, null);
  recordBackup(owner);
  assert.ok(backupStatus(owner).created);
});
