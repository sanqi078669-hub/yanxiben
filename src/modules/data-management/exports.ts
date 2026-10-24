import { createHash, randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  rmSync,
  openSync,
  closeSync,
} from "node:fs";
import { z } from "zod";
import { one, run, transaction } from "../../lib/db";
import { assert } from "../entries/service";
import { backup, markdownExport } from "./backup";
import { recordBackup } from "./restore-workspace";
import {
  EXPORT_TTL,
  exportFile,
  cachedExport,
  reserveExport,
  checkExportDisk,
} from "./export-cache";

export { EXPORT_TTL } from "./export-cache";
export function exportArtifact(
  owner: string,
  type: "BACKUP" | "MARKDOWN",
  key: string,
  now = Date.now(),
  candidateId: string = randomUUID(),
  reservedBytes?: number,
) {
  assert(
    key.length >= 8 && key.length <= 200,
    400,
    "IDEMPOTENCY_KEY_REQUIRED",
    "导出需要 8–200 字符的幂等键",
  );
  const hash = createHash("sha256").update(key).digest("hex");
  const lookup = () =>
    one(
      "SELECT * FROM export_receipts WHERE owner=? AND key_hash=? AND expires>?",
      owner,
      hash,
      now,
    );
  const previous = cachedExport(owner, type, key, now);
  if (previous) return previous;
  const id = z.string().uuid().parse(candidateId),
    filename = exportFile(id);
  const reservation =
    reservedBytes === undefined ? reserveExport(owner, now) : undefined;
  const ceiling = reservedBytes ?? reservation!.bytes;
  let written = false;
  try {
    const archive = type === "BACKUP" ? backup(owner) : markdownExport(owner);
    assert(
      archive.length <= ceiling,
      507,
      "EXPORT_CACHE_LIMIT",
      "导出超过缓存剩余预算；已有导出仍可重放",
    );
    checkExportDisk(archive.length);
    const descriptor = openSync(filename, "wx", 0o600);
    written = true;
    try {
      writeFileSync(descriptor, archive);
    } finally {
      closeSync(descriptor);
    }
    const picked = transaction(() => {
      const winner = lookup();
      if (winner) return winner;
      run(
        "INSERT INTO export_receipts VALUES(?,?,?,?,?)",
        owner,
        hash,
        type,
        id,
        now + EXPORT_TTL,
      );
      if (type === "BACKUP") recordBackup(owner);
      return { file_id: id, type };
    });
    if (picked.file_id !== id) {
      rmSync(filename, { force: true });
      return cachedExport(owner, type, key, now)!;
    }
    return { fileId: id, filename, size: archive.length };
  } catch (error) {
    if (written) rmSync(filename, { force: true });
    throw error;
  } finally {
    reservation?.release();
  }
}
export function exportArchive(
  owner: string,
  type: "BACKUP" | "MARKDOWN",
  key: string,
  now = Date.now(),
) {
  return readFileSync(exportArtifact(owner, type, key, now).filename);
}
