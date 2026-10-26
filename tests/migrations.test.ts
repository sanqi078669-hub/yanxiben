import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { coreSchema } from "../src/lib/schema";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  DATABASE_VERSION,
  migrateDatabase,
  migrations,
} from "../src/lib/migrations";

test("v3 中间态升级至当前版本，原记录不变且只触发一次升级快照", () => {
  const fixture = JSON.parse(
    readFileSync("tests/fixtures/backup-v1.json", "utf8"),
  );
  const db = new DatabaseSync(":memory:");
  try {
    migrateDatabase(db, { steps: migrations.slice(0, 3) });
    db.prepare("INSERT INTO users (id, username, password, settings) VALUES(?,?,?,?)").run(
      fixture.profile.id,
      "v3-fixture",
      "hash",
      JSON.stringify(fixture.profile.settings),
    );
    for (const row of fixture.entries) {
      const keys = Object.keys(row);
      db.prepare(
        `INSERT INTO entries(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
      ).run(...(Object.values(row) as (string | number | null)[]));
    }
    const before = db.prepare("SELECT * FROM entries ORDER BY id").all();
    let snapshots = 0;
    const beforeUpgrade = () => {
      snapshots++;
      assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 3);
    };
    migrateDatabase(db, { beforeUpgrade });
    migrateDatabase(db, { beforeUpgrade });
    assert.equal(snapshots, 1);
    assert.equal(
      db.prepare("PRAGMA user_version").get()!.user_version,
      DATABASE_VERSION,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM entries ORDER BY id").all(),
      before,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM entry_search").get()!.n,
      before.length,
    );
    assert(
      db
        .prepare("SELECT document FROM entry_search WHERE entry_id=?")
        .get(fixture.entries[0].id),
    );
  } finally {
    db.close();
  }
});

test("新库统一初始化全部表；重复启动保持迁移记录不变", () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrateDatabase(db);
    const before = db
      .prepare("SELECT * FROM schema_migrations ORDER BY version")
      .all();
    assert.equal(before.length, DATABASE_VERSION);
    for (const table of [
      "knowledge_aliases",
      "knowledge_merges",
      "ai_audit",
      "ai_audit_extras",
      "ai_prices",
      "batch_edits",
      "restore_workspaces",
      "backup_status",
    ])
      assert.ok(
        db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table),
      );
    migrateDatabase(db);
    assert.deepEqual(
      db.prepare("SELECT * FROM schema_migrations ORDER BY version").all(),
      before,
    );
    assert.equal(
      db.prepare("PRAGMA user_version").get()!.user_version,
      DATABASE_VERSION,
    );
  } finally {
    db.close();
  }
});

test("识别无迁移表的 v1 库，保留数据并补齐已知旧字段", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      coreSchema.replace(
        "archived INTEGER NOT NULL DEFAULT 0",
        "legacy_archived INTEGER NOT NULL DEFAULT 0",
      ),
    );
    db.exec(
      "ALTER TABLE knowledge DROP COLUMN legacy_archived; PRAGMA user_version=1",
    );
    db.exec(
      "CREATE TABLE restore_workspaces(id TEXT PRIMARY KEY,owner TEXT NOT NULL,folder TEXT NOT NULL,counts TEXT NOT NULL,created TEXT NOT NULL,url TEXT)",
    );
    db.exec(
      "CREATE TABLE ai_audit(id TEXT PRIMARY KEY,owner TEXT NOT NULL,action TEXT NOT NULL,model TEXT NOT NULL,host TEXT NOT NULL,created_at TEXT NOT NULL,duration INTEGER NOT NULL,status TEXT NOT NULL,tokens INTEGER,result TEXT)",
    );
    db.exec(
      "INSERT INTO users (id, username, password, settings) VALUES('owner','user','hash','{}'); INSERT INTO knowledge VALUES('node','owner','高等数学',NULL,'极限',''); INSERT INTO restore_workspaces VALUES('work','owner','folder','{}','date',NULL)",
    );
    let backedUp = false;
    migrateDatabase(db, {
      beforeUpgrade: () => {
        backedUp = true;
      },
    });
    assert.ok(backedUp);
    assert.equal(
      db.prepare("SELECT archived FROM knowledge").get()!.archived,
      0,
    );
    assert.equal(
      db.prepare("SELECT pid FROM restore_workspaces").get()!.pid,
      null,
    );
    assert.ok(
      db
        .prepare("PRAGMA table_info(ai_audit)")
        .all()
        .some((c) => c.name === "feedback"),
    );
    assert.equal(
      db.prepare("SELECT username FROM users").get()!.username,
      "user",
    );
    migrateDatabase(db);
  } finally {
    db.close();
  }
});

test("未来版本与未知旧结构在更改前拒绝", () => {
  for (const sql of [
    "PRAGMA user_version=999",
    "CREATE TABLE unexpected(id TEXT)",
    coreSchema + "ALTER TABLE entries ADD COLUMN unknown TEXT",
    coreSchema + "DROP TABLE attachments",
  ]) {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(sql);
      const before = db
        .prepare("SELECT type,name,sql FROM sqlite_master ORDER BY name")
        .all();
      assert.throws(() => migrateDatabase(db), /数据库迁移失败/);
      assert.deepEqual(
        db
          .prepare("SELECT type,name,sql FROM sqlite_master ORDER BY name")
          .all(),
        before,
      );
    } finally {
      db.close();
    }
  }
});

test("失败步骤连同版本与记录回滚，已完成步骤可安全续跑", () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrateDatabase(db);
    const before = db
      .prepare("SELECT * FROM schema_migrations ORDER BY version")
      .all();
    assert.throws(
      () =>
        migrateDatabase(db, {
          steps: [
            ...migrations,
            {
              version: DATABASE_VERSION + 1,
              name: "failure-test",
              up: (db) => {
                db.exec("CREATE TABLE partial_work(id TEXT)");
                throw new Error("simulated failure");
              },
            },
          ],
        }),
      /simulated failure/,
    );
    assert.equal(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name='partial_work'")
        .get(),
      undefined,
    );
    assert.equal(
      db.prepare("PRAGMA user_version").get()!.user_version,
      DATABASE_VERSION,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM schema_migrations ORDER BY version").all(),
      before,
    );
    migrateDatabase(db);
  } finally {
    db.close();
  }
});

test("迁移记录缺口或名称漂移不会被静默重置", () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrateDatabase(db);
    db.exec("UPDATE schema_migrations SET name='unexpected' WHERE version=1");
    assert.throws(() => migrateDatabase(db), /迁移记录与版本不一致/);
  } finally {
    db.close();
  }
});

test("实际文件启动升级前生成可读取的数据库快照", () => {
  const folder = mkdtempSync(
    path.join(os.tmpdir(), "yanxi-migration-snapshot-"),
  );
  const old = new DatabaseSync(path.join(folder, "yanxiben.sqlite"));
  old.exec(
    coreSchema +
      "PRAGMA user_version=1; INSERT INTO users (id, username, password, settings) VALUES('owner','user','hash','{}')",
  );
  old.close();
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "import { db } from './src/lib/db.ts'; db.close();",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, DATA_DIR: folder },
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const files = readdirSync(path.join(folder, "migration-backups"));
  assert.equal(files.length, 1);
  const snapshot = new DatabaseSync(
    path.join(folder, "migration-backups", files[0]),
  );
  try {
    assert.equal(
      snapshot.prepare("PRAGMA user_version").get()!.user_version,
      1,
    );
    assert.equal(
      snapshot.prepare("SELECT username FROM users").get()!.username,
      "user",
    );
    assert.equal(
      snapshot
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='schema_migrations'",
        )
        .get(),
      undefined,
    );
  } finally {
    snapshot.close();
  }
});
