import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { dataDir, one } from "../../lib/db";
import { AppError, assert } from "../entries/service";
import { checkBackupCapacity } from "./capacity";
import { cachedExport, reserveExport } from "./export-cache";

const running = new Set<string>();
export async function prepareExport(
  owner: string,
  type: "BACKUP" | "MARKDOWN",
  key: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
) {
  assert(
    key.length >= 8 && key.length <= 200,
    400,
    "IDEMPOTENCY_KEY_REQUIRED",
    "导出需要 8–200 字符的幂等键",
  );
  assert(!options.signal?.aborted, 499, "EXPORT_CANCELLED", "导出已取消");
  const previous = cachedExport(owner, type, key);
  if (previous) return previous;
  assert(
    !running.has(owner) && running.size < 2,
    429,
    "EXPORT_BUSY",
    "已有导出正在处理，请稍后使用原请求重试",
  );
  const worker = path.resolve("runtime/export-worker.mjs");
  assert(
    existsSync(worker),
    503,
    "EXPORT_UNAVAILABLE",
    "导出组件未构建，请先运行 npm run build",
  );
  const candidateId = randomUUID();
  const reservation = reserveExport(owner);
  running.add(owner);
  try {
    const fileId = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--max-old-space-size=512", worker],
        {
          env: { ...process.env, DATA_DIR: dataDir },
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let output = "",
        diagnostics = "",
        failure: AppError | undefined;
      const stop = (error: AppError) => {
        failure ??= error;
        child.kill();
      };
      const timer = setTimeout(
        () =>
          stop(
            new AppError(
              504,
              "EXPORT_TIMEOUT",
              "导出超时，请减少容量后使用原请求重试",
            ),
          ),
        options.timeoutMs ?? 120000,
      );
      const abort = () =>
        stop(new AppError(499, "EXPORT_CANCELLED", "导出已取消"));
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.length > 8192)
          stop(new AppError(503, "EXPORT_FAILED", "导出组件响应无效"));
      });
      child.stderr.on("data", (chunk) => {
        diagnostics = (diagnostics + chunk).slice(-8192);
      });
      child.stdin.on("error", () => {});
      child.once("error", () => {
        failure ??= new AppError(503, "EXPORT_UNAVAILABLE", "导出进程未能启动");
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        if (failure) {
          reject(failure);
          return;
        }
        try {
          const result = JSON.parse(output);
          if (result.error || code !== 0) {
            const known: Record<string, [number, string]> = {
              BACKUP_TOO_LARGE: [
                413,
                "备份超过可恢复容量（ZIP 200 MiB / 解压 500 MiB），请减少容量后重试",
              ],
              ATTACHMENT_TOO_LARGE: [
                413,
                "存在超过 10 MiB 的附件，请缩小或移除后重试",
              ],
              IDEMPOTENCY_CONFLICT: [409, "同一导出键不能用于不同类型"],
              EXPORT_CACHE_LIMIT: [
                507,
                "导出超过缓存剩余预算；已有导出仍可重放",
              ],
              EXPORT_DISK_LIMIT: [507, "导出磁盘预留空间不足，请联系维护人"],
              EXPORT_CONFIG_INVALID: [503, "导出缓存配置无效，请联系维护人"],
            };
            const errorCode = Object.hasOwn(known, result.error?.code)
              ? result.error.code
              : "EXPORT_FAILED";
            if (errorCode === "EXPORT_FAILED" && diagnostics)
              console.error("Export worker diagnostic:", diagnostics);
            const [status, message] = known[errorCode] || [
              503,
              "导出失败，请检查本地服务日志后使用原请求重试",
            ];
            reject(new AppError(status, errorCode, message));
          } else resolve(z.string().uuid().parse(result.fileId));
        } catch {
          reject(new AppError(503, "EXPORT_FAILED", "导出组件响应无效"));
        }
      });
      child.stdin.end(
        JSON.stringify({
          owner,
          type,
          key,
          candidateId,
          reservedBytes: reservation.bytes,
        }),
      );
    });
    const hash = createHash("sha256").update(key).digest("hex");
    assert(
      one(
        "SELECT file_id FROM export_receipts WHERE owner=? AND key_hash=? AND file_id=?",
        owner,
        hash,
        fileId,
      ),
      503,
      "EXPORT_FAILED",
      "导出回执无法核对",
    );
    const filename = path.join(dataDir, "export-cache", fileId + ".zip"),
      size = statSync(filename).size;
    checkBackupCapacity(0, size);
    return { filename, size };
  } finally {
    reservation.release();
    running.delete(owner);
    if (
      !one("SELECT file_id FROM export_receipts WHERE file_id=?", candidateId)
    )
      rmSync(path.join(dataDir, "export-cache", candidateId + ".zip"), {
        force: true,
      });
  }
}
