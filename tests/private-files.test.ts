import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  statSync,
  chmodSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import {
  privateDirectory,
  reservePrivateFile,
  warnPrivatePermissions,
} from "../src/lib/private-files";
import { migrateDatabase, migrations } from "../src/lib/migrations";

test("私有文件独占预留不会覆盖已有数据", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "yanxi-private-"));
  const file = path.join(root, "existing");
  reservePrivateFile(file);
  writeFileSync(file, "keep");
  reservePrivateFile(file);
  assert.equal(readFileSync(file, "utf8"), "keep");
});
test(
  "POSIX 新目录0700/文件0600，已有过宽权限只告警不修改",
  {
    skip:
      process.platform === "win32"
        ? "Windows 使用 ACL，不能用 mode 结果冒充 POSIX 验证"
        : false,
  },
  () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "yanxi-posix-")),
      directory = path.join(root, "data"),
      file = path.join(directory, "database");
    privateDirectory(directory);
    reservePrivateFile(file);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    chmodSync(file, 0o644);
    const messages: unknown[][] = [],
      previous = console.warn;
    console.warn = (...args) => {
      messages.push(args);
    };
    try {
      warnPrivatePermissions(file);
      warnPrivatePermissions(file);
    } finally {
      console.warn = previous;
    }
    assert.equal(messages.length, 1);
    assert.equal(statSync(file).mode & 0o777, 0o644);
  },
);
test("CLI 错指 v3 已有目录时先拒绝，不打开迁移目标库", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "yanxi-cli-preflight-"));
  const file = path.join(root, "yanxiben.sqlite"),
    zip = path.join(root, "not-used.zip");
  const db = new DatabaseSync(file);
  migrateDatabase(db, { steps: migrations.slice(0, 3) });
  db.close();
  writeFileSync(zip, "not-used");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/data.ts", "restore", zip],
    {
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        DATA_DIR: root,
        RESTORE_PASSWORD: "synthetic-password",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /空目录/);
  const unchanged = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(
      unchanged.prepare("PRAGMA user_version").get()!.user_version,
      3,
    );
  } finally {
    unchanged.close();
  }
});
