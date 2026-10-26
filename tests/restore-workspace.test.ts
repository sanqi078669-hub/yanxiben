import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-restore-ui-"));
const { run, one, dataDir } = await import("../src/lib/db");
const { defaults, entrySchema } = await import("../src/lib/model");
const { createEntry } = await import("../src/modules/entries/service");
const { backup } = await import("../src/modules/data-management/backup");
const {
  previewRestore,
  backupStatus,
  recordBackup,
  launchRestore,
  deleteRestore,
  cleanupRestoreWorkspaces,
  restoreWorkspaces,
  restoreControl,
  stopRestore,
} = await import("../src/modules/data-management/restore-workspace");
test(
  "恢复空间数量受限，隔离服务不继承生产来源和代理配置",
  { timeout: 60000 },
  async (t) => {
    const owner = randomUUID();
    const bcrypt = await import("bcryptjs");
    const password = randomUUID();
    run(
      "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
      owner,
      owner,
      bcrypt.hashSync(password, 4),
      JSON.stringify(defaults),
      "user",
    );
    const bytes = backup(owner),
      first = await previewRestore(owner, bytes),
      second = await previewRestore(owner, bytes);
    await assert.rejects(() => previewRestore(owner, bytes), {
      code: "RESTORE_WORKSPACE_LIMIT",
    });
    const previous = { ...process.env };
    Object.assign(process.env, {
      YANXI_DEPLOYMENT: "invited",
      PUBLIC_ORIGIN: "https://study.example.org",
      PROXY_SECRET: "p".repeat(48),
      SECURE_COOKIES: "1",
    });
    t.after(async () => {
      for (const key of Object.keys(process.env))
        if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
      await stopRestore(owner, { id: first.id });
      deleteRestore(owner, { id: first.id });
      deleteRestore(owner, { id: second.id });
    });
    const { url } = await launchRestore(owner, { id: first.id, confirm: true });
    const login = await fetch(url + "/api/v1/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "yanxiben",
        Origin: url,
      },
      body: JSON.stringify({ username: owner, password }),
    });
    assert.equal(login.status, 200);
    assert(!login.headers.get("set-cookie")!.includes("Secure"));
  },
);
test("恢复向导在隔离目录校验并保留当前数据库，损坏包拒绝", async () => {
  const owner = randomUUID();
  run(
    "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
    owner,
    owner,
    "hash",
    JSON.stringify(defaults),
    "user",
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
  await assert.rejects(
    () => previewRestore(owner, new Uint8Array([1, 2, 3])),
    (error: any) => {
      assert.equal(error.code, "INVALID_BACKUP");
      assert.doesNotMatch(
        error.message,
        /sqlite|ENOENT|restore-workspaces|invalid zip/i,
      );
      return true;
    },
  );
  await assert.rejects(() =>
    launchRestore(randomUUID(), { id: preview.id, confirm: true }),
  );
  assert.equal(backupStatus(owner).created, null);
  recordBackup(owner);
  assert.ok(backupStatus(owner).created);
  const before = readdirSync(path.join(dataDir, "restore-workspaces")).sort();
  await assert.rejects(() => previewRestore(owner, bytes, { timeoutMs: 1 }), {
    code: "RESTORE_TIMEOUT",
  });
  assert.deepEqual(
    readdirSync(path.join(dataDir, "restore-workspaces")).sort(),
    before,
  );
  const controller = new AbortController();
  const cancelled = previewRestore(owner, bytes, { signal: controller.signal });
  controller.abort();
  await assert.rejects(() => cancelled, { code: "RESTORE_CANCELLED" });
  assert.deepEqual(
    readdirSync(path.join(dataDir, "restore-workspaces")).sort(),
    before,
  );
  assert.throws(
    () => deleteRestore(randomUUID(), { id: preview.id }),
    /不存在/,
  );
  assert.equal(restoreWorkspaces(owner).length, 1);
  assert.equal(cleanupRestoreWorkspaces(owner, Date.now() + 8 * 86400000), 1);
  assert.equal(restoreWorkspaces(owner).length, 0);
  assert.equal(existsSync(preview.folder), false);
});

test("编译恢复 worker 不向 stdout 暴露文件错误原文", () => {
  const child = spawnSync(
    process.execPath,
    [path.resolve("runtime/restore-worker.mjs")],
    {
      env: {
        ...process.env,
        DATA_DIR: path.join(dataDir, "missing-file-worker"),
      },
      input: JSON.stringify({
        file: path.join(dataDir, "private-missing.zip"),
        username: "fixture",
        passwordHash: "hash",
      }),
      encoding: "utf8",
    },
  );
  assert.equal(child.status, 1);
  assert.deepEqual(JSON.parse(child.stdout), {
    error: { code: "RESTORE_FAILED" },
  });
  assert.doesNotMatch(child.stdout, /ENOENT|private-missing|sqlite|[A-Z]:\\/i);
  assert.match(child.stderr, /ENOENT/);
});

test("进程控制仅接受隔离实例私有令牌，不接受未知或畸形令牌", () => {
  const previous = process.env.RESTORE_CONTROL_TOKEN;
  try {
    delete process.env.RESTORE_CONTROL_TOKEN;
    assert.throws(() => restoreControl("GET", "a".repeat(64)), /接口不存在/);
    process.env.RESTORE_CONTROL_TOKEN = "a".repeat(64);
    for (const value of [null, "b".repeat(64), "汉".repeat(64)])
      assert.throws(() => restoreControl("POST", value), /接口不存在/);
    assert.deepEqual(restoreControl("GET", "a".repeat(64)), {
      pid: process.pid,
    });
    assert.throws(() => restoreControl("DELETE", "a".repeat(64)), /方法不支持/);
  } finally {
    if (previous === undefined) delete process.env.RESTORE_CONTROL_TOKEN;
    else process.env.RESTORE_CONTROL_TOKEN = previous;
  }
});
