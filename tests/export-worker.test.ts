import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
process.env.DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-export-worker-"),
);
const { db, run, one, dataDir, readSnapshot } = await import("../src/lib/db");
const { defaults, entrySchema } = await import("../src/lib/model");
const { createEntry } = await import("../src/modules/entries/service");
const { prepareExport } =
  await import("../src/modules/data-management/export-worker");
function account() {
  const owner = randomUUID();
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
      title: "worker",
      body: "合成题目",
    }),
  );
  return owner;
}
test("只读快照保留一致视图，同时其他连接可写入，不持有写保留锁", () => {
  const owner = account();
  readSnapshot(() => {
    assert.equal(
      one("SELECT username FROM users WHERE id=?", owner)!.username,
      owner,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.env.TEST_DB); db.exec('PRAGMA busy_timeout=250'); db.prepare('UPDATE users SET username=? WHERE id=?').run('writer-committed',process.env.TEST_OWNER); db.close();",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
        env: {
          ...process.env,
          TEST_DB: path.join(dataDir, "yanxiben.sqlite"),
          TEST_OWNER: owner,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      one("SELECT username FROM users WHERE id=?", owner)!.username,
      owner,
    );
  });
  assert.equal(
    one("SELECT username FROM users WHERE id=?", owner)!.username,
    "writer-committed",
  );
  assert.equal(db.isTransaction, false);
});
test("编译导出 worker 不占用父事件循环，同键重放保持字节且限制并发", async () => {
  const owner = account(),
    key = randomUUID();
  let completed = false;
  const request = prepareExport(owner, "BACKUP", key).then((value) => {
    completed = true;
    return value;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  await assert.rejects(() => prepareExport(owner, "BACKUP", key), /已有导出/);
  const first = await request,
    second = await prepareExport(owner, "BACKUP", key);
  assert.deepEqual(readFileSync(first.filename), readFileSync(second.filename));
  assert.equal(
    one("SELECT count(*) n FROM export_receipts WHERE owner=?", owner)!.n,
    1,
  );
  await assert.rejects(() => prepareExport(owner, "MARKDOWN", key), /不同类型/);
});
test("导出取消和超时释放闸门，不留下未提交回执", async () => {
  const owner = account(),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      prepareExport(owner, "BACKUP", randomUUID(), {
        signal: controller.signal,
      }),
    /取消/,
  );
  await assert.rejects(
    () => prepareExport(owner, "BACKUP", randomUUID(), { timeoutMs: 1 }),
    /超时/,
  );
  assert.equal(
    one("SELECT count(*) n FROM export_receipts WHERE owner=?", owner)!.n,
    0,
  );
  assert((await prepareExport(owner, "BACKUP", randomUUID())).size > 0);
});
