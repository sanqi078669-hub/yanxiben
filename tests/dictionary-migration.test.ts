import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  migrateDatabase as migrateCurrentDatabase,
  migrations,
} from "../src/lib/migrations";
import { normalize } from "../src/modules/dictionaries/normalize";
import type { ApiContext } from "../src/modules/http/context";

const temporaryDataDir = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-dictionary-"),
);
process.env.DATA_DIR = temporaryDataDir;
let databaseIndex = 0;
// Keep v12 assertions pinned as later migrations legitimately change labels.
function migrateDatabase(
  db: DatabaseSync,
  options: Parameters<typeof migrateCurrentDatabase>[1] = {},
) {
  return migrateCurrentDatabase(db, {
    ...options,
    steps: options.steps ?? migrations.filter((step) => step.version <= 12),
  });
}

function fixture() {
  const db = new DatabaseSync(
    path.join(temporaryDataDir, `migration-${databaseIndex++}.sqlite`),
  );
  db.exec("PRAGMA foreign_keys=ON");
  migrateDatabase(db, {
    steps: migrations.filter((step) => step.version <= 11),
  });
  for (const owner of ["owner-a", "owner-b"])
    db.prepare(
      "INSERT INTO users(id,username,password,settings) VALUES(?,?,?,?)",
    ).run(owner, owner, "hash", "{}");
  return db;
}

function entry(
  db: DatabaseSync,
  id = "entry",
  owner = "owner-a",
  payload = { type: "MATH", subject: "高等数学", errors: ["计算"] },
  deleted = false,
) {
  db.prepare("INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
    id,
    owner,
    payload.type,
    id,
    payload.subject,
    "INBOX",
    "body",
    JSON.stringify(payload),
    1,
    "2026-10-26T00:00:00Z",
    "2026-10-26T00:00:00Z",
    deleted ? "2026-10-26T00:00:00Z" : null,
  );
}

function rows(db: DatabaseSync, owner = "owner-a") {
  return db
    .prepare(
      "SELECT kind,value,label,normalized_name,template,archived,sort_order,version FROM dictionary_items WHERE owner=? ORDER BY kind,sort_order,value",
    )
    .all(owner);
}

test.after(async () => {
  // The service test opens the normal singleton only inside temporary DATA_DIR.
  const { db } = await import("../src/lib/db");
  db.close();
  rmSync(temporaryDataDir, { recursive: true, force: true });
});

test("NFKC、trim 和连续空白折叠", () => {
  assert.equal(normalize("　Ａ\t \nＢ　"), "A B");
});

test("空库与新账号不产生字典行，迁移重复执行安全", () => {
  const db = fixture();
  try {
    migrateDatabase(db);
    assert.equal(
      db.prepare("SELECT count(*) n FROM dictionary_items").get()!.n,
      0,
    );
    const ledger = db.prepare("SELECT * FROM schema_migrations").all();
    migrateDatabase(db);
    assert.deepEqual(
      db.prepare("SELECT * FROM schema_migrations").all(),
      ledger,
    );
    db.prepare(
      "INSERT INTO users(id,username,password,settings) VALUES('new','new','hash','{}')",
    ).run();
    assert.deepEqual(rows(db, "new"), []);
  } finally {
    db.close();
  }
});

test("一条活跃 entry 回填三类，模板和初始 label 正确", () => {
  const db = fixture();
  try {
    entry(db);
    migrateDatabase(db);
    const actual = rows(db);
    assert.equal(actual.length, 3);
    assert.deepEqual(
      actual.map((row) => [row.kind, row.value, row.archived]),
      [
        ["ERROR", "计算", 0],
        ["SUBJECT", "高等数学", 0],
        ["TYPE", "MATH", 0],
      ],
    );
    assert.ok(
      actual.every((row) => row.label === row.value && row.version === 1),
    );
    assert.equal(actual.find((row) => row.kind === "TYPE")!.template, "MATH");
    const before = rows(db);
    migrateDatabase(db);
    assert.deepEqual(rows(db), before);
  } finally {
    db.close();
  }
});

test("回收站、修订、两种日志错因只作为归档历史回填", () => {
  const db = fixture();
  try {
    entry(
      db,
      "deleted",
      "owner-a",
      {
        type: "OLD",
        subject: "旧科目",
        errors: ["旧错因"],
      },
      true,
    );
    db.prepare("INSERT INTO revisions VALUES(?,?,?,?,?,?,?)").run(
      "revision",
      "owner-a",
      "deleted",
      1,
      JSON.stringify({
        type: "REVISION",
        subject: "修订科目",
        errors: ["修订错因"],
      }),
      "manual",
      "2026-10-26T00:00:00Z",
    );
    db.prepare("INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?)").run(
      "review",
      "owner-a",
      "deleted",
      "NEW",
      -1,
      0,
      "2026-10-26",
      1,
    );
    db.prepare("INSERT INTO logs VALUES(?,?,?,?,?,?,?,?)").run(
      "log",
      "owner-a",
      "review",
      "PRACTICE",
      "GOOD",
      "2026-10-26",
      JSON.stringify({
        errorCauses: ["本次历史错因"],
        errorSnapshot: ["题目历史错因"],
      }),
      "2026-10-26T00:00:00Z",
    );
    migrateDatabase(db);
    const actual = rows(db);
    assert.equal(actual.length, 8);
    assert.ok(actual.every((row) => row.archived === 1));
    assert.ok(actual.some((row) => row.value === "本次历史错因"));
    assert.ok(actual.some((row) => row.value === "题目历史错因"));
  } finally {
    db.close();
  }
});

test("知识点科目按节点归档状态回填", () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO knowledge VALUES(?,?,?,NULL,?,'',?)").run(
      "active-node",
      "owner-a",
      "活跃科目",
      "节点",
      0,
    );
    db.prepare("INSERT INTO knowledge VALUES(?,?,?,NULL,?,'',?)").run(
      "archived-node",
      "owner-a",
      "归档科目",
      "节点",
      1,
    );
    migrateDatabase(db);
    assert.deepEqual(
      rows(db).map((row) => [row.value, row.archived]),
      [
        ["归档科目", 1],
        ["活跃科目", 0],
      ],
    );
  } finally {
    db.close();
  }
});

test("规范化冲突保留全部行，活跃引用优先于字典序，其次字典序", () => {
  const db = fixture();
  try {
    entry(
      db,
      "history",
      "owner-a",
      { type: "MATH", subject: "高等数学", errors: [] },
      true,
    );
    entry(db, "active", "owner-a", {
      type: "MATH",
      subject: "高等数学 ",
      errors: ["Ａ", "A"],
    });
    migrateDatabase(db);
    const actual = rows(db);
    assert.deepEqual(
      actual
        .filter((row) => row.kind === "SUBJECT")
        .map((row) => [row.value, row.archived]),
      [
        ["高等数学", 1],
        ["高等数学 ", 0],
      ],
    );
    assert.deepEqual(
      actual
        .filter((row) => row.kind === "ERROR")
        .map((row) => [row.value, row.archived]),
      [
        ["A", 0],
        ["Ａ", 1],
      ],
    );
    assert.throws(
      () =>
        db
          .prepare(
            "UPDATE dictionary_items SET archived=0 WHERE kind='SUBJECT' AND value='高等数学'",
          )
          .run(),
      /UNIQUE/,
    );
  } finally {
    db.close();
  }
});

test("模板映射、原常量顺序与未知值字典序", () => {
  const db = fixture();
  try {
    const types = ["Z", "SENTENCE", "VOCABULARY", "CS", "MATH", "A"];
    const subjects = [
      "英语",
      "计算机网络",
      "操作系统",
      "计算机组成原理",
      "数据结构",
      "高等数学",
    ];
    for (const [index, type] of types.entries())
      entry(db, `entry-${index}`, "owner-a", {
        type,
        subject: subjects[index],
        errors: ["表达", "审题", "计算", "方法", "条件", "概念", "Z", "A"],
      });
    migrateDatabase(db);
    const actual = rows(db);
    assert.deepEqual(
      actual
        .filter((row) => row.kind === "TYPE")
        .map((row) => [row.value, row.template]),
      [
        ["MATH", "MATH"],
        ["CS", "CS"],
        ["VOCABULARY", "VOCABULARY"],
        ["SENTENCE", "SENTENCE"],
        ["A", "GENERIC"],
        ["Z", "GENERIC"],
      ],
    );
    assert.deepEqual(
      actual.filter((row) => row.kind === "SUBJECT").map((row) => row.value),
      [...subjects].reverse(),
    );
    assert.deepEqual(
      actual.filter((row) => row.kind === "ERROR").map((row) => row.value),
      ["概念", "条件", "方法", "计算", "审题", "表达", "A", "Z"],
    );
  } finally {
    db.close();
  }
});

test("知识点合并的全部嵌套记录与节点来源均归档", () => {
  const db = fixture();
  try {
    const record = (suffix: string) => ({
      payload: JSON.stringify({
        type: `merge-type-${suffix}`,
        subject: `merge-subject-${suffix}`,
        errors: [`merge-error-${suffix}`],
      }),
    });
    db.prepare("INSERT INTO knowledge_merges VALUES(?,?,?,0)").run(
      "merge",
      "owner-a",
      JSON.stringify({
        before: {
          source: { subject: "source-subject" },
          target: { subject: "target-subject" },
          children: [{ subject: "child-subject" }],
          records: [record("before")],
        },
        after: {
          nodes: [{ subject: "after-subject" }],
          records: [record("after")],
        },
      }),
    );
    migrateDatabase(db);
    const actual = rows(db);
    assert.equal(actual.length, 10);
    assert.ok(actual.every((row) => row.archived === 1));
    for (const value of [
      "source-subject",
      "target-subject",
      "child-subject",
      "after-subject",
      "merge-type-before",
      "merge-error-after",
    ])
      assert.ok(
        actual.some((row) => row.value === value),
        value,
      );
  } finally {
    db.close();
  }
});

test("两个 owner 独立回填和规范化去重", () => {
  const db = fixture();
  try {
    entry(db, "a", "owner-a");
    entry(db, "b", "owner-b", {
      type: "CS",
      subject: "高等数学",
      errors: ["另一账号错因"],
    });
    migrateDatabase(db);
    assert.equal(rows(db).find((row) => row.kind === "SUBJECT")!.archived, 0);
    assert.equal(
      rows(db, "owner-b").find((row) => row.kind === "SUBJECT")!.archived,
      0,
    );
    assert.ok(!rows(db).some((row) => row.value === "另一账号错因"));
  } finally {
    db.close();
  }
});

test("v12 失败整体回滚，不降版本、不留下半张字典表", () => {
  const db = fixture();
  try {
    entry(db);
    db.prepare(
      "INSERT INTO revisions VALUES('bad','owner-a','entry',1,'{','manual','now')",
    ).run();
    assert.throws(() => migrateDatabase(db), /JSON/);
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 11);
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM schema_migrations WHERE version=12")
        .get()!.n,
      0,
    );
    assert.equal(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name='dictionary_items'")
        .get(),
      undefined,
    );
  } finally {
    db.close();
  }
});

test("只读服务和 GET handler 按 owner 隔离、可包含归档并回退 label", async () => {
  const { db } = await import("../src/lib/db");
  const { list, labelOf } = await import("../src/modules/dictionaries/service");
  const { dictionariesHandler } =
    await import("../src/modules/http/handlers/dictionaries");
  const { NextRequest, NextResponse } = await import("next/server");
  for (const owner of ["service-a", "service-b"])
    db.prepare(
      "INSERT INTO users(id,username,password,settings) VALUES(?,?,?,?)",
    ).run(owner, owner, "hash", "{}");
  const insert = db.prepare(
    "INSERT INTO dictionary_items VALUES(?,?,?,?,?,'GENERIC',0,?,1,'now','now')",
  );
  insert.run("service-a", "SUBJECT", "a", "我的科目", "我的科目", 0);
  insert.run("service-a", "SUBJECT", "old", "历史科目", "历史科目", 1);
  insert.run("service-b", "SUBJECT", "a", "他人科目", "他人科目", 0);
  assert.equal(list("service-a", "SUBJECT").length, 1);
  assert.equal(list("service-a", "SUBJECT", true).length, 2);
  assert.equal(labelOf("service-a", "SUBJECT", "a"), "我的科目");
  assert.equal(labelOf("service-a", "SUBJECT", "old"), "历史科目");
  assert.equal(labelOf("service-a", "SUBJECT", "unknown"), "unknown");
  const context = {
    req: new NextRequest(
      "http://localhost/api/v1/dictionaries?includeArchived=0",
    ),
    p: "dictionaries",
    parts: ["dictionaries"],
    method: "GET",
    owner: "service-a",
    s: {} as ApiContext["s"],
    json: async () => ({}),
    ok: (data: unknown) => NextResponse.json(data),
  };
  const response = await dictionariesHandler(context);
  assert.deepEqual(await response!.json(), {
    types: [],
    subjects: [
      {
        value: "a",
        label: "我的科目",
        template: "GENERIC",
        sortOrder: 0,
        archived: false,
        version: 1,
      },
    ],
    errors: [],
  });
  assert.equal(
    await dictionariesHandler({ ...context, method: "POST" }),
    undefined,
  );
  await assert.rejects(() =>
    dictionariesHandler({
      ...context,
      req: new NextRequest(
        "http://localhost/api/v1/dictionaries?includeArchived=yes",
      ),
    }),
  );
});
