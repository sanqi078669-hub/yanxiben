import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";

const temporaryDataDir = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-markdown-dictionaries-"),
);
process.env.DATA_DIR = temporaryDataDir;
const { db, run, one } = await import("../src/lib/db");
const { defaults } = await import("../src/lib/model");
const { createEntry } = await import("../src/modules/entries/service");
const dictionary = await import("../src/modules/dictionaries/service");
const { markdownExport, backup } =
  await import("../src/modules/data-management/backup");
const owner = randomUUID(),
  other = randomUUID();
for (const id of [owner, other])
  run(
    "INSERT INTO users(id,username,password,settings) VALUES(?,?,?,?)",
    id,
    id,
    "hash",
    JSON.stringify(defaults),
  );
after(() => {
  db.close();
  rmSync(temporaryDataDir, { recursive: true, force: true });
});

test("Markdown 导出解析 UUID 科目、归档错因和知识点名称，不改原记录或备份 JSON", () => {
  const subject = dictionary.create(owner, "SUBJECT", "线性代数");
  const error = dictionary.create(owner, "ERROR", "漏看约束");
  const knowledgeId = randomUUID();
  run(
    "INSERT INTO knowledge VALUES(?,?,?,NULL,?,'',1)",
    knowledgeId,
    owner,
    subject.value,
    "矩阵的秩",
  );
  const entry = createEntry(owner, {
    type: "MATH",
    subject: subject.value,
    title: "矩阵练习",
    body: "求矩阵的秩",
    errors: [error.value],
    knowledgeIds: [knowledgeId],
  });
  dictionary.archive(owner, "ERROR", error.value, error.version);
  run(
    "INSERT INTO dictionary_items SELECT ?,kind,value,'另一个账号','另一个账号',template,sort_order,archived,version,created_at,updated_at FROM dictionary_items WHERE owner=? AND kind='SUBJECT'",
    other,
    owner,
  );
  const originalPayload = one(
    "SELECT payload FROM entries WHERE id=?",
    entry.id,
  )!.payload;
  const markdown = strFromU8(
    unzipSync(markdownExport(owner))[entry.id + ".md"],
  );
  assert.match(markdown, /线性代数/);
  assert.match(markdown, /错因：漏看约束/);
  assert.match(markdown, /知识点：矩阵的秩/);
  for (const value of [subject.value, error.value, knowledgeId, "另一个账号"])
    assert.ok(!markdown.includes(value), value);
  assert.equal(
    one("SELECT payload FROM entries WHERE id=?", entry.id)!.payload,
    originalPayload,
  );
  const data = JSON.parse(strFromU8(unzipSync(backup(owner))["data.json"]));
  assert.equal(data.entries[0].subject, subject.value);
  assert.equal(data.entries[0].payload, originalPayload);
});

test("Markdown 无字典项时回退原值，空错因和知识点输出无", () => {
  const value = randomUUID();
  const entry = createEntry(owner, {
    type: "MATH",
    subject: value,
    title: "历史缺项",
    body: "x",
  });
  run(
    "DELETE FROM dictionary_items WHERE owner=? AND kind='SUBJECT' AND value=?",
    owner,
    value,
  );
  const markdown = strFromU8(
    unzipSync(markdownExport(owner))[entry.id + ".md"],
  );
  assert.ok(markdown.includes(value));
  assert.match(markdown, /错因：无/);
  assert.match(markdown, /知识点：无/);
});
