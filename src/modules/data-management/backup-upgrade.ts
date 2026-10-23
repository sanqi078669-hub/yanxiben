import { AppError } from "../entries/service";

export const BACKUP_FORMAT_VERSION = 2;

/** Versioned, explicit defaults only; unknown columns are rejected by row schemas. */
export function upgradeBackup(
  data: Record<string, any>,
  manifest: { schemaVersion: number; counts: Record<string, number> },
) {
  if (![1, BACKUP_FORMAT_VERSION].includes(manifest.schemaVersion))
    throw new AppError(400, "INVALID_BACKUP", "备份来自不支持的版本");
  if (manifest.schemaVersion === 1) {
    for (const table of [
      "knowledge_aliases",
      "knowledge_merges",
      "ai_audit",
      "ai_audit_extras",
    ]) {
      if (data[table] === undefined && manifest.counts[table] === undefined) {
        data[table] = [];
        manifest.counts[table] = 0;
      }
    }
    for (const k of Array.isArray(data.knowledge) ? data.knowledge : [])
      if (k && k.archived === undefined) k.archived = 0;
    for (const a of Array.isArray(data.ai_audit) ? data.ai_audit : [])
      if (a && a.feedback === undefined) a.feedback = "";
  }
  return data;
}
