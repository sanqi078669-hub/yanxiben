import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import type { ApiContext } from "../src/modules/http/context";
import { unzipSync, strFromU8 } from "fflate";

const folder = mkdtempSync(path.join(os.tmpdir(), "yanxi-type-templates-"));
process.env.DATA_DIR = folder;
const { db, run, one } = await import("../src/lib/db");
const { defaults, entrySchema, legacyTemplate, hasAnalysisContent } =
  await import("../src/lib/model");
const { dictionariesHandler } =
  await import("../src/modules/http/handlers/dictionaries");
const { entriesHandler } = await import("../src/modules/http/handlers/entries");
const { errorResponse } = await import("../src/modules/http/middleware");
const { markdownExport } =
  await import("../src/modules/data-management/backup");
const { addReview, attempt } = await import("../src/modules/entries/service");
const owner = randomUUID(),
  other = randomUUID();
for (const account of [owner, other])
  run(
    "INSERT INTO users(id,username,password,settings) VALUES(?,?,?,?)",
    account,
    account,
    "hash",
    JSON.stringify(defaults),
  );
after(() => {
  db.close();
  rmSync(folder, { recursive: true, force: true });
});
async function request(
  route: string,
  method: string,
  body?: unknown,
  account = owner,
) {
  const context: ApiContext = {
    req: new NextRequest("http://localhost/api/v1/" + route, { method }),
    p: route,
    parts: route.split("/"),
    method,
    owner: account,
    s: {} as ApiContext["s"],
    json: async () => body,
    ok: (data) => NextResponse.json({ data }),
  };
  try {
    return (await (route.startsWith("dictionaries")
      ? dictionariesHandler(context)
      : entriesHandler(context)))!;
  } catch (error) {
    return errorResponse(error, "type-template-test");
  }
}
const input = (type: string, details = {}) => ({
  type,
  subject: "自定义科目",
  title: "模板验收",
  body: "原文",
  details,
});
const context = {
  sentence_text: "词",
  meaning_md: "义",
  source: "",
  collocation: "",
};

test("API 创建 GENERIC 类型，保存分析、编辑并读回，Markdown 保留分析", async () => {
  const created = await request("dictionaries/types", "POST", {
    label: "通用材料",
    template: "GENERIC",
  });
  assert.equal(created.status, 200);
  const type = (await created.json()).data;
  const response = await request(
    "entries",
    "POST",
    input(type.value, { analysis_md: "通用分析内容" }),
  );
  assert.equal(response.status, 200);
  const saved = (await response.json()).data;
  const updated = await request("entries/" + saved.id, "PATCH", {
    expectedVersion: 1,
    details: { analysis_md: "更新后的通用分析" },
  });
  assert.equal(updated.status, 200);
  const read = await request("entries/" + saved.id, "GET");
  const entry = (await read.json()).data;
  assert.equal(entry.type, type.value);
  assert.equal(entry.details.analysis_md, "更新后的通用分析");
  assert.equal(hasAnalysisContent(entry), true);
  assert.match(
    strFromU8(unzipSync(markdownExport(owner))[saved.id + ".md"]),
    /分析与理解\n\n更新后的通用分析/,
  );
  for (const bad of [
    input(type.value, { solution_md: "数学字段" }),
    input(type.value, { subtype: "QUESTION" }),
    { ...input(type.value), contexts: [context] },
  ])
    assert.equal((await request("entries", "POST", bad)).status, 400);
  assert.equal(
    (await request("entries", "POST", input(type.value), other)).status,
    400,
  );
});

test("未知类型被拒，旧类型无字典行自动补齐；失败写入不遗留补齐行", async () => {
  const response = await request("entries", "POST", input("不存在的类型"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.message, "类型不存在");
  assert.equal(
    (await request("entries", "POST", { ...input("CS"), body: "" }, other))
      .status,
    400,
  );
  assert.equal(
    one(
      "SELECT value FROM dictionary_items WHERE owner=? AND kind='TYPE'",
      other,
    ),
    undefined,
  );
  for (const type of ["MATH", "CS", "VOCABULARY", "SENTENCE"]) {
    const response = await request("entries", "POST", input(type), other);
    assert.equal(response.status, 200);
    const entry = (await response.json()).data;
    assert.equal(
      (
        await request(
          "entries/" + entry.id,
          "PATCH",
          { expectedVersion: 1, title: "旧类型编辑" },
          other,
        )
      ).status,
      200,
    );
    const review = addReview(other, entry.id);
    const result = attempt(
      other,
      review.id,
      {
        expectedVersion: 1,
        mode: "SCHEDULED",
        rating: "GOOD",
        hintUsed: false,
        answerMd: "复习答案",
      },
      randomUUID(),
    );
    assert.equal(result.newVersion, 2);
    assert.equal(
      one(
        "SELECT template FROM dictionary_items WHERE owner=? AND kind='TYPE' AND value=?",
        other,
        type,
      )!.template,
      type,
    );
    assert.equal(legacyTemplate(type), type);
  }
  assert.equal(legacyTemplate("constructor"), null);
});

test("自定义 CS/VOCABULARY/MATH 模板按模板开放字段，不按 UUID 类型值判断", async () => {
  for (const [template, details, contexts] of [
    [
      "CS",
      { subtype: "CONCEPT", principle_md: "原理", options_json: '["A"]' },
      [],
    ],
    ["VOCABULARY", { lemma: "word" }, [context]],
    ["MATH", { solution_md: "解法" }, []],
  ] as const) {
    const type = (
      await (
        await request("dictionaries/types", "POST", {
          label: template,
          template,
        })
      ).json()
    ).data;
    assert.equal(
      (
        await request("entries", "POST", {
          ...input(type.value, details),
          contexts,
        })
      ).status,
      200,
    );
    if (template === "CS")
      assert.equal(
        (
          await request(
            "entries",
            "POST",
            input(type.value, { subtype: "INVALID" }),
          )
        ).status,
        400,
      );
  }
});

test("type 字符串 trim、长度边界保持，空白和超长被拒", () => {
  for (const type of ["", " \n ", "类".repeat(101)])
    assert.equal(entrySchema.safeParse(input(type)).success, false);
  assert.equal(entrySchema.parse(input(" MATH ")).type, "MATH");
  assert.equal(entrySchema.parse(input("类".repeat(100))).type.length, 100);
});
