import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { migrateDatabase } from "./migrations";
import {
  privateDirectory,
  reservePrivateFile,
  inspectPrivateDirectory,
  warnPrivatePermissions,
} from "./private-files";
export const dataDir = path.resolve(
  /* turbopackIgnore: true */ process.env.DATA_DIR ||
    path.join(process.cwd(), "data"),
);
privateDirectory(dataDir);
privateDirectory(path.join(dataDir, "attachments"));
const databaseFile = path.join(dataDir, "yanxiben.sqlite");
reservePrivateFile(databaseFile);
for (const folder of [
  "attachments",
  "migration-backups",
  "restore-workspaces",
  "export-cache",
  "ai-private",
])
  inspectPrivateDirectory(
    path.join(/* turbopackIgnore: true */ dataDir, folder),
  );
for (const suffix of ["-wal", "-shm"])
  warnPrivatePermissions(databaseFile + suffix);
const globalDb = globalThis as unknown as { yanxiDb?: DatabaseSync };
export const db = (globalDb.yanxiDb ??= new DatabaseSync(
  path.join(dataDir, "yanxiben.sqlite"),
));
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000",
);
migrateDatabase(db, {
  beforeUpgrade: () => {
    if (
      !db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
        )
        .get()
    )
      return;
    const folder = path.join(dataDir, "migration-backups");
    privateDirectory(folder);
    const target = path.join(
      folder,
      "before-" + Date.now() + "-" + randomUUID() + ".sqlite",
    );
    reservePrivateFile(target);
    db.exec("VACUUM INTO '" + target.replaceAll("'", "''") + "'");
  },
});
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function one(sql: string, ...args: (string | number | null)[]) {
  return db.prepare(sql).get(...args) as Record<string, any> | undefined;
}
export function all(sql: string, ...args: (string | number | null)[]) {
  return db.prepare(sql).all(...args) as Record<string, any>[];
}
export function run(sql: string, ...args: (string | number | null)[]) {
  return db.prepare(sql).run(...args);
}
