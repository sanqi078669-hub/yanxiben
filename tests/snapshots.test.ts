import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  migrationSnapshotPlan,
  pruneMigrationSnapshots,
} from "../src/modules/data-management/snapshots";

test("快照清理默认预览，兼顾数量和年龄且保留最后一份", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "yanxi-snapshots-"));
  const now = Date.now();
  for (let i = 0; i < 5; i++)
    writeFileSync(
      path.join(
        directory,
        `before-${now - i * 40 * 86400000}-${randomUUID()}.sqlite`,
      ),
      "synthetic",
    );
  writeFileSync(path.join(directory, "unrelated.sqlite"), "keep");
  const planned = pruneMigrationSnapshots(directory, {});
  assert.equal(planned.files.filter((file) => file.remove).length, 2);
  assert.equal(readdirSync(directory).length, 6);
  assert.equal(pruneMigrationSnapshots(directory, {}, true).removed, 2);
  assert.equal(readdirSync(directory).length, 4);
  assert.equal(
    pruneMigrationSnapshots(directory, { keep: 1, days: 0 }, true, now + 1)
      .removed,
    2,
  );
  assert.equal(readdirSync(directory).length, 2);
  assert.throws(() => pruneMigrationSnapshots(directory, { keep: 0 }, true));
  assert.equal(
    migrationSnapshotPlan(path.join(directory, "missing"), {}).files.length,
    0,
  );
  const link = directory + "-link";
  symlinkSync(
    directory,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => pruneMigrationSnapshots(link, {}, true), /目录/);
});
