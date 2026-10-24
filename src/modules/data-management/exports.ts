import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { all, one, run, transaction, dataDir } from "../../lib/db";
import { assert } from "../entries/service";
import { backup, markdownExport } from "./backup";
import { recordBackup } from "./restore-workspace";
import { checkCachedArchiveCapacity } from "./capacity";
import { privateDirectory } from "../../lib/private-files";

export const EXPORT_TTL = 7 * 86400000;
export function exportArtifact(
  owner: string,
  type: "BACKUP" | "MARKDOWN",
  key: string,
  now = Date.now(),
  candidateId: string = randomUUID(),
) {
  assert(
    key.length >= 8 && key.length <= 200,
    400,
    "IDEMPOTENCY_KEY_REQUIRED",
    "导出需要 8–200 字符的幂等键",
  );
  const hash = createHash("sha256").update(key).digest("hex");
  const directory = path.join(dataDir, "export-cache");
  privateDirectory(directory);
  const file = (id: string) =>
    path.join(directory, z.string().uuid().parse(id) + ".zip");
  const lookup = () =>
    one(
      "SELECT * FROM export_receipts WHERE owner=? AND key_hash=? AND expires>?",
      owner,
      hash,
      now,
    );
  const replay = (row: Record<string, any>) => {
    assert(
      row.type === type,
      409,
      "IDEMPOTENCY_CONFLICT",
      "同一导出键不能用于不同类型",
    );
    const bytes = readFileSync(file(row.file_id));
    checkCachedArchiveCapacity(bytes);
    return {
      fileId: String(row.file_id),
      filename: file(row.file_id),
      size: bytes.length,
    };
  };
  // Expired ZIPs and receipts are removed on the next export; credentials are never cached.
  transaction(() => {
    for (const row of all(
      "SELECT file_id FROM export_receipts WHERE expires<=?",
      now,
    ))
      rmSync(file(row.file_id), { force: true });
    run("DELETE FROM export_receipts WHERE expires<=?", now);
  });
  const previous = lookup();
  if (previous) return replay(previous);
  // Each generator owns its snapshot transaction. Recheck under the write lock
  // so concurrent processes return the first committed artifact and timestamp.
  const archive = type === "BACKUP" ? backup(owner) : markdownExport(owner);
  const id = z.string().uuid().parse(candidateId),
    filename = file(id);
  try {
    writeFileSync(filename, archive, { flag: "wx", mode: 0o600 });
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
      return replay(picked);
    }
    return { fileId: id, filename, size: archive.length };
  } catch (error) {
    rmSync(filename, { force: true });
    throw error;
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
