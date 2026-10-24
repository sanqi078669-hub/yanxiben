import { statSync, statfsSync } from "node:fs";
import path from "node:path";
import { db, one, dataDir } from "../../lib/db";
import { AppError } from "../entries/service";
const MiB = 1024 * 1024;
export function accountUsage(owner: string) {
  let bytes = Number(
    one("SELECT coalesce(sum(size),0) n FROM attachments WHERE owner=?", owner)!
      .n,
  );
  for (const { name } of db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()) {
    // Only schema-defined names; every user-scoped table counts, including history.
    const columns = db.prepare(`PRAGMA table_info("${name}")`).all();
    if (!columns.some((c) => c.name === "owner")) continue;
    const expression = columns.map((c) => `'${c.name}',"${c.name}"`).join(",");
    bytes += Number(
      one(
        `SELECT coalesce(sum(length(CAST(json_object(${expression}) AS BLOB))+1),0) n FROM "${name}" WHERE owner=?`,
        owner,
      )!.n,
    );
  }
  return { bytes, limit: 80 * MiB, warning: bytes >= 60 * MiB };
}
export function enforceQuota(owner: string, incoming = 0) {
  if (process.env.CAPACITY_POLICY !== "invited") return;
  const usage = accountUsage(owner);
  const files = ["", "-wal", "-shm"].reduce((sum, suffix) => {
    try {
      return (
        sum + statSync(path.join(dataDir, "yanxiben.sqlite" + suffix)).size
      );
    } catch {
      return sum;
    }
  }, 0);
  const total =
    files + Number(one("SELECT coalesce(sum(size),0) n FROM attachments")!.n);
  const disk = statfsSync(dataDir);
  if (
    usage.bytes + incoming + 2 * MiB > usage.limit ||
    total + incoming > 1024 * MiB ||
    disk.bavail * disk.bsize < 5 * 1024 * MiB
  )
    throw new AppError(
      413,
      "CAPACITY_LIMIT",
      "空间接近维护上限，请先导出并联系维护人；仍可读取和导出",
    );
}
/** Called under the business write transaction; no fixed headroom replaces the final total. */
export function enforceAccountQuota(owner: string, incoming = 0) {
  if (process.env.CAPACITY_POLICY !== "invited") return;
  const usage = accountUsage(owner);
  if (usage.bytes + incoming > usage.limit)
    throw new AppError(
      413,
      "CAPACITY_LIMIT",
      "账号数据超过容量上限，本次修改未提交；请导出并联系维护人",
    );
}
