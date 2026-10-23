import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, openSync, closeSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dataDir, one, run, all } from "../../lib/db";
import { assert, AppError } from "../entries/service";
const runtimeState = globalThis as typeof globalThis & {
  yanxiRestoreChildren?: Map<string, ChildProcess>;
};
const children = (runtimeState.yanxiRestoreChildren ??= new Map<
  string,
  ChildProcess
>());
function init() {
  run(
    "CREATE TABLE IF NOT EXISTS restore_workspaces(id TEXT PRIMARY KEY,owner TEXT NOT NULL,folder TEXT NOT NULL,counts TEXT NOT NULL,created TEXT NOT NULL,url TEXT,pid INTEGER)",
  );
  if (
    !all("PRAGMA table_info(restore_workspaces)").some((c) => c.name === "pid")
  )
    run("ALTER TABLE restore_workspaces ADD COLUMN pid INTEGER");
  run(
    "CREATE TABLE IF NOT EXISTS backup_status(owner TEXT PRIMARY KEY,created TEXT NOT NULL)",
  );
}
export function backupStatus(owner: string) {
  init();
  return (
    one("SELECT created FROM backup_status WHERE owner=?", owner) || {
      created: null,
    }
  );
}
export function recordBackup(owner: string) {
  init();
  run(
    "INSERT OR REPLACE INTO backup_status VALUES(?,?)",
    owner,
    new Date().toISOString(),
  );
}
export async function previewRestore(owner: string, bytes: Uint8Array) {
  init();
  assert(
    bytes.length > 0 && bytes.length <= 200 * 1024 * 1024,
    413,
    "TOO_LARGE",
    "备份大小应为 1 字节至 200 MB",
  );
  const id = randomUUID(),
    folder = path.join(dataDir, "restore-workspaces", id);
  mkdirSync(folder, { recursive: true });
  const archive = path.join(folder, "source.zip"),
    target = path.join(folder, "data");
  writeFileSync(archive, bytes, { mode: 0o600 });
  const user = one("SELECT username,password FROM users WHERE id=?", owner)!;
  const counts = await new Promise<Record<string, number>>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          path.join(process.cwd(), "scripts", "restore-isolated.ts"),
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, DATA_DIR: target },
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let out = "";
      child.stdout.on("data", (b) => (out += b));
      child.stderr.on("data", () => {});
      child.on("error", () =>
        reject(
          new AppError(
            503,
            "RESTORE_UNAVAILABLE",
            "恢复进程未能启动，请检查本地运行环境",
          ),
        ),
      );
      child.on("close", (code) => {
        try {
          const result = JSON.parse(out);
          if (result.error) {
            reject(new AppError(400, "INVALID_BACKUP", result.error.message));
            return;
          }
          if (code !== 0) throw new Error();
          resolve(result.counts);
        } catch {
          reject(
            new AppError(
              503,
              "RESTORE_UNAVAILABLE",
              "恢复进程未能完成，请检查本地运行环境",
            ),
          );
        }
      });
      child.stdin.end(
        JSON.stringify({
          file: archive,
          username: user.username,
          passwordHash: user.password,
        }),
      );
    },
  );
  run(
    "INSERT INTO restore_workspaces VALUES(?,?,?,?,?,NULL,NULL)",
    id,
    owner,
    target,
    JSON.stringify(counts),
    new Date().toISOString(),
  );
  return { id, counts, folder: target, username: user.username };
}
async function freePort() {
  for (let port = 3200; port < 3300; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error("没有可用的隔离测试端口");
}
export async function launchRestore(owner: string, raw: unknown) {
  init();
  const b = z
    .object({ id: z.string().uuid(), confirm: z.literal(true) })
    .strict()
    .parse(raw);
  const row = one(
    "SELECT * FROM restore_workspaces WHERE id=? AND owner=?",
    b.id,
    owner,
  );
  assert(row, 404, "NOT_FOUND", "恢复预览不存在");
  if (row.url && children.get(b.id)?.exitCode === null)
    return { url: row.url, folder: row.folder };
  const port = await freePort(),
    url = `http://127.0.0.1:${port}`;
  const log = openSync(path.join(path.dirname(row.folder), "server.log"), "a");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATA_DIR: row.folder,
    SESSION_COOKIE_NAME: `yanxi_restore_${b.id.replaceAll("-", "")}`,
  };
  delete env.SESSION_SECRET;
  const child = spawn(
    process.execPath,
    [
      path.join(process.cwd(), "node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      env,
      windowsHide: true,
      detached: true,
      stdio: ["ignore", log, log],
    },
  );
  closeSync(log);
  let failed = false;
  child.on("error", () => {
    failed = true;
  });
  child.unref();
  children.set(b.id, child);
  for (let i = 0; i < 40; i++) {
    if (failed) break;
    try {
      await fetch(url + "/api/v1/auth/identity", {
        signal: AbortSignal.timeout(1000),
      });
      run(
        "UPDATE restore_workspaces SET url=?,pid=? WHERE id=? AND owner=?",
        url,
        child.pid!,
        b.id,
        owner,
      );
      return { url, folder: row.folder };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  child.kill();
  throw new Error(
    "隔离恢复服务未能启动，请检查生产构建和恢复目录内的 server.log",
  );
}
export function stopRestore(owner: string, raw: unknown) {
  init();
  const b = z.object({ id: z.string().uuid() }).strict().parse(raw),
    row = one(
      "SELECT * FROM restore_workspaces WHERE id=? AND owner=?",
      b.id,
      owner,
    );
  assert(row, 404, "NOT_FOUND", "恢复空间不存在");
  const child = children.get(b.id);
  assert(
    !row.pid || child,
    409,
    "SERVER_RESTARTED",
    "主服务已重启，请在系统进程管理中停止原隔离服务；恢复数据保留",
  );
  child?.kill();
  children.delete(b.id);
  run(
    "UPDATE restore_workspaces SET url=NULL,pid=NULL WHERE id=? AND owner=?",
    b.id,
    owner,
  );
  return true;
}
