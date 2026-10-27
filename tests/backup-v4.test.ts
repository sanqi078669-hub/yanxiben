import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

const temporaryDataDir = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-backup-v4-"),
);
process.env.DATA_DIR = path.join(temporaryDataDir, "source");
const { db, run, all } = await import("../src/lib/db");
const { backup } = await import("../src/modules/data-management/backup");
const { createEntry } = await import("../src/modules/entries/service");
const { defaults } = await import("../src/lib/model");
const dictionary = await import("../src/modules/dictionaries/service");
const owner = randomUUID();
run(
  "INSERT INTO users(id,username,password,settings) VALUES(?,?,?,?)",
  owner,
  "source",
  "hash",
  JSON.stringify(defaults),
);
createEntry(owner, {
  type: "MATH",
  subject: "高等数学",
  title: "v4 round-trip",
  body: "x",
  errors: ["概念", "条件"],
});
dictionary.rename(owner, "TYPE", "MATH", "我的数学", 1);
dictionary.archive(owner, "ERROR", "条件", 1);
const custom = dictionary.create(owner, "SUBJECT", "归档自定义科目");
dictionary.archive(owner, "SUBJECT", custom.value, custom.version);
dictionary.update(owner, "SUBJECT", "高等数学", {
  expectedVersion: 1,
  sortOrder: 12,
});
const originalRows = all(
  "SELECT * FROM dictionary_items WHERE owner=? ORDER BY kind,value",
  owner,
);
const exported = backup(owner);
const exportedFiles = unzipSync(exported);
const exportedManifest = JSON.parse(strFromU8(exportedFiles["manifest.json"]));
const exportedData = JSON.parse(strFromU8(exportedFiles["data.json"]));
after(() => {
  db.close();
  rmSync(temporaryDataDir, { recursive: true, force: true });
});

function archive(
  data: Record<string, any>,
  schemaVersion: number,
  manifestPatch: Record<string, unknown> = {},
) {
  const bytes = strToU8(JSON.stringify(data));
  return zipSync({
    "data.json": bytes,
    "manifest.json": strToU8(
      JSON.stringify({
        schemaVersion,
        counts: Object.fromEntries(
          Object.entries(data)
            .filter(([key]) => key !== "profile")
            .map(([key, rows]) => [key, rows.length]),
        ),
        files: [
          {
            name: "data.json",
            size: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        ],
        ...manifestPatch,
      }),
    ),
  });
}

function restoreIsolated(bytes: Uint8Array, rejectEnsure = false) {
  const folder = mkdtempSync(path.join(temporaryDataDir, "restore-"));
  const file = path.join(folder, "input.zip");
  writeFileSync(file, bytes);
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import {readFileSync} from 'node:fs';
    import {restore} from './src/modules/data-management/backup.ts';
    import {db} from './src/lib/db.ts';
    if(process.env.REJECT_ENSURE==='1') db.exec("CREATE TEMP TRIGGER reject_dictionary BEFORE INSERT ON dictionary_items WHEN new.value='MATH' BEGIN SELECT RAISE(ABORT,'ensure failure'); END");
    let outcome;
    try {
      const result=await restore(readFileSync(process.env.BACKUP_FIXTURE),'restored','hash');
      outcome={ok:true,result};
    } catch(error) {outcome={ok:false,code:error.code};}
    outcome.rows=db.prepare('SELECT * FROM dictionary_items ORDER BY kind,value').all();
    outcome.users=db.prepare('SELECT count(*) n FROM users').get().n;
    outcome.entries=db.prepare('SELECT count(*) n FROM entries').get().n;
    console.log('BACKUP_TEST_RESULT '+JSON.stringify(outcome));
    db.close();
  `,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DATA_DIR: path.join(folder, "data"),
        BACKUP_FIXTURE: file,
        REJECT_ENSURE: rejectEnsure ? "1" : "0",
      },
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("BACKUP_TEST_RESULT "));
  assert.ok(line, result.stdout + result.stderr);
  return JSON.parse(line.slice("BACKUP_TEST_RESULT ".length));
}

function legacyFixture(version: 1 | 2 | 3) {
  const data = JSON.parse(
    readFileSync("tests/fixtures/backup-v1.json", "utf8"),
  );
  if (version >= 2) {
    for (const node of data.knowledge) node.archived = 0;
    for (const table of [
      "knowledge_aliases",
      "knowledge_merges",
      "ai_audit",
      "ai_audit_extras",
    ])
      data[table] = [];
  }
  if (version >= 3) data.entry_hint_usage = [];
  return data;
}

test("v4 自定义 GENERIC 类型可恢复，缺失类型按 GENERIC 容错并补齐", () => {
  for (const includeDictionary of [true, false]) {
    const data = structuredClone(exportedData);
    const type = randomUUID();
    const row = data.entries[0];
    row.type = type;
    row.payload = JSON.stringify({
      ...JSON.parse(row.payload),
      type,
      details: { analysis_md: "自定义分析" },
    });
    if (includeDictionary) {
      const legacy = data.dictionary_items.find((r: any) => r.kind === "TYPE");
      data.dictionary_items.push({
        ...legacy,
        value: type,
        label: "通用类型",
        normalized_name: "通用类型",
        template: "GENERIC",
      });
    }
    const restored = restoreIsolated(archive(data, 4));
    assert.equal(restored.ok, true);
    assert.equal(
      restored.rows.find((r: any) => r.kind === "TYPE" && r.value === type)
        .template,
      "GENERIC",
    );
    for (const patch of [
      { details: { solution_md: "错误字段" } },
      { details: { subtype: "QUESTION" } },
      {
        contexts: [
          {
            sentence_text: "word",
            meaning_md: "义",
            source: "",
            collocation: "",
            sentence_entry_id: "",
          },
        ],
      },
    ]) {
      const invalid = structuredClone(data);
      invalid.entries[0].payload = JSON.stringify({
        ...JSON.parse(row.payload),
        ...patch,
      });
      assert.equal(restoreIsolated(archive(invalid, 4)).code, "INVALID_BACKUP");
    }
    const historical = structuredClone(data);
    const payload = JSON.parse(row.payload);
    historical.revisions.push({
      id: randomUUID(),
      owner,
      entry_id: row.id,
      version: row.version,
      snapshot: JSON.stringify({
        ...payload,
        id: row.id,
        owner,
        version: row.version,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: null,
      }),
      reason: "MANUAL",
      created_at: row.created_at,
    });
    assert.equal(restoreIsolated(archive(historical, 4)).ok, true);
    const snapshot = JSON.parse(historical.revisions[0].snapshot);
    snapshot.details = { solution_md: "错误快照模板" };
    historical.revisions[0].snapshot = JSON.stringify(snapshot);
    assert.equal(
      restoreIsolated(archive(historical, 4)).code,
      "INVALID_BACKUP",
    );
  }
});

test("备份模板优先字典，v3 未知类型使用 GENERIC", () => {
  const data = structuredClone(exportedData);
  data.dictionary_items.find(
    (r: any) => r.kind === "TYPE" && r.value === "MATH",
  ).template = "GENERIC";
  data.entries[0].payload = JSON.stringify({
    ...JSON.parse(data.entries[0].payload),
    details: { analysis_md: "字典模板优先" },
  });
  assert.equal(restoreIsolated(archive(data, 4)).ok, true);
  const old = legacyFixture(3);
  const type = "constructor";
  for (const row of old.entries) {
    row.type = type;
    row.payload = JSON.stringify({
      ...JSON.parse(row.payload),
      type,
      details: { analysis_md: "旧备份未知类型" },
      contexts: [],
    });
  }
  const restored = restoreIsolated(archive(old, 3));
  assert.equal(restored.ok, true);
  assert.equal(
    restored.rows.find((r: any) => r.kind === "TYPE" && r.value === type)
      .template,
    "GENERIC",
  );
});

test("v4 导出包含字典计数，改名/归档/排序及跨 kind 相同 value 无损往返", () => {
  assert.equal(exportedManifest.schemaVersion, 4);
  assert.equal(exportedManifest.counts.dictionary_items, originalRows.length);
  assert.deepEqual(
    exportedData.dictionary_items,
    all("SELECT * FROM dictionary_items WHERE owner=?", owner).map((row) => ({
      ...row,
    })),
  );
  const directRoundTrip = restoreIsolated(exported);
  assert.equal(directRoundTrip.ok, true);
  assert.deepEqual(
    directRoundTrip.rows,
    originalRows.map((row) => ({ ...row })),
  );
  const data = structuredClone(exportedData);
  const math = data.dictionary_items.find((row: any) => row.kind === "TYPE");
  data.dictionary_items.push({
    ...math,
    kind: "SUBJECT",
    label: "跨 kind 键",
    normalized_name: "跨 kind 键",
    template: "GENERIC",
  });
  const restored = restoreIsolated(archive(data, 4));
  assert.equal(restored.ok, true);
  assert.equal(restored.entries, 1);
  assert.deepEqual(
    restored.rows.filter(
      (row: any) => !(row.kind === "SUBJECT" && row.value === "MATH"),
    ),
    originalRows.map((row) => ({ ...row })),
  );
});

for (const version of [1, 2, 3] as const)
  test(`v${version} 真实旧表清单恢复后补齐字典，TYPE 为中文`, () => {
    const data = legacyFixture(version);
    assert.equal("dictionary_items" in data, false);
    const restored = restoreIsolated(archive(data, version));
    assert.equal(restored.ok, true);
    assert.equal(
      restored.rows.find(
        (row: any) => row.kind === "TYPE" && row.value === "MATH",
      ).label,
      "数学错题",
    );
    assert.ok(
      restored.rows.some(
        (row: any) => row.kind === "SUBJECT" && row.value === "高等数学",
      ),
    );
  });

test("v4 缺少被引用字典行可恢复并补齐，不覆盖已导入归档行", () => {
  const data = structuredClone(exportedData);
  data.dictionary_items = data.dictionary_items.filter(
    (row: any) => row.kind !== "TYPE",
  );
  const restored = restoreIsolated(archive(data, 4));
  assert.equal(restored.ok, true);
  const math = restored.rows.find((row: any) => row.kind === "TYPE");
  assert.equal(math.label, "数学错题");
  assert.equal(math.archived, 0);
  assert.equal(
    restored.rows.find((row: any) => row.value === "条件").archived,
    1,
  );
  assert.equal(
    restored.rows.find((row: any) => row.value === "高等数学").sort_order,
    12,
  );
});

test("恢复补齐修订、日志两类错因及合并记录中的历史值", () => {
  const data = structuredClone(exportedData);
  data.dictionary_items = data.dictionary_items.filter(
    (row: any) => row.kind !== "ERROR",
  );
  const entry = data.entries[0];
  const now = entry.created_at;
  data.revisions.push({
    id: randomUUID(),
    owner,
    entry_id: entry.id,
    version: entry.version,
    snapshot: JSON.stringify({
      ...JSON.parse(entry.payload),
      id: entry.id,
      owner,
      version: entry.version,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      errors: ["表达"],
    }),
    reason: "历史",
    created_at: now,
  });
  const review = {
    id: randomUUID(),
    owner,
    entry_id: entry.id,
    stage: "NEW",
    stage_index: -1,
    success_streak: 0,
    due_on: now.slice(0, 10),
    version: 1,
  };
  data.reviews.push(review);
  data.logs.push({
    id: randomUUID(),
    owner,
    review_id: review.id,
    mode: "PRACTICE",
    rating: "GOOD",
    local_date: now.slice(0, 10),
    created_at: now,
    payload: JSON.stringify({
      expectedVersion: 1,
      mode: "PRACTICE",
      rating: "GOOD",
      hintUsed: false,
      answerMd: "",
      errorCauses: ["方法"],
      errorSnapshot: ["计算"],
      before: review,
      after: review,
      algorithmVersion: "calendar-v1",
    }),
  });
  const source = {
    id: randomUUID(),
    owner,
    subject: "高等数学",
    parent_id: null,
    name: "源",
    description: "",
    archived: 1,
  };
  const target = { ...source, id: randomUUID(), name: "目标" };
  data.knowledge.push(source, target);
  data.knowledge_merges.push({
    id: randomUUID(),
    owner,
    undone: 0,
    payload: JSON.stringify({
      before: {
        source,
        target,
        children: [],
        aliases: [],
        records: [
          {
            ...entry,
            payload: JSON.stringify({
              ...JSON.parse(entry.payload),
              errors: ["审题"],
            }),
          },
        ],
      },
      after: { nodes: [source, target], records: [], aliases: [] },
      aliasId: randomUUID(),
    }),
  });
  const restored = restoreIsolated(archive(data, 4));
  assert.equal(restored.ok, true);
  for (const value of ["方法", "计算", "表达", "审题"])
    assert.equal(
      restored.rows.find(
        (row: any) => row.kind === "ERROR" && row.value === value,
      )?.archived,
      1,
      value,
    );
  for (const value of ["概念", "条件"])
    assert.equal(
      restored.rows.find(
        (row: any) => row.kind === "ERROR" && row.value === value,
      )?.archived,
      0,
      value,
    );
});

test("同 kind 归档重名允许；活跃同名拒绝", () => {
  const data = structuredClone(exportedData);
  const source = data.dictionary_items.find((row: any) => row.kind === "TYPE");
  data.dictionary_items.push({ ...source, value: randomUUID(), archived: 1 });
  assert.equal(restoreIsolated(archive(data, 4)).ok, true);
  data.dictionary_items[data.dictionary_items.length - 1].archived = 0;
  const rejected = restoreIsolated(archive(data, 4));
  assert.equal(rejected.code, "INVALID_BACKUP");
  assert.equal(rejected.users, 0);
});

const mutations: [string, (data: Record<string, any>) => void][] = [
  [
    "normalized 不符",
    (data) => {
      data.dictionary_items[0].normalized_name = "不匹配";
    },
  ],
  [
    "非法 template",
    (data) => {
      data.dictionary_items[0].template = "EVIL";
    },
  ],
  [
    "非 TYPE 专用 template",
    (data) => {
      data.dictionary_items.find(
        (row: any) => row.kind === "SUBJECT",
      ).template = "MATH";
    },
  ],
  [
    "跨 owner",
    (data) => {
      data.dictionary_items[0].owner = randomUUID();
    },
  ],
  [
    "重复复合主键",
    (data) => {
      data.dictionary_items.push({ ...data.dictionary_items[0] });
    },
  ],
  [
    "未知表",
    (data) => {
      data.unknown_table = [];
    },
  ],
];
for (const [name, mutate] of mutations)
  test(`v4 ${name} 拒绝且不写目标库`, () => {
    const data = structuredClone(exportedData);
    mutate(data);
    const rejected = restoreIsolated(archive(data, 4));
    assert.equal(rejected.code, "INVALID_BACKUP");
    assert.equal(rejected.users, 0);
    assert.equal(rejected.rows.length, 0);
  });

test("v4 counts 不符拒绝，缺表不按旧格式自动补齐", () => {
  const rejected = restoreIsolated(
    archive(exportedData, 4, {
      counts: { ...exportedManifest.counts, dictionary_items: 999 },
    }),
  );
  assert.equal(rejected.code, "INVALID_BACKUP");
  const data = structuredClone(exportedData);
  delete data.dictionary_items;
  assert.equal(restoreIsolated(archive(data, 4)).code, "INVALID_BACKUP");
});

test("恢复后 ensure 失败时，已导入的用户和记录同事务回滚", () => {
  const data = structuredClone(exportedData);
  data.dictionary_items = [];
  const rejected = restoreIsolated(archive(data, 4), true);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.users, 0);
  assert.equal(rejected.entries, 0);
  assert.equal(rejected.rows.length, 0);
});
