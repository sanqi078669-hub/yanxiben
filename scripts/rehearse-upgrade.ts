import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { assertQaPath } from "./qa-path";

const index = process.argv.indexOf("--source-data");
assert(
  index >= 0 && process.argv[index + 1],
  "请指定 --source-data <已有数据目录>；仅演练副本",
);
const source = path.resolve(process.argv[index + 1]);
const folder = assertQaPath(
  path.join(process.cwd(), "test-results", "upgrade-rehearsal-" + randomUUID()),
);
const target = path.join(folder, "data");
mkdirSync(target, { recursive: true });
const original = new DatabaseSync(path.join(source, "yanxiben.sqlite"), {
  readOnly: true,
});
const version = (connection: DatabaseSync) =>
  Number(connection.prepare("PRAGMA user_version").get()!.user_version);
function digest(connection: DatabaseSync, tables?: string[]) {
  const names =
    tables ||
    connection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migrations' ORDER BY name",
      )
      .all()
      .map((row) => String(row.name));
  return Object.fromEntries(
    names.map((name) => {
      assert(/^[a-z_]+$/.test(name));
      const rows = connection
        .prepare(`SELECT * FROM "${name}" ORDER BY rowid`)
        .all();
      return [
        name,
        {
          count: rows.length,
          hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
        },
      ];
    }),
  );
}
const sourceVersion = version(original);
const before = digest(original);
// VACUUM INTO reads a consistent SQLite snapshot including committed WAL pages.
const snapshot = path.join(target, "yanxiben.sqlite");
original.exec("VACUUM INTO '" + snapshot.replaceAll("'", "''") + "'");
if (existsSync(path.join(source, "attachments")))
  cpSync(path.join(source, "attachments"), path.join(target, "attachments"), {
    recursive: true,
  });
process.env.DATA_DIR = target;
process.env.AI_KEY_FILE = path.join(folder, "unused-test-master.key");
delete process.env.SESSION_SECRET;
const { db, all, one } = await import("../src/lib/db");
const { DATABASE_VERSION } = await import("../src/lib/migrations");
const { entries, dashboard, reviewQueue } =
  await import("../src/modules/entries/service");
const { learningStatistics } = await import("../src/modules/review/statistics");
const { exportArchive } =
  await import("../src/modules/data-management/exports");
assert.equal(version(db), DATABASE_VERSION);
assert.deepEqual(
  digest(db, Object.keys(before)),
  before,
  "升级改变了既有表数据",
);
const users = all("SELECT id FROM users");
const checks = [];
for (const [i, user] of users.entries()) {
  const list = entries(user.id, new URLSearchParams());
  assert.equal(
    list.total,
    one(
      "SELECT count(*) n FROM entries WHERE owner=? AND deleted_at IS NULL",
      user.id,
    )!.n,
  );
  const entry = one(
    "SELECT title FROM entries WHERE owner=? AND deleted_at IS NULL AND title<>'' LIMIT 1",
    user.id,
  );
  if (entry)
    assert(
      entries(
        user.id,
        new URLSearchParams({ q: String(entry.title).slice(0, 8) }),
      ).total >= 1,
    );
  dashboard(user.id);
  reviewQueue(user.id);
  learningStatistics(user.id, { from: "2000-01-01", to: "2100-12-31" });
  const zip = exportArchive(user.id, "BACKUP", randomUUID());
  const filename = path.join(folder, `account-${i}.zip`);
  writeFileSync(filename, zip, { mode: 0o600 });
  const destination = path.join(folder, `restored-${i}`);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/data.ts", "restore", filename],
    {
      cwd: process.cwd(),
      windowsHide: true,
      encoding: "utf8",
      timeout: 120000,
      env: {
        ...process.env,
        DATA_DIR: destination,
        RESTORE_USERNAME: "rehearsal",
        RESTORE_PASSWORD: randomBytes(24).toString("hex"),
      },
    },
  );
  assert.equal(result.status, 0, "隔离导出恢复失败；私人正文不写入诊断输出");
  const restored = new DatabaseSync(path.join(destination, "yanxiben.sqlite"), {
    readOnly: true,
  });
  const counts: Record<string, number> = {};
  try {
    for (const name of [
      "entries",
      "attachments",
      "reviews",
      "logs",
      "revisions",
      "relations",
    ]) {
      const count = Number(
        restored.prepare(`SELECT count(*) n FROM ${name}`).get()!.n,
      );
      assert.equal(
        count,
        one(`SELECT count(*) n FROM ${name} WHERE owner=?`, user.id)!.n,
      );
      counts[name] = count;
    }
  } finally {
    restored.close();
  }
  checks.push({
    account: i + 1,
    listTotal: list.total,
    search: !!entry,
    restoredCounts: counts,
  });
}
const snapshots = readdirSync(path.join(target, "migration-backups"));
assert.equal(snapshots.length, 1);
assert.equal(version(original), sourceVersion);
assert.deepEqual(
  digest(original),
  before,
  "原库在演练期间发生变化，需要重新取得快照",
);
db.close();
original.close();
writeFileSync(
  path.join(folder, "acceptance.json"),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      sourceVersion,
      targetVersion: DATABASE_VERSION,
      existingTablesUnchanged: true,
      originalUnchanged: true,
      beforeUpgradeSnapshots: snapshots.length,
      checks,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    passed: true,
    sourceVersion,
    targetVersion: DATABASE_VERSION,
    accounts: checks.length,
    report: path.join(folder, "acceptance.json"),
  }),
);
