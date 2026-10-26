import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTACHMENT_MAX_BYTES,
  BACKUP_ZIP_MAX_BYTES,
  BACKUP_UNPACKED_MAX_BYTES,
} from "../src/lib/capacity";
import { mkdtempSync, truncateSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { zipSync, strToU8 } from "fflate";
import { DatabaseSync } from "node:sqlite";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-capacity-"));
const {
  checkAttachmentCapacity,
  checkBackupCapacity,
  checkCachedArchiveCapacity,
} = await import("../src/modules/data-management/capacity");
const { run, dataDir } = await import("../src/lib/db");
const { backup } = await import("../src/modules/data-management/backup");
const { defaults, entrySchema } = await import("../src/lib/model");
const { createEntry } = await import("../src/modules/entries/service");

test("备份 ZIP/解压/重编码图片边界共用容量契约", () => {
  checkBackupCapacity(BACKUP_UNPACKED_MAX_BYTES, BACKUP_ZIP_MAX_BYTES);
  checkAttachmentCapacity(ATTACHMENT_MAX_BYTES);
  assert.throws(
    () => checkAttachmentCapacity(ATTACHMENT_MAX_BYTES + 1),
    /重新编码/,
  );
  assert.throws(
    () => checkBackupCapacity(BACKUP_UNPACKED_MAX_BYTES + 1),
    /可恢复容量/,
  );
  assert.throws(
    () =>
      checkBackupCapacity(20 * ATTACHMENT_MAX_BYTES, BACKUP_ZIP_MAX_BYTES + 1),
    /可恢复容量/,
  );
  // Twenty maximum-sized images leave no room for ZIP headers if incompressible.
  assert.throws(
    () =>
      checkBackupCapacity(
        20 * ATTACHMENT_MAX_BYTES + 1000,
        20 * ATTACHMENT_MAX_BYTES + 1000,
      ),
    /可恢复容量/,
  );
});

test("旧超限附件在读取和压缩前拒绝，不生成不可恢复备份", () => {
  const owner = randomUUID(),
    id = randomUUID();
  run(
    "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
    owner,
    owner,
    "hash",
    JSON.stringify(defaults),
    "user",
  );
  const filename = path.join(dataDir, "attachments", id);
  writeFileSync(filename, "");
  truncateSync(filename, ATTACHMENT_MAX_BYTES + 1);
  run(
    "INSERT INTO attachments VALUES(?,?,?,?,?,?,?)",
    id,
    owner,
    "oversized.png",
    "image/png",
    ATTACHMENT_MAX_BYTES + 1,
    "0".repeat(64),
    new Date().toISOString(),
  );
  assert.throws(() => backup(owner), /10 MiB/);
});

test("一条记录包含 20 张合法图片时完整导出可恢复", async () => {
  const owner = randomUUID();
  run(
    "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
    owner,
    owner,
    "hash",
    JSON.stringify(defaults),
    "user",
  );
  const bytes = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  const attachments = Array.from({ length: 20 }, () => ({
    id: randomUUID(),
    role: "PROMPT",
  }));
  for (const { id } of attachments) {
    writeFileSync(path.join(dataDir, "attachments", id), bytes);
    run(
      "INSERT INTO attachments VALUES(?,?,?,?,?,?,?)",
      id,
      owner,
      "fixture.png",
      "image/png",
      bytes.length,
      createHash("sha256").update(bytes).digest("hex"),
      new Date().toISOString(),
    );
  }
  createEntry(
    owner,
    entrySchema.parse({
      type: "MATH",
      title: "20 张图片边界",
      subject: "高等数学",
      body: "20 张图片边界",
      attachments,
    }),
  );
  const filename = path.join(dataDir, "twenty-images.zip");
  writeFileSync(filename, backup(owner));
  const target = mkdtempSync(path.join(os.tmpdir(), "yanxi-twenty-restore-"));
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/data.ts", "restore", filename],
    {
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        DATA_DIR: target,
        RESTORE_PASSWORD: "synthetic-restore-password",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const restored = new DatabaseSync(path.join(target, "yanxiben.sqlite"), {
    readOnly: true,
  });
  try {
    assert.equal(
      restored.prepare("SELECT count(*) n FROM attachments").get()!.n,
      20,
    );
  } finally {
    restored.close();
  }
});

test("旧缓存 ZIP 按解压元数据检查 500 MiB 上限，不分配声明的大文件", () => {
  const bytes = zipSync({ "history.json": strToU8("[]") });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let changed = false;
  for (let i = 0; i <= bytes.length - 28; i++)
    if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, BACKUP_UNPACKED_MAX_BYTES + 1, true);
      changed = true;
      break;
    }
  assert(changed);
  assert.throws(() => checkCachedArchiveCapacity(bytes), /可恢复容量/);
});
