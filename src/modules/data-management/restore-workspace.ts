import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { dataDir, one, run, all } from "../../lib/db";
import { assert, AppError } from "../entries/service";
import type { DiskUpload } from "../http/body";
import { BACKUP_ZIP_MAX_BYTES } from "../../lib/capacity";
import { privateDirectory } from "../../lib/private-files";

const state = globalThis as typeof globalThis & {
  yanxiRestoreChildren?: Map<string, ChildProcess>;
  yanxiRestoreLaunching?: Map<string, Promise<{ url: string; folder: string }>>;
};
const children = (state.yanxiRestoreChildren ??= new Map());
const launching = (state.yanxiRestoreLaunching ??= new Map());
const root = path.resolve(dataDir, "restore-workspaces");
const requestSchema = z.object({ id: z.string().uuid() }).strict();
function folderFor(id: string) {
  z.string().uuid().parse(id);
  const folder = path.resolve(root, id);
  assert(
    path.dirname(folder) === root,
    400,
    "INVALID_WORKSPACE",
    "恢复目录越界",
  );
  return folder;
}
function removeFiles(folder: string) {
  const target = path.resolve(folder);
  assert(
    path.dirname(target) === root &&
      z.string().uuid().safeParse(path.basename(target)).success,
    400,
    "INVALID_WORKSPACE",
    "拒绝清理未知目录",
  );
  rmSync(target, { recursive: true, force: true });
}
function workspace(owner: string, id: string) {
  const row = one(
    "SELECT * FROM restore_workspaces WHERE id=? AND owner=?",
    id,
    owner,
  );
  assert(row, 404, "NOT_FOUND", "恢复空间不存在");
  assert(
    path.resolve(row.folder) === path.join(folderFor(id), "data"),
    409,
    "INVALID_WORKSPACE",
    "恢复目录与记录不一致",
  );
  return row;
}
function alive(pid: number | null) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
function tokenFor(id: string) {
  try {
    return readFileSync(path.join(folderFor(id), "control-token"), "utf8");
  } catch {
    return "";
  }
}
async function control(row: Record<string, any>, method = "GET") {
  assert(
    /^http:\/\/127\.0\.0\.1:32\d\d$/.test(row.url || ""),
    409,
    "INVALID_WORKSPACE",
    "隔离服务地址无效",
  );
  const token = tokenFor(row.id);
  assert(
    /^[a-f0-9]{64}$/.test(token),
    409,
    "UNKNOWN_RESTORE_PROCESS",
    "无法验证隔离进程身份，未停止任何未知进程",
  );
  const response = await fetch(row.url + "/api/v1/internal/restore-control", {
    method,
    headers: { "X-Requested-With": "yanxiben", "X-Restore-Control": token },
    signal: AbortSignal.timeout(1000),
    redirect: "error",
  });
  const result = await response.json();
  assert(
    response.ok && result.data?.pid === row.pid,
    409,
    "UNKNOWN_RESTORE_PROCESS",
    "隔离进程身份不匹配",
  );
  return result.data;
}
/** Available only in an isolated child with a private control token. No user data returned. */
export function restoreControl(method: string, supplied: string | null) {
  const expected = process.env.RESTORE_CONTROL_TOKEN || "";
  assert(
    expected.length === 64 &&
      typeof supplied === "string" &&
      /^[a-f0-9]{64}$/.test(supplied) &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)),
    404,
    "NOT_FOUND",
    "接口不存在",
  );
  assert(
    method === "GET" || method === "POST",
    405,
    "METHOD_NOT_ALLOWED",
    "方法不支持",
  );
  if (method === "POST") setTimeout(() => process.exit(0), 100).unref();
  return { pid: process.pid };
}
export function backupStatus(owner: string) {
  return (
    one("SELECT created FROM backup_status WHERE owner=?", owner) || {
      created: null,
    }
  );
}
export function recordBackup(owner: string) {
  run(
    "INSERT OR REPLACE INTO backup_status VALUES(?,?)",
    owner,
    new Date().toISOString(),
  );
}
export function restoreWorkspaces(owner: string) {
  return all(
    "SELECT * FROM restore_workspaces WHERE owner=? ORDER BY created DESC",
    owner,
  ).map((row) => ({
    id: row.id as string,
    created: row.created as string,
    counts: JSON.parse(row.counts) as Record<string, number>,
    url: row.url as string | null,
    running: alive(row.pid),
  }));
}
export function deleteRestore(owner: string, raw: unknown) {
  const { id } = requestSchema.parse(raw),
    row = workspace(owner, id);
  assert(
    !launching.has(id) && !alive(row.pid),
    409,
    "RESTORE_RUNNING",
    "请先停止隔离服务再删除工作区",
  );
  removeFiles(folderFor(id));
  run("DELETE FROM restore_workspaces WHERE id=? AND owner=?", id, owner);
  children.delete(id);
  return true;
}
export function cleanupRestoreWorkspaces(owner: string, now = Date.now()) {
  let removed = 0;
  for (const row of all(
    "SELECT id,created,pid FROM restore_workspaces WHERE owner=?",
    owner,
  )) {
    if (
      Date.parse(row.created) < now - 7 * 86400000 &&
      !alive(row.pid) &&
      !launching.has(row.id) &&
      !existsSync(path.join(folderFor(row.id), "control-token"))
    ) {
      deleteRestore(owner, { id: row.id });
      removed++;
    }
  }
  return removed;
}
export async function previewRestore(
  owner: string,
  bytes: Uint8Array | DiskUpload,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
) {
  const size = bytes instanceof Uint8Array ? bytes.length : bytes.size;
  assert(
    size > 0 && size <= BACKUP_ZIP_MAX_BYTES,
    413,
    "TOO_LARGE",
    "备份大小应为 1 字节至 200 MB",
  );
  assert(!options.signal?.aborted, 499, "RESTORE_CANCELLED", "恢复校验已取消");
  const worker = path.resolve("runtime/restore-worker.mjs");
  assert(
    existsSync(worker),
    503,
    "RESTORE_UNAVAILABLE",
    "恢复组件未构建，请先运行 npm run build",
  );
  const user = one("SELECT username,password FROM users WHERE id=?", owner);
  assert(user, 404, "NOT_FOUND", "账号不存在");
  cleanupRestoreWorkspaces(owner);
  const id = randomUUID(),
    folder = folderFor(id),
    archive = path.join(folder, "source.zip"),
    target = path.join(folder, "data");
  privateDirectory(path.dirname(folder));
  privateDirectory(folder);
  try {
    if (bytes instanceof Uint8Array)
      writeFileSync(archive, bytes, { mode: 0o600, flag: "wx" });
    else await bytes.moveTo(archive);
    const counts = await new Promise<Record<string, number>>(
      (resolve, reject) => {
        const child = spawn(process.execPath, [worker], {
          cwd: process.cwd(),
          env: { ...process.env, DATA_DIR: target },
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let out = "",
          failure: AppError | null = null;
        const fail = (error: AppError) => {
          failure ??= error;
          child.kill();
        };
        const timer = setTimeout(
          () =>
            fail(
              new AppError(
                504,
                "RESTORE_TIMEOUT",
                "恢复校验超时，临时空间将清理，可以重试",
              ),
            ),
          options.timeoutMs ?? 120000,
        );
        const abort = () =>
          fail(new AppError(499, "RESTORE_CANCELLED", "恢复校验已取消"));
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
        child.stdout.on("data", (b) => {
          if (out.length + b.length > 65536)
            fail(new AppError(503, "RESTORE_UNAVAILABLE", "恢复组件响应过大"));
          else out += b;
        });
        child.stderr.on("data", () => {});
        child.stdin.on("error", () => {});
        child.on("error", () => {
          failure ??= new AppError(
            503,
            "RESTORE_UNAVAILABLE",
            "恢复进程未能启动",
          );
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
          if (failure) {
            reject(failure);
            return;
          }
          try {
            const result = JSON.parse(out);
            if (result.error) {
              reject(new AppError(400, "INVALID_BACKUP", result.error.message));
              return;
            }
            if (code !== 0 || !result.counts) throw new Error();
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
  } catch (error) {
    removeFiles(folder);
    throw error;
  }
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
  throw new AppError(503, "RESTORE_UNAVAILABLE", "没有可用的隔离测试端口");
}
export async function launchRestore(owner: string, raw: unknown) {
  const { id } = requestSchema.extend({ confirm: z.literal(true) }).parse(raw);
  const row = workspace(owner, id);
  if (launching.has(id)) return launching.get(id)!;
  const promise = startRestore(owner, row);
  launching.set(id, promise);
  try {
    return await promise;
  } finally {
    launching.delete(id);
  }
}
async function startRestore(owner: string, row: Record<string, any>) {
  const id = row.id as string;
  if (row.pid && alive(row.pid)) {
    try {
      await control(row);
      return { url: row.url as string, folder: row.folder as string };
    } catch {
      throw new AppError(
        409,
        "UNKNOWN_RESTORE_PROCESS",
        "现有隔离进程无法验证，请先停止或检查该空间",
      );
    }
  }
  const runtimeRequire = createRequire(
    path.join(process.cwd(), "package.json"),
  );
  const cli = runtimeRequire.resolve(
    /* turbopackIgnore: true */ "next/dist/bin/next",
  );
  for (let retry = 0; retry < 3; retry++) {
    const port = await freePort(),
      url = `http://127.0.0.1:${port}`,
      token = randomBytes(32).toString("hex");
    writeFileSync(path.join(folderFor(id), "control-token"), token, {
      mode: 0o600,
    });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATA_DIR: row.folder,
      SESSION_COOKIE_NAME: `yanxi_restore_${id.replaceAll("-", "")}`,
      RESTORE_CONTROL_TOKEN: token,
    };
    delete env.SESSION_SECRET;
    // Next output is discarded; keep bounded startup diagnostics, not an unbounded log.
    const child = spawn(
      process.execPath,
      [cli, "start", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: process.cwd(),
        env,
        windowsHide: true,
        detached: true,
        stdio: "ignore",
      },
    );
    let failed = false;
    child.on("error", () => {
      failed = true;
    });
    child.unref();
    children.set(id, child);
    const live = { ...row, url, pid: child.pid };
    run(
      "UPDATE restore_workspaces SET url=?,pid=? WHERE id=? AND owner=?",
      url,
      child.pid ?? null,
      id,
      owner,
    );
    writeFileSync(
      path.join(folderFor(id), "server.log"),
      JSON.stringify({
        started: new Date().toISOString(),
        pid: child.pid,
        port,
        attempt: retry + 1,
      }),
      { mode: 0o600 },
    );
    const deadline = Date.now() + 15000;
    while (!failed && child.exitCode === null && Date.now() < deadline) {
      try {
        await control(live);
        return { url, folder: row.folder as string };
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    child.kill();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || failed) resolve();
      else child.once("close", () => resolve());
    });
    children.delete(id);
    run(
      "UPDATE restore_workspaces SET url=NULL,pid=NULL WHERE id=? AND owner=?",
      id,
      owner,
    );
  }
  throw new AppError(
    503,
    "RESTORE_UNAVAILABLE",
    "隔离服务未能启动，请确认生产构建存在；原数据保留",
  );
}
export async function stopRestore(owner: string, raw: unknown) {
  const { id } = requestSchema.parse(raw),
    row = workspace(owner, id);
  assert(
    !launching.has(id),
    409,
    "RESTORE_STARTING",
    "隔离服务正在启动，请稍后停止",
  );
  if (alive(row.pid)) {
    try {
      await control(row); // Prove ownership with the private token, never trust a stored PID alone.
      await control(row, "POST");
      const deadline = Date.now() + 5000;
      while (alive(row.pid) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 100));
      assert(
        !alive(row.pid),
        503,
        "RESTORE_STOP_TIMEOUT",
        "隔离进程尚未退出，请稍后重试",
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        409,
        "UNKNOWN_RESTORE_PROCESS",
        "无法确认隔离进程身份，未停止任何未知进程",
      );
    }
  }
  children.delete(id);
  run(
    "UPDATE restore_workspaces SET url=NULL,pid=NULL WHERE id=? AND owner=?",
    id,
    owner,
  );
  return true;
}
