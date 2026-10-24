import { existsSync, lstatSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export function migrationSnapshotPlan(
  directory: string,
  raw: unknown,
  now = Date.now(),
) {
  const options = z
    .object({
      keep: z.number().int().min(1).max(1000).default(3),
      days: z.number().int().min(0).max(36500).default(30),
    })
    .strict()
    .parse(raw);
  if (!existsSync(directory)) return { options, files: [] };
  if (lstatSync(directory).isSymbolicLink())
    throw new Error("快照目录不能是符号链接或 junction");
  const files = readdirSync(directory)
    .filter((name) => /^before-\d+-[a-f0-9-]{36}\.sqlite$/i.test(name))
    .flatMap((name) => {
      const info = lstatSync(path.join(directory, name));
      return info.isFile() && !info.isSymbolicLink()
        ? [{ name, created: Number(name.split("-")[1]), bytes: info.size }]
        : [];
    })
    .sort((a, b) => b.created - a.created || a.name.localeCompare(b.name));
  return {
    options,
    files: files.map((file, index) => ({
      ...file,
      remove:
        index >= options.keep && now - file.created > options.days * 86400000,
    })),
  };
}
export function pruneMigrationSnapshots(
  directory: string,
  options: unknown,
  apply = false,
  now = Date.now(),
) {
  const plan = migrationSnapshotPlan(directory, options, now);
  // Recompute at application time; never trust a previous caller-supplied file list.
  if (apply)
    for (const file of plan.files)
      if (file.remove) unlinkSync(path.join(directory, file.name));
  return {
    ...plan,
    applied: apply,
    removed: apply ? plan.files.filter((file) => file.remove).length : 0,
  };
}
