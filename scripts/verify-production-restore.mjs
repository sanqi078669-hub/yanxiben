import assert from "node:assert/strict";
import {
  mkdtempSync,
  cpSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import bcrypt from "bcryptjs";

const source = process.cwd();
const npmCli = process.env.npm_execpath;
assert(npmCli, "请通过 npm run test:production 执行");
assert(
  existsSync(".next/BUILD_ID") && existsSync("runtime/restore-worker.mjs"),
  "请先 npm run build",
);
const folder = mkdtempSync(path.join(os.tmpdir(), "yanxi-prod-install-"));
const target = path.join(folder, "data");
let server,
  base,
  cookie = "",
  workspaceId = "",
  childUrl = "";
let occupiedPort;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function command(args, options = {}) {
  const child = spawn(process.execPath, args, {
    cwd: folder,
    windowsHide: true,
    ...options,
  });
  let out = "";
  child.stdout?.on("data", (b) => {
    if (out.length < 65536) out += b;
  });
  child.stderr?.on("data", (b) => {
    if (out.length < 65536) out += b;
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill(), 120000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`子命令失败 (${code})：${out}`));
    });
    if (options.input) child.stdin.end(options.input);
  });
}
async function startServer() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, DATA_DIR: target };
  delete env.SESSION_SECRET;
  delete env.RESTORE_CONTROL_TOKEN;
  server = spawn(
    process.execPath,
    [
      path.join(folder, "node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: folder, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  server.stdout.on("data", (b) => {
    if (logs.length < 10000) logs += b;
  });
  server.stderr.on("data", (b) => {
    if (logs.length < 10000) logs += b;
  });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && server.exitCode === null) {
    try {
      if (
        (
          await fetch(base + "/api/v1/settings", {
            signal: AbortSignal.timeout(500),
          })
        ).status === 401
      )
        return;
    } catch {}
    await pause(150);
  }
  throw new Error("生产服务未启动：" + logs);
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const closed = new Promise((resolve) => server.once("close", resolve));
  server.kill();
  await closed;
}
async function call(p, body) {
  const form = body instanceof FormData;
  const response = await fetch(base + "/api/v1/" + p, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "X-Requested-With": "yanxiben",
      Cookie: cookie,
      ...(!form && body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  assert.equal(response.status, 200, data.error?.message);
  return { data: data.data, response };
}
try {
  for (const file of [
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "tsconfig.json",
  ])
    cpSync(file, path.join(folder, file));
  cpSync("runtime", path.join(folder, "runtime"), { recursive: true });
  cpSync(".next", path.join(folder, ".next"), {
    recursive: true,
    dereference: true,
    filter: (p) =>
      !["cache", "dev"].includes(
        path.relative(path.resolve(".next"), p).split(path.sep)[0],
      ),
  });
  console.log("Installing production dependencies only (offline cache)...");
  await command(
    [
      npmCli,
      "ci",
      "--omit=dev",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.equal(existsSync(path.join(folder, "node_modules/tsx")), false);
  assert.equal(existsSync(path.join(folder, "node_modules/esbuild")), false);
  const data = JSON.parse(
    readFileSync("tests/fixtures/backup-v1.json", "utf8"),
  );
  const bytes = strToU8(JSON.stringify(data));
  const manifest = {
    schemaVersion: 1,
    counts: Object.fromEntries(
      Object.entries(data)
        .filter(([k]) => k !== "profile")
        .map(([k, rows]) => [k, rows.length]),
    ),
    files: [
      {
        name: "data.json",
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ],
  };
  const archive = zipSync({
    "data.json": bytes,
    "manifest.json": strToU8(JSON.stringify(manifest)),
  });
  const file = path.join(folder, "fixture.zip");
  writeFileSync(file, archive);
  const password = "production-fixture-password-only";
  const workerResult = JSON.parse(
    await command(["runtime/restore-worker.mjs"], {
      env: { ...process.env, DATA_DIR: target },
      stdio: ["pipe", "pipe", "pipe"],
      input: JSON.stringify({
        file,
        username: "production-fixture",
        passwordHash: bcrypt.hashSync(password, 4),
      }),
    }),
  );
  assert.equal(workerResult.counts.entries, 1);
  await startServer();
  const login = await call("auth/login", {
    username: "production-fixture",
    password,
  });
  cookie = login.response.headers.get("set-cookie").split(";")[0];
  assert.equal((await call("entries")).data.total, 1);
  const form = new FormData();
  form.set("password", password);
  form.set(
    "file",
    new Blob([archive], { type: "application/zip" }),
    "fixture.zip",
  );
  const preview = await call("data/restore-preview", form);
  workspaceId = preview.data.id;
  assert.equal(preview.data.counts.entries, 1);
  assert.deepEqual(readdirSync(path.join(target, "upload-tmp")), []);
  occupiedPort = createServer();
  await new Promise((resolve) => {
    occupiedPort.once("error", () => resolve());
    occupiedPort.listen(3200, "127.0.0.1", resolve);
  });
  const started = await call("data/restore-launch", {
    id: workspaceId,
    confirm: true,
  });
  childUrl = started.data.url;
  assert.match(childUrl, /^http:\/\/127\.0\.0\.1:32\d\d$/);
  assert.notEqual(childUrl, "http://127.0.0.1:3200");
  assert.equal((await fetch(childUrl + "/api/v1/settings")).status, 401);
  await assert.rejects(() =>
    call("data/restore-delete", { id: workspaceId, confirm: true }),
  );
  await stopServer();
  await startServer(); // The detached child survives; the new parent has no child-process map.
  const spaces = (await call("data/restore-workspaces")).data;
  assert.ok(spaces.some((r) => r.id === workspaceId && r.running));
  assert.equal(
    (await call("data/restore-launch", { id: workspaceId, confirm: true })).data
      .url,
    childUrl,
  );
  await call("data/restore-stop", { id: workspaceId });
  childUrl = "";
  await call("data/restore-delete", { id: workspaceId, confirm: true });
  assert.equal((await call("data/restore-workspaces")).data.length, 0);
  assert.equal((await call("entries")).data.total, 1);
  mkdirSync(path.join(source, "test-results"), { recursive: true });
  writeFileSync(
    path.join(source, "test-results/production-restore-acceptance.json"),
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        node: process.version,
        productionDependenciesOnly: true,
        tsxInstalled: false,
        esbuildInstalled: false,
        compiledWorker: "passed",
        preview: "passed",
        occupiedPort: "passed",
        launch: "passed",
        reconnectAfterParentRestart: "passed",
        stopAfterParentRestart: "passed",
        rejectDeleteWhileRunning: "passed",
        deleteStoppedWorkspace: "passed",
        originalEntriesUnchanged: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: production-only install, compiled restore, launch, parent restart, verified stop and cleanup.",
  );
} finally {
  if (childUrl && workspaceId) {
    try {
      const token = readFileSync(
        path.join(target, "restore-workspaces", workspaceId, "control-token"),
        "utf8",
      );
      await fetch(childUrl + "/api/v1/internal/restore-control", {
        method: "POST",
        headers: { "X-Requested-With": "yanxiben", "X-Restore-Control": token },
        signal: AbortSignal.timeout(2000),
      });
      await pause(500);
      childUrl = "";
    } catch {
      console.error("隔离子服务清理未确认；临时目录保留以便排查。");
    }
  }
  await stopServer();
  if (occupiedPort?.listening)
    await new Promise((resolve) => occupiedPort.close(resolve));
  const resolved = path.resolve(folder);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith("yanxi-prod-install-"));
  if (!childUrl)
    rmSync(resolved, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
}
