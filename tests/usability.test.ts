import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-usability-"));
const { run, one } = await import("../src/lib/db");
const { defaults, entrySchema } = await import("../src/lib/model");
const { createEntry, updateEntry, getEntry, entries, trashEntry, addReview } =
  await import("../src/modules/entries/service");
const { markdownExport } =
  await import("../src/modules/data-management/backup");
const { afterSubmission } = await import("../src/modules/review/queue");
const owner = randomUUID();
run(
  "INSERT INTO users VALUES(?,?,?,?)",
  owner,
  "qa",
  "hash",
  JSON.stringify(defaults),
);
const input = (type = "MATH") =>
  entrySchema.parse({
    type,
    title: "自测",
    body: "测试题面",
    subject: type === "CS" ? "数据结构" : type === "MATH" ? "高等数学" : "英语",
  });
test("408 阅读导出保留题型及完整选项", () => {
  const e = createEntry(owner, {
    ...input("CS"),
    details: {
      subtype: "QUESTION",
      options_json: JSON.stringify(["A. 栈", "B. 队列"]),
    },
  });
  const md = strFromU8(unzipSync(markdownExport(owner))[e.id + ".md"]);
  assert(md.includes("A. 栈") && md.includes("B. 队列"));
});
test("删除关联长难句后，生词仍能编辑并保留原关联", () => {
  const sentence = createEntry(owner, input("SENTENCE"));
  const word = createEntry(owner, {
    ...input("VOCABULARY"),
    contexts: [
      {
        sentence_text: "A test sentence",
        meaning_md: "测试",
        source: "教材",
        collocation: "",
        sentence_entry_id: sentence.id,
      },
    ],
  });
  trashEntry(owner, sentence.id);
  const saved = updateEntry(owner, word.id, {
    expectedVersion: 1,
    title: "继续整理",
  });
  assert.equal(saved.title, "继续整理");
  assert.equal(saved.contexts[0].sentence_entry_id, sentence.id);
  assert.throws(() =>
    createEntry(owner, { ...input("VOCABULARY"), contexts: word.contexts }),
  );
});
test("非生词类型不能混入语境数据", () => {
  assert.throws(() =>
    createEntry(owner, {
      ...input(),
      contexts: [
        {
          sentence_text: "text",
          meaning_md: "",
          source: "",
          collocation: "",
          sentence_entry_id: "",
        },
      ],
    }),
  );
});
test("恢复未删除记录应拒绝且不暂停现有复习", () => {
  const e = createEntry(owner, input()),
    r = addReview(owner, e.id);
  assert.throws(() => trashEntry(owner, e.id, true));
  assert.equal(one("SELECT stage FROM reviews WHERE id=?", r.id)!.stage, "NEW");
});
test("重复删除不增加内容版本与历史", () => {
  const e = createEntry(owner, input());
  const deleted = trashEntry(owner, e.id);
  const twice = trashEntry(owner, e.id);
  assert.equal(twice.version, deleted.version);
});
test("标签搜索与保存使用同一归一化规则", () => {
  const e = createEntry(owner, { ...input(), tags: ["Taylor"] });
  assert(
    entries(owner, new URLSearchParams("tag=Taylor")).items.some(
      (x) => x.id === e.id,
    ),
  );
});
test("分页拒绝非整数和无限大参数", () => {
  for (const value of ["1.5", "Infinity", "-1", "garbage"])
    assert.throws(() => entries(owner, new URLSearchParams("page=" + value)));
});
test("跳过首题并完成末题后仍继续未做题，不提前结束或重复已完成题", () => {
  const initial = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const second = afterSubmission(initial, "c", 2);
  assert.equal(second.complete, false);
  assert.equal(second.items[second.index].id, "a");
  const third = afterSubmission(second.items, "a", second.index);
  assert.deepEqual(third.items, [{ id: "b" }]);
  assert.equal(afterSubmission(third.items, "b", 0).complete, true);
});
