import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import type { ApiContext } from "../src/modules/http/context";
import { migrateDatabase, migrations } from "../src/lib/migrations";

const temporaryDataDir = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-dictionaries-"),
);
process.env.DATA_DIR = temporaryDataDir;
const { db, run, all, one } = await import("../src/lib/db");
const dictionary = await import("../src/modules/dictionaries/service");
const { ensure } = await import("../src/modules/dictionaries/ensure");
const { createEntry, updateEntry } =
  await import("../src/modules/entries/service");
const { dictionariesHandler } =
  await import("../src/modules/http/handlers/dictionaries");
const { knowledgeHandler } =
  await import("../src/modules/http/handlers/knowledge");
const { errorResponse } = await import("../src/modules/http/middleware");
const owner = randomUUID(),
  other = randomUUID();
for (const id of [owner, other])
  run(
    "INSERT INTO users(id,username,password,settings) VALUES(?,?,?,?)",
    id,
    id,
    "hash",
    "{}",
  );
beforeEach(() => {
  db.exec(
    "DELETE FROM revisions; DELETE FROM entries; DELETE FROM knowledge; DELETE FROM dictionary_items;",
  );
});
after(() => {
  db.close();
  rmSync(temporaryDataDir, { recursive: true, force: true });
});
function conflict(fn: () => unknown, code: string) {
  assert.throws(fn, (error: unknown) => {
    assert.equal((error as { status: number }).status, 409);
    assert.equal((error as { code: string }).code, code);
    return true;
  });
}
function context(
  route: string,
  method: string,
  body: unknown,
  account = owner,
): ApiContext {
  return {
    req: new NextRequest(`http://localhost/api/v1/${route}`, { method }),
    p: route,
    parts: route.split("/"),
    method,
    owner: account,
    s: {} as ApiContext["s"],
    json: async () => body,
    ok: (data) => NextResponse.json({ data }),
  };
}
async function request(
  route: string,
  method: string,
  body: unknown,
  account = owner,
) {
  try {
    return (await dictionariesHandler(context(route, method, body, account)))!;
  } catch (error) {
    return errorResponse(error, "dictionary-test");
  }
}

test("创建 UUID、trim、模板限制和追加排序", () => {
  const a = dictionary.create(owner, "SUBJECT", "  线性代数  ");
  const b = dictionary.create(owner, "SUBJECT", "概率论");
  assert.match(a.value, /^[0-9a-f-]{36}$/);
  assert.equal(a.label, "线性代数");
  assert.equal(a.template, "GENERIC");
  assert.equal(a.version, 1);
  assert.equal(b.sortOrder, a.sortOrder + 1);
  assert.equal(
    dictionary.create(owner, "TYPE", "自定义数学", "MATH").template,
    "MATH",
  );
  assert.throws(() => dictionary.create(owner, "SUBJECT", "其他", "MATH"));
  assert.throws(() => dictionary.create(owner, "ERROR", " "));
  assert.throws(() => dictionary.create(owner, "ERROR", "字".repeat(101)));
});

test("规范化重名、归档同名均 409，归档不删除且可恢复", () => {
  const a = dictionary.create(owner, "SUBJECT", "Ａ　Ｂ");
  conflict(() => dictionary.create(owner, "SUBJECT", "A B"), "NAME_TAKEN");
  const archived = dictionary.archive(owner, "SUBJECT", a.value, a.version);
  assert.equal(archived.archived, true);
  assert.equal(dictionary.list(owner, "SUBJECT").length, 0);
  assert.equal(dictionary.list(owner, "SUBJECT", true).length, 1);
  assert.throws(() => dictionary.create(owner, "SUBJECT", "A B"), {
    status: 409,
    code: "NAME_TAKEN",
    message: "已有归档同名项，可恢复",
  });
  const restored = dictionary.unarchive(
    owner,
    "SUBJECT",
    a.value,
    archived.version,
  );
  assert.equal(restored.archived, false);
  assert.equal(restored.version, 3);
});

test("改名、合并 PATCH、版本冲突与不可变字段", async () => {
  const a = dictionary.create(owner, "ERROR", "旧名称");
  const renamed = dictionary.rename(
    owner,
    "ERROR",
    a.value,
    "新名称",
    a.version,
  );
  assert.equal(renamed.value, a.value);
  assert.equal(renamed.version, 2);
  conflict(
    () => dictionary.archive(owner, "ERROR", a.value, 1),
    "VERSION_CONFLICT",
  );
  const response = await request(`dictionaries/errors/${a.value}`, "PATCH", {
    expectedVersion: 2,
    label: "更新名称",
    archived: true,
    sortOrder: 9,
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    ...renamed,
    label: "更新名称",
    archived: true,
    sortOrder: 9,
    version: 3,
  });
  for (const field of ["owner", "value", "kind", "template"])
    assert.equal(
      (
        await request(`dictionaries/errors/${a.value}`, "PATCH", {
          expectedVersion: 3,
          [field]: "wrong",
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await request(`dictionaries/errors/${a.value}`, "PATCH", {
        expectedVersion: 3,
      })
    ).status,
    400,
  );
});

test("改名冲突、恢复时 active 同名冲突均 409", () => {
  const a = dictionary.create(owner, "SUBJECT", "甲"),
    b = dictionary.create(owner, "SUBJECT", "乙");
  conflict(
    () => dictionary.rename(owner, "SUBJECT", b.value, "甲", b.version),
    "NAME_TAKEN",
  );
  dictionary.archive(owner, "SUBJECT", a.value, a.version);
  conflict(
    () => dictionary.rename(owner, "SUBJECT", b.value, "甲", b.version),
    "NAME_TAKEN",
  );
  run(
    "UPDATE dictionary_items SET label='甲',normalized_name='甲' WHERE value=?",
    b.value,
  );
  conflict(
    () => dictionary.unarchive(owner, "SUBJECT", a.value, 2),
    "NAME_TAKEN",
  );
});

test("reorder 路由优先、原子排序、重复项和错误版本不部分提交", async () => {
  const a = dictionary.create(owner, "SUBJECT", "甲"),
    b = dictionary.create(owner, "SUBJECT", "乙");
  const response = await request("dictionaries/subjects/order", "PATCH", {
    items: [
      { value: b.value, expectedVersion: 1 },
      { value: a.value, expectedVersion: 1 },
    ],
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    dictionary
      .list(owner, "SUBJECT")
      .map((item) => [item.value, item.sortOrder, item.version]),
    [
      [b.value, 0, 2],
      [a.value, 1, 2],
    ],
  );
  const before = dictionary.list(owner, "SUBJECT");
  conflict(
    () =>
      dictionary.reorder(owner, "SUBJECT", {
        items: [
          { value: a.value, expectedVersion: 2 },
          { value: b.value, expectedVersion: 1 },
        ],
      }),
    "VERSION_CONFLICT",
  );
  assert.deepEqual(dictionary.list(owner, "SUBJECT"), before);
  assert.equal(
    (
      await request("dictionaries/subjects/order", "PATCH", {
        items: [
          { value: a.value, expectedVersion: 2 },
          { value: a.value, expectedVersion: 2 },
        ],
      })
    ).status,
    400,
  );
});

test("两个 owner 隔离，跨账号改写和排序返回 404", async () => {
  const a = dictionary.create(owner, "SUBJECT", "相同名称");
  dictionary.create(other, "SUBJECT", "相同名称");
  assert.equal(dictionary.list(other, "SUBJECT").length, 1);
  assert.equal(
    (
      await request(
        `dictionaries/subjects/${a.value}`,
        "PATCH",
        { expectedVersion: 1, label: "越权" },
        other,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        "dictionaries/subjects/order",
        "PATCH",
        { items: [{ value: a.value, expectedVersion: 1 }] },
        other,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request("dictionaries/subjects", "POST", {
        label: "越权",
        owner: other,
      })
    ).status,
    400,
  );
});

test("entry 创建和更新同步原枚举值，不恢复归档、不覆盖名称", () => {
  const entry = createEntry(owner, {
    title: "测试记录",
    type: "SENTENCE",
    subject: "英语",
    body: "A sentence.",
    errors: ["方法"],
  });
  assert.equal(dictionary.labelOf(owner, "TYPE", "SENTENCE"), "英语长难句");
  assert.ok(
    dictionary.list(owner, "SUBJECT").some((item) => item.value === "英语"),
  );
  assert.ok(
    dictionary.list(owner, "ERROR").some((item) => item.value === "方法"),
  );
  dictionary.rename(owner, "SUBJECT", "英语", "我的英语", 1);
  dictionary.archive(owner, "SUBJECT", "英语", 2);
  updateEntry(owner, entry.id, {
    expectedVersion: 1,
    errors: ["方法", "表达"],
  });
  const subject = dictionary.list(owner, "SUBJECT", true)[0];
  assert.equal(subject.label, "我的英语");
  assert.equal(subject.archived, true);
  assert.equal(subject.version, 3);
  assert.ok(
    dictionary.list(owner, "ERROR").some((item) => item.value === "表达"),
  );
});

test("ensure 名称碰撞仍保留不同的 legacy value", () => {
  dictionary.create(owner, "SUBJECT", "英语");
  createEntry(owner, {
    title: "测试记录",
    type: "SENTENCE",
    subject: "英语",
    body: "text",
  });
  const legacy = dictionary
    .list(owner, "SUBJECT", true)
    .find((item) => item.value === "英语")!;
  assert.equal(legacy.archived, true);
  assert.equal(dictionary.list(owner, "SUBJECT", true).length, 2);
});

test("entry 主写入和 ensure 异常均完整回滚", () => {
  db.exec(
    "CREATE TEMP TRIGGER reject_entry BEFORE INSERT ON entries BEGIN SELECT RAISE(ABORT,'entry failure'); END;",
  );
  try {
    assert.throws(
      () =>
        createEntry(owner, {
          title: "测试记录",
          type: "SENTENCE",
          subject: "英语",
          body: "text",
          errors: ["方法"],
        }),
      /entry failure/,
    );
    assert.equal(all("SELECT * FROM dictionary_items").length, 0);
  } finally {
    db.exec("DROP TRIGGER reject_entry");
  }
  db.exec(
    "CREATE TEMP TRIGGER reject_dictionary BEFORE INSERT ON dictionary_items WHEN new.kind='ERROR' BEGIN SELECT RAISE(ABORT,'ensure failure'); END;",
  );
  try {
    assert.throws(
      () =>
        createEntry(owner, {
          title: "测试记录",
          type: "SENTENCE",
          subject: "英语",
          body: "text",
          errors: ["方法"],
        }),
      /ensure failure/,
    );
    assert.equal(all("SELECT * FROM entries").length, 0);
    assert.equal(all("SELECT * FROM dictionary_items").length, 0);
  } finally {
    db.exec("DROP TRIGGER reject_dictionary");
  }
  const entry = createEntry(owner, {
    title: "测试记录",
    type: "SENTENCE",
    subject: "英语",
    body: "text",
  });
  assert.throws(
    () =>
      updateEntry(
        owner,
        entry.id,
        { expectedVersion: 1, errors: ["方法"] },
        () => {
          throw Error("late failure");
        },
      ),
    /late failure/,
  );
  assert.equal(dictionary.list(owner, "ERROR").length, 0);
  assert.equal(
    one("SELECT version FROM entries WHERE id=?", entry.id)!.version,
    1,
  );
  assert.equal(all("SELECT * FROM revisions").length, 0);
});

test("knowledge 创建/更新同步科目且失败同事务回滚", async () => {
  const response = await knowledgeHandler(
    context("knowledge-nodes", "POST", {
      name: "节点",
      subject: "英语",
      parentId: null,
      description: "",
    }),
  );
  const node = (await response!.json()).data;
  assert.equal(dictionary.list(owner, "SUBJECT")[0].value, "英语");
  run("DELETE FROM dictionary_items");
  await knowledgeHandler(
    context(`knowledge-nodes/${node.id}`, "PATCH", { archived: true }),
  );
  assert.equal(dictionary.list(owner, "SUBJECT", true)[0].archived, true);
  run("DELETE FROM dictionary_items");
  db.exec(
    "CREATE TEMP TRIGGER reject_knowledge BEFORE UPDATE ON knowledge BEGIN SELECT RAISE(ABORT,'knowledge failure'); END;",
  );
  try {
    await assert.rejects(
      () =>
        knowledgeHandler(
          context(`knowledge-nodes/${node.id}`, "PATCH", { archived: false }),
        ),
      /knowledge failure/,
    );
    assert.equal(dictionary.list(owner, "SUBJECT", true).length, 0);
    assert.equal(
      one("SELECT archived FROM knowledge WHERE id=?", node.id)!.archived,
      1,
    );
  } finally {
    db.exec("DROP TRIGGER reject_knowledge");
  }
});

test("v13 翻译未改名 TYPE，保留自定义名和其他 kind，补齐并追加历史值", () => {
  const migrationDb = new DatabaseSync(
    path.join(temporaryDataDir, "v13.sqlite"),
  );
  try {
    migrateDatabase(migrationDb, {
      steps: migrations.filter((step) => step.version <= 12),
    });
    migrationDb
      .prepare(
        "INSERT INTO users(id,username,password,settings) VALUES('legacy','legacy','hash','{}')",
      )
      .run();
    const insert = migrationDb.prepare(
      "INSERT INTO dictionary_items VALUES('legacy',?,?,?,?,'GENERIC',10,0,1,'now','now')",
    );
    insert.run("TYPE", "MATH", "MATH", "MATH");
    insert.run("TYPE", "CS", "我的专业课", "我的专业课");
    insert.run("SUBJECT", "MATH", "MATH", "MATH");
    const payload = { type: "VOCABULARY", subject: "英语", errors: ["方法"] };
    migrationDb
      .prepare(
        "INSERT INTO entries VALUES('legacy-entry','legacy','VOCABULARY','','英语','INBOX','word',?,1,'now','now',NULL)",
      )
      .run(JSON.stringify(payload));
    migrationDb
      .prepare(
        "INSERT INTO revisions VALUES('revision','legacy','legacy-entry',1,?,'manual','now')",
      )
      .run(
        JSON.stringify({
          title: "测试记录",
          type: "SENTENCE",
          subject: "修订科目",
          errors: ["历史错因"],
        }),
      );
    migrationDb
      .prepare(
        "INSERT INTO knowledge VALUES('node','legacy','知识点科目',NULL,'node','',0)",
      )
      .run();
    migrationDb
      .prepare(
        "INSERT INTO reviews VALUES('review','legacy','legacy-entry','NEW',-1,0,'2026-10-26',1)",
      )
      .run();
    migrationDb
      .prepare(
        "INSERT INTO logs VALUES('log','legacy','review','PRACTICE','GOOD','2026-10-26',?,'now')",
      )
      .run(
        JSON.stringify({
          errorCauses: ["日志错因"],
          errorSnapshot: ["快照错因"],
        }),
      );
    migrationDb
      .prepare("INSERT INTO knowledge_merges VALUES('merge','legacy',?,0)")
      .run(
        JSON.stringify({
          before: {
            source: { subject: "合并源" },
            target: { subject: "合并目标" },
            children: [{ subject: "子节点" }],
            records: [
              {
                payload: JSON.stringify({
                  type: "OLD",
                  subject: "合并前科目",
                  errors: ["合并前错因"],
                }),
              },
            ],
          },
          after: {
            nodes: [{ subject: "合并后节点" }],
            records: [
              {
                payload: JSON.stringify({
                  type: "OLD2",
                  subject: "合并后科目",
                  errors: ["合并后错因"],
                }),
              },
            ],
          },
        }),
      );
    migrateDatabase(migrationDb);
    const items = migrationDb
      .prepare("SELECT * FROM dictionary_items ORDER BY kind,sort_order")
      .all();
    assert.equal(
      items.find((item) => item.kind === "TYPE" && item.value === "MATH")!
        .label,
      "数学错题",
    );
    assert.equal(
      items.find((item) => item.kind === "TYPE" && item.value === "CS")!.label,
      "我的专业课",
    );
    assert.equal(
      items.find((item) => item.kind === "SUBJECT" && item.value === "MATH")!
        .label,
      "MATH",
    );
    assert.equal(
      items.find((item) => item.value === "VOCABULARY")!.template,
      "VOCABULARY",
    );
    for (const value of ["英语", "方法", "知识点科目"])
      assert.equal(
        items.find((item) => item.value === value)!.archived,
        0,
        value,
      );
    for (const value of [
      "SENTENCE",
      "历史错因",
      "日志错因",
      "快照错因",
      "合并源",
      "合并目标",
      "子节点",
      "合并后节点",
      "合并前科目",
      "合并前错因",
      "合并后科目",
      "合并后错因",
    ])
      assert.equal(
        items.find((item) => item.value === value)!.archived,
        1,
        value,
      );
    assert.ok(
      items
        .filter(
          (item) =>
            item.kind === "TYPE" &&
            !["MATH", "CS"].includes(String(item.value)),
        )
        .every((item) => Number(item.sort_order) > 10),
    );
    migrateDatabase(migrationDb);
    assert.deepEqual(
      migrationDb
        .prepare("SELECT * FROM dictionary_items ORDER BY kind,sort_order")
        .all(),
      items,
    );
  } finally {
    migrationDb.close();
  }
});

test("ensure 保持既有 TYPE 的名称、归档状态和版本", () => {
  createEntry(owner, {
    title: "测试记录",
    type: "MATH",
    subject: "高等数学",
    body: "x",
  });
  const before = dictionary.archive(owner, "TYPE", "MATH", 1);
  ensure(owner, "TYPE", "MATH");
  assert.deepEqual(dictionary.list(owner, "TYPE", true)[0], before);
});
