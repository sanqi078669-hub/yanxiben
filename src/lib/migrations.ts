import { DatabaseSync } from "node:sqlite";
import { coreSchema, extensionSchema } from "./schema";

export type Migration = {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
};
export const migrations: Migration[] = [
  { version: 1, name: "core-v1", up: (db) => db.exec(coreSchema) },
  {
    version: 2,
    name: "extensions-v2",
    up: (db) => {
      db.exec(extensionSchema);
      const cols = db.prepare("PRAGMA table_info(restore_workspaces)").all();
      if (!cols.some((c) => c.name === "pid"))
        db.exec("ALTER TABLE restore_workspaces ADD COLUMN pid INTEGER");
      // Early audit/knowledge tables may lack these explicitly supported defaults.
      if (
        !db
          .prepare("PRAGMA table_info(ai_audit)")
          .all()
          .some((c) => c.name === "feedback")
      )
        db.exec(
          "ALTER TABLE ai_audit ADD COLUMN feedback TEXT NOT NULL DEFAULT ''",
        );
      if (
        !db
          .prepare("PRAGMA table_info(knowledge)")
          .all()
          .some((c) => c.name === "archived")
      )
        db.exec(
          "ALTER TABLE knowledge ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
        );
    },
  },
  {
    version: 3,
    name: "review-hint-usage-v3",
    up: (db) =>
      db.exec(
        `CREATE TABLE entry_hint_usage(owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,review_version INTEGER NOT NULL,used_at TEXT NOT NULL,PRIMARY KEY(owner,entry_id,review_version))`,
      ),
  },
];
const current = migrations.at(-1)!.version;
export const DATABASE_VERSION = current;
const failure = (message: string): never => {
  throw new Error(`数据库迁移失败：${message}`);
};

/** Recognize pre-ledger databases before making any schema change. */
function validateLegacy(db: DatabaseSync) {
  const actual = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
    .map((r) => r.name as string);
  if (!actual.length) return;
  const expected = new DatabaseSync(":memory:");
  try {
    expected.exec(coreSchema + extensionSchema);
    const known = expected
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name as string);
    if (actual.some((name) => !known.includes(name)))
      failure("存在未知数据表，拒绝自动升级");
    const core = new DatabaseSync(":memory:");
    try {
      core.exec(coreSchema);
      for (const row of core
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all())
        if (!actual.includes(row.name as string))
          failure(`缺少基础表 ${row.name}`);
    } finally {
      core.close();
    }
    const optional = new Set([
      "restore_workspaces.pid",
      "ai_audit.feedback",
      "knowledge.archived",
    ]);
    for (const table of actual) {
      const oldCols = db.prepare(`PRAGMA table_info(${table})`).all();
      const targetCols = expected.prepare(`PRAGMA table_info(${table})`).all();
      if (
        oldCols.some(
          (c) =>
            !targetCols.some(
              (e) =>
                e.name === c.name &&
                e.type === c.type &&
                e.notnull === c.notnull &&
                e.pk === c.pk,
            ),
        ) ||
        targetCols.some(
          (c) =>
            !oldCols.some((e) => e.name === c.name) &&
            !optional.has(`${table}.${c.name}`),
        )
      )
        failure(`无法识别 ${table} 的字段结构`);
    }
  } finally {
    expected.close();
  }
}

/** Each migration and its ledger entry commit together. Unknown versions never reset. */
export function migrateDatabase(
  db: DatabaseSync,
  options: { steps?: Migration[]; beforeUpgrade?: () => void } = {},
) {
  const steps = options.steps || migrations;
  if (steps.some((step, i) => step.version !== i + 1))
    failure("迁移步骤必须连续且从 1 开始");
  const latest = steps.at(-1)?.version || 0;
  const userVersion = Number(
    db.prepare("PRAGMA user_version").get()!.user_version,
  );
  if (userVersion > latest) failure("数据库来自更新版本，请升级程序");
  const hasLedger = !!db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get();
  if (!hasLedger) validateLegacy(db);
  const applied = hasLedger
    ? db
        .prepare("SELECT version,name FROM schema_migrations ORDER BY version")
        .all()
    : [];
  if (
    applied.some((r, i) => r.version !== i + 1 || steps[i]?.name !== r.name) ||
    (hasLedger && userVersion !== applied.length)
  )
    failure("迁移记录与版本不一致");
  if (applied.length === latest) return;
  options.beforeUpgrade?.();
  // Serialize the recheck with concurrent starts, then commit one step at a time.
  for (const step of steps) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(
        "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)",
      );
      if (
        !db
          .prepare("SELECT version FROM schema_migrations WHERE version=?")
          .get(step.version)
      ) {
        step.up(db);
        db.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(
          step.version,
          step.name,
          new Date().toISOString(),
        );
        db.exec(`PRAGMA user_version=${step.version}`);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
