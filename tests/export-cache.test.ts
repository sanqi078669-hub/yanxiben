import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
process.env.DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-export-cache-"),
);
const { run, one, all, dataDir } = await import("../src/lib/db");
const { defaults } = await import("../src/lib/model");
const { exportArtifact } =
  await import("../src/modules/data-management/exports");
const { reserveExport, exportFile, startExportCacheCleanup, EXPORT_TTL } =
  await import("../src/modules/data-management/export-cache");
const { prepareExport } =
  await import("../src/modules/data-management/export-worker");
function account() {
  const owner = randomUUID();
  run(
    "INSERT INTO users VALUES(?,?,?,?)",
    owner,
    owner,
    "synthetic-hash",
    JSON.stringify(defaults),
  );
  return owner;
}
beforeEach(() => {
  // Only synthetic cache files in this test's unique temporary DATA_DIR.
  assert(path.basename(dataDir).startsWith("yanxi-export-cache-"));
  for (const row of all("SELECT file_id FROM export_receipts"))
    rmSync(exportFile(row.file_id), { force: true });
  run("DELETE FROM export_receipts");
  Object.assign(process.env, {
    EXPORT_CACHE_ACCOUNT_BYTES: "100000",
    EXPORT_CACHE_INSTANCE_BYTES: "200000",
    EXPORT_CACHE_ACCOUNT_FILES: "12",
    EXPORT_CACHE_INSTANCE_FILES: "60",
    EXPORT_CACHE_RATE_COUNT: "100",
    EXPORT_CACHE_RATE_WINDOW_MS: "300000",
    EXPORT_CACHE_MIN_FREE_BYTES: "1",
    EXPORT_CACHE_CLEANUP_MS: "20",
  });
});
test("账号及实例字节预算分别拒绝新任务，旧键绕过预算和频率，其他业务可写", () => {
  for (const dimension of ["ACCOUNT", "INSTANCE"]) {
    const owner = account(),
      key = randomUUID();
    const first = exportArtifact(owner, "MARKDOWN", key);
    process.env[`EXPORT_CACHE_${dimension}_BYTES`] = String(first.size + 1);
    const requester = dimension === "ACCOUNT" ? owner : account();
    assert.throws(() => exportArtifact(requester, "MARKDOWN", randomUUID()), {
      code: "EXPORT_CACHE_LIMIT",
    });
    assert.equal(exportArtifact(owner, "MARKDOWN", key).fileId, first.fileId);
    assert.equal(one("SELECT count(*) n FROM export_receipts")!.n, 1);
    assert.equal(readdirSync(path.join(dataDir, "export-cache")).length, 1);
    run("UPDATE users SET username=? WHERE id=?", randomUUID(), requester);
    rmSync(first.filename);
    run("DELETE FROM export_receipts");
    process.env[`EXPORT_CACHE_${dimension}_BYTES`] = "100000";
  }
});
test("账号文件数和实例文件数同时生效，不淘汰有效文件", () => {
  process.env.EXPORT_CACHE_ACCOUNT_FILES = "2";
  process.env.EXPORT_CACHE_INSTANCE_FILES = "3";
  const owner = account(),
    other = account(),
    key = randomUUID();
  const first = exportArtifact(owner, "MARKDOWN", key);
  exportArtifact(owner, "MARKDOWN", randomUUID());
  assert.throws(() => exportArtifact(owner, "MARKDOWN", randomUUID()), {
    code: "EXPORT_CACHE_LIMIT",
  });
  exportArtifact(other, "MARKDOWN", randomUUID());
  assert.throws(() => exportArtifact(account(), "MARKDOWN", randomUUID()), {
    code: "EXPORT_CACHE_LIMIT",
  });
  assert.equal(exportArtifact(owner, "MARKDOWN", key).fileId, first.fileId);
  assert(existsSync(first.filename));
});
test("5 分钟最多三个新键，重放不计频率，窗口到期恢复", () => {
  process.env.EXPORT_CACHE_RATE_COUNT = "3";
  const owner = account(),
    key = randomUUID(),
    now = Date.now();
  const first = exportArtifact(owner, "MARKDOWN", key, now);
  for (let i = 0; i < 10; i++)
    assert.equal(
      exportArtifact(owner, "MARKDOWN", key, now + 1).fileId,
      first.fileId,
    );
  exportArtifact(owner, "MARKDOWN", randomUUID(), now + 1);
  exportArtifact(owner, "MARKDOWN", randomUUID(), now + 2);
  assert.throws(
    () => exportArtifact(owner, "MARKDOWN", randomUUID(), now + 299999),
    { code: "EXPORT_RATE_LIMITED" },
  );
  assert(exportArtifact(owner, "MARKDOWN", randomUUID(), now + 300000));
});
test("生成前预留覆盖并发账号/实例预算，释放后可重试", () => {
  const owner = account();
  process.env.EXPORT_CACHE_INSTANCE_BYTES = "100000";
  const pending = reserveExport(owner);
  try {
    assert.throws(() => reserveExport(owner), { code: "EXPORT_CACHE_LIMIT" });
    assert.throws(() => reserveExport(account()), {
      code: "EXPORT_CACHE_LIMIT",
    });
  } finally {
    pending.release();
  }
  const retry = reserveExport(owner);
  retry.release();
});
test("生成前磁盘不足明确拒绝；worker 落盘前再次检查且失败释放预留", async () => {
  const owner = account();
  process.env.EXPORT_CACHE_MIN_FREE_BYTES = String(Number.MAX_SAFE_INTEGER);
  assert.throws(() => reserveExport(owner), { code: "EXPORT_DISK_LIMIT" });
  process.env.EXPORT_CACHE_MIN_FREE_BYTES = "1";
  const reservation = reserveExport(owner);
  try {
    process.env.EXPORT_CACHE_MIN_FREE_BYTES = String(Number.MAX_SAFE_INTEGER);
    assert.throws(
      () =>
        exportArtifact(
          owner,
          "MARKDOWN",
          randomUUID(),
          Date.now(),
          randomUUID(),
          reservation.bytes,
        ),
      { code: "EXPORT_DISK_LIMIT" },
    );
    assert.equal(one("SELECT count(*) n FROM export_receipts")!.n, 0);
  } finally {
    reservation.release();
  }
  process.env.EXPORT_CACHE_MIN_FREE_BYTES = "1";
  process.env.EXPORT_CACHE_ACCOUNT_BYTES = "1";
  await assert.rejects(() => prepareExport(owner, "MARKDOWN", randomUUID()), {
    code: "EXPORT_CACHE_LIMIT",
  });
  process.env.EXPORT_CACHE_ACCOUNT_BYTES = "100000";
  assert((await prepareExport(owner, "MARKDOWN", randomUUID())).size > 0);
});
test("worker 新键限频错误明确，预算已满时旧键仍可下载", async () => {
  const owner = account(),
    key = randomUUID();
  process.env.EXPORT_CACHE_RATE_COUNT = "1";
  const first = await prepareExport(owner, "MARKDOWN", key);
  await assert.rejects(() => prepareExport(owner, "MARKDOWN", randomUUID()), {
    code: "EXPORT_RATE_LIMITED",
  });
  process.env.EXPORT_CACHE_ACCOUNT_BYTES = "1";
  assert.equal(
    (await prepareExport(owner, "MARKDOWN", key)).filename,
    first.filename,
  );
});
test("独立定时器无新导出时清理过期文件和回执，保留七天内旧键", async () => {
  const owner = account(),
    key = randomUUID(),
    now = Date.now();
  const retained = exportArtifact(owner, "MARKDOWN", key, now);
  startExportCacheCleanup();
  const id = randomUUID();
  writeFileSync(exportFile(id), "expired synthetic archive");
  run(
    "INSERT INTO export_receipts VALUES(?,?,?,?,?)",
    owner,
    randomUUID(),
    "MARKDOWN",
    id,
    now - 1,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(existsSync(exportFile(id)), false);
  assert.equal(
    one("SELECT file_id FROM export_receipts WHERE file_id=?", id),
    undefined,
  );
  assert.equal(
    exportArtifact(owner, "MARKDOWN", key, now + EXPORT_TTL - 1).fileId,
    retained.fileId,
  );
  assert(existsSync(retained.filename));
});
