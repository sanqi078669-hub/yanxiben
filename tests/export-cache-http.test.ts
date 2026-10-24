import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
import bcrypt from "bcryptjs";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-cache-http-"));
const { run, one, dataDir } = await import("../src/lib/db");
const { defaults, entrySchema } = await import("../src/lib/model");
const { createEntry } = await import("../src/modules/entries/service");
const { exportArtifact } =
  await import("../src/modules/data-management/exports");
const { exportFile } =
  await import("../src/modules/data-management/export-cache");
test("HTTP 小缓存预算拒绝新任务、保留旧键，启动清理无需导出请求", async (t) => {
  const password = "synthetic-cache-password";
  const owners = Array.from({ length: 4 }, () => randomUUID());
  for (const owner of owners)
    run(
      "INSERT INTO users VALUES(?,?,?,?)",
      owner,
      owner,
      bcrypt.hashSync(password, 4),
      JSON.stringify(defaults),
    );
  writeFileSync(
    path.join(dataDir, "session-secret"),
    randomBytes(48).toString("hex"),
  );
  createEntry(
    owners[3],
    entrySchema.parse({
      type: "MATH",
      subject: "高等数学",
      title: "synthetic",
      body: randomBytes(20000).toString("hex"),
    }),
  );
  const key = randomUUID(),
    retained = exportArtifact(owners[0], "MARKDOWN", key);
  const expired = randomUUID();
  writeFileSync(exportFile(expired), "synthetic expired file");
  run(
    "INSERT INTO export_receipts VALUES(?,?,?,?,?)",
    owners[0],
    randomUUID(),
    "MARKDOWN",
    expired,
    Date.now() - 1,
  );
  const base = "http://127.0.0.1:3139";
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3139",
    ],
    {
      env: {
        ...process.env,
        EXPORT_CACHE_ACCOUNT_BYTES: "5000",
        EXPORT_CACHE_INSTANCE_BYTES: "20000",
        EXPORT_CACHE_ACCOUNT_FILES: "2",
        EXPORT_CACHE_INSTANCE_FILES: "3",
        EXPORT_CACHE_RATE_COUNT: "3",
        EXPORT_CACHE_RATE_WINDOW_MS: "300000",
        EXPORT_CACHE_MIN_FREE_BYTES: "1",
        EXPORT_CACHE_CLEANUP_MS: "20",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  server.stdout.on("data", (value) => (output += value));
  server.stderr.on("data", (value) => (output += value));
  t.after(() => server.kill());
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + "/api/v1/settings")).status === 401) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, output);
  assert.equal(existsSync(exportFile(expired)), false);
  assert(existsSync(retained.filename));
  // Add another expired item after startup; no export request triggers its deletion.
  const later = randomUUID();
  writeFileSync(exportFile(later), "synthetic later file");
  run(
    "INSERT INTO export_receipts VALUES(?,?,?,?,?)",
    owners[0],
    randomUUID(),
    "MARKDOWN",
    later,
    Date.now() - 1,
  );
  for (let i = 0; i < 40 && existsSync(exportFile(later)); i++)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(existsSync(exportFile(later)), false);
  assert.equal(
    one("SELECT file_id FROM export_receipts WHERE file_id=?", later),
    undefined,
  );
  const call = (
    route: string,
    body: unknown,
    cookie = "",
    requestKey = randomUUID(),
  ) =>
    fetch(base + "/api/v1/" + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "yanxiben",
        Origin: base,
        Cookie: cookie,
        "Idempotency-Key": requestKey,
      },
      body: JSON.stringify(body),
    });
  const cookies: string[] = [];
  for (const owner of owners) {
    const response = await call("auth/login", { username: owner, password });
    assert.equal(response.status, 200);
    cookies.push(response.headers.get("set-cookie")!.split(";")[0]);
  }
  const oversized = await call(
    "exports",
    { type: "MARKDOWN", password },
    cookies[3],
  );
  assert.equal(oversized.status, 507);
  assert.equal((await oversized.json()).error.code, "EXPORT_CACHE_LIMIT");
  const first = await call(
    "exports",
    { type: "MARKDOWN", password },
    cookies[0],
    key,
  );
  assert.equal(first.status, 200);
  const bytes = Buffer.from(await first.arrayBuffer());
  assert.equal(
    (await call("exports", { type: "MARKDOWN", password }, cookies[0])).status,
    200,
  );
  const accountLimit = await call(
    "exports",
    { type: "MARKDOWN", password },
    cookies[0],
  );
  assert.equal(accountLimit.status, 507);
  assert.equal((await accountLimit.json()).error.code, "EXPORT_CACHE_LIMIT");
  assert.equal(
    (await call("exports", { type: "MARKDOWN", password }, cookies[1])).status,
    200,
  );
  assert.equal(
    (await call("exports", { type: "MARKDOWN", password }, cookies[2])).status,
    507,
  );
  const replay = await call(
    "exports",
    { type: "MARKDOWN", password },
    cookies[0],
    key,
  );
  assert.equal(replay.status, 200);
  assert.deepEqual(Buffer.from(await replay.arrayBuffer()), bytes);
  const write = await fetch(base + "/api/v1/settings", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "yanxiben",
      Origin: base,
      Cookie: cookies[0],
    },
    body: JSON.stringify(defaults),
  });
  assert.equal(write.status, 200);
});
