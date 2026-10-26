import { createHash, randomUUID } from "node:crypto";
import {
  readdirSync,
  statSync,
  statfsSync,
  rmSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { all, one, run, transaction, dataDir } from "../../lib/db";
import { privateDirectory } from "../../lib/private-files";
import { assert } from "../entries/service";
import { checkCachedArchiveCapacity } from "./capacity";

export const EXPORT_TTL = 7 * 86400000;
const directory = path.join(dataDir, "export-cache");
export const exportFile = (id: string) => {
  assert(/^[0-9a-f-]{36}$/i.test(id), 503, "EXPORT_FAILED", "导出文件标识无效");
  return path.join(directory, id + ".zip");
};
function setting(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  assert(
    Number.isSafeInteger(value) && value > 0,
    503,
    "EXPORT_CONFIG_INVALID",
    "导出缓存配置必须是正整数：" + name,
  );
  return value;
}
export function exportCachePolicy() {
  return {
    accountBytes: setting("EXPORT_CACHE_ACCOUNT_BYTES", 256 * 1024 * 1024),
    instanceBytes: setting("EXPORT_CACHE_INSTANCE_BYTES", 1792 * 1024 * 1024),
    accountFiles: setting("EXPORT_CACHE_ACCOUNT_FILES", 12),
    instanceFiles: setting("EXPORT_CACHE_INSTANCE_FILES", 84),
    rateCount: setting("EXPORT_CACHE_RATE_COUNT", 3),
    rateWindowMs: setting("EXPORT_CACHE_RATE_WINDOW_MS", 300000),
    minFreeBytes: setting(
      "EXPORT_CACHE_MIN_FREE_BYTES",
      5 * 1024 * 1024 * 1024,
    ),
    cleanupMs: setting("EXPORT_CACHE_CLEANUP_MS", 60000),
  };
}
type Reservation = { owner: string; bytes: number };
// The application process owns admission; workers receive only a byte ceiling.
// Share state across Next server bundles and development module reloads.
const globalCache = globalThis as unknown as {
  yanxiExportCache?: {
    reservations: Map<string, Reservation>;
    attempts: Map<string, number[]>;
    timer?: ReturnType<typeof setInterval>;
  };
};
const state: NonNullable<typeof globalCache.yanxiExportCache> =
  (globalCache.yanxiExportCache ??= {
    reservations: new Map(),
    attempts: new Map(),
  });
export function cachedExport(
  owner: string,
  type: string,
  key: string,
  now = Date.now(),
) {
  const row = one(
    "SELECT * FROM export_receipts WHERE owner=? AND key_hash=? AND expires>?",
    owner,
    createHash("sha256").update(key).digest("hex"),
    now,
  );
  if (!row) return;
  assert(
    row.type === type,
    409,
    "IDEMPOTENCY_CONFLICT",
    "同一导出键不能用于不同类型",
  );
  const filename = exportFile(row.file_id);
  let bytes: Buffer;
  try {
    bytes = readFileSync(/* turbopackIgnore: true */ filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    run(
      "DELETE FROM export_receipts WHERE owner=? AND key_hash=? AND file_id=?",
      owner,
      row.key_hash,
      row.file_id,
    );
    return;
  }
  checkCachedArchiveCapacity(bytes);
  return { fileId: String(row.file_id), filename, size: bytes.length };
}
export function cleanupExportCache(now = Date.now()) {
  privateDirectory(directory);
  // Commit each removal separately: a later filesystem failure cannot restore
  // receipts for files already deleted. Failed files remain counted and retryable.
  let failed = false;
  for (const row of all(
    "SELECT file_id FROM export_receipts WHERE expires<=?",
    now,
  )) {
    try {
      transaction(() => {
        rmSync(exportFile(row.file_id), { force: true });
        run(
          "DELETE FROM export_receipts WHERE file_id=? AND expires<=?",
          row.file_id,
          now,
        );
      });
    } catch {
      failed = true;
    }
  }
  {
    const retained = new Set(
      all("SELECT file_id FROM export_receipts").map(
        (row) => row.file_id + ".zip",
      ),
    );
    // A crashed generator may leave an unreceipted ZIP. Never touch a recent worker file.
    for (const name of readdirSync(/* turbopackIgnore: true */ directory))
      if (
        /^[0-9a-f-]{36}\.zip$/i.test(name) &&
        !retained.has(name) &&
        statSync(/* turbopackIgnore: true */ path.join(directory, name))
          .mtimeMs +
          EXPORT_TTL <=
          now
      )
        try {
          rmSync(path.join(directory, name), { force: true });
        } catch {
          failed = true;
        }
  }
  if (failed)
    console.error(
      "Some export cache files could not be removed; retrying next interval",
    );
  const window = exportCachePolicy().rateWindowMs;
  for (const [owner, attempts] of state.attempts) {
    const recent = attempts.filter((time) => time > now - window);
    if (recent.length) state.attempts.set(owner, recent);
    else state.attempts.delete(owner);
  }
}
export function startExportCacheCleanup() {
  if (state.timer) return;
  const clean = () => {
    try {
      cleanupExportCache();
    } catch {
      console.error(
        "Export cache cleanup failed; retrying on the next interval",
      );
    }
  };
  const interval = exportCachePolicy().cleanupMs;
  clean();
  state.timer = setInterval(clean, interval);
  state.timer.unref();
}
export function checkExportDisk(bytes: number) {
  const disk = statfsSync(/* turbopackIgnore: true */ dataDir),
    free = disk.bavail * disk.bsize;
  assert(
    free >= bytes + exportCachePolicy().minFreeBytes,
    507,
    "EXPORT_DISK_LIMIT",
    "导出磁盘预留空间不足，请联系维护人",
  );
}
export function reserveExport(owner: string, now = Date.now()) {
  cleanupExportCache(now);
  const policy = exportCachePolicy();
  let instanceBytes = 0,
    instanceFiles = 0,
    accountBytes = 0,
    accountFiles = 0;
  const owned = new Set(
    all("SELECT file_id FROM export_receipts WHERE owner=?", owner).map(
      (row) => row.file_id + ".zip",
    ),
  );
  for (const name of readdirSync(/* turbopackIgnore: true */ directory)) {
    if (!/^[0-9a-f-]{36}\.zip$/i.test(name)) continue;
    const size = statSync(
      /* turbopackIgnore: true */ path.join(directory, name),
    ).size;
    instanceBytes += size;
    instanceFiles++;
    if (owned.has(name)) {
      accountBytes += size;
      accountFiles++;
    }
  }
  for (const reservation of state.reservations.values()) {
    instanceBytes += reservation.bytes;
    instanceFiles++;
    if (reservation.owner === owner) {
      accountBytes += reservation.bytes;
      accountFiles++;
    }
  }
  const bytes = Math.min(
    policy.accountBytes - accountBytes,
    policy.instanceBytes - instanceBytes,
  );
  assert(
    bytes > 0 &&
      accountFiles < policy.accountFiles &&
      instanceFiles < policy.instanceFiles,
    507,
    "EXPORT_CACHE_LIMIT",
    "导出缓存预算不足，请等待过期清理或联系维护人；已有导出仍可重放",
  );
  const recent = (state.attempts.get(owner) || []).filter(
    (time) => time > now - policy.rateWindowMs,
  );
  assert(
    recent.length < policy.rateCount,
    429,
    "EXPORT_RATE_LIMITED",
    "新导出过于频繁，请稍后重试；已有导出仍可重放",
  );
  checkExportDisk(
    bytes +
      [...state.reservations.values()].reduce(
        (sum, item) => sum + item.bytes,
        0,
      ),
  );
  const id = randomUUID();
  state.reservations.set(id, { owner, bytes });
  state.attempts.set(owner, [...recent, now]);
  return {
    bytes,
    release: () => {
      state.reservations.delete(id);
    },
  };
}
