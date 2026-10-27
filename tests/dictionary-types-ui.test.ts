import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DictionaryContext,
  dictionaryTemplate,
} from "../src/components/DictionaryContext";
import { TypeIcon, Row } from "../src/components/ui";
import { Analysis } from "../src/components/EntryContent";
import { MaterialPreview } from "../src/components/MaterialPreview";
import { TypeCreate } from "../src/components/TypeCreate";
import DictionaryManager from "../src/components/DictionaryManager";
import { TypeCollection, TypeFootprints } from "../src/components/Today";
import { DictionaryOptions } from "../src/components/DictionaryOptions";
import { entrySchema, type Entry } from "../src/lib/model";
import { readDraft } from "../src/lib/drafts";
import type { DictionaryItem } from "../src/modules/dictionaries/service";
const typeItem = (
  value: string,
  template: DictionaryItem["template"],
  archived = false,
): DictionaryItem => ({
  value,
  template,
  archived,
  label: `名称-${value}`,
  sortOrder: 0,
  version: 1,
});
function render(child: ReactNode, types: DictionaryItem[]) {
  const items = { types, subjects: [], errors: [] };
  return renderToStaticMarkup(
    createElement(
      DictionaryContext.Provider,
      {
        value: {
          items,
          label: (_kind, value) =>
            types.find((item) => item.value === value)?.label ?? value,
          templateOf: (value) => dictionaryTemplate(types, value),
          reload: async () => items,
          loading: false,
          error: "",
        },
      },
      child,
    ),
  );
}
test("模板解析优先字典（含归档），再 legacy，最后 GENERIC", () => {
  assert.equal(
    dictionaryTemplate([typeItem("uuid", "MATH", true)], "uuid"),
    "MATH",
  );
  assert.equal(
    dictionaryTemplate([typeItem("MATH", "GENERIC")], "MATH"),
    "GENERIC",
  );
  assert.equal(dictionaryTemplate([], "CS"), "CS");
  assert.equal(dictionaryTemplate([], "constructor"), "GENERIC");
});
test("自定义模板图标和 class 使用模板，分析字段按模板展示", () => {
  for (const [template, details, text, icon] of [
    ["GENERIC", { analysis_md: "通用内容" }, "通用内容", "◇"],
    ["MATH", { solution_md: "数学解法" }, "数学解法", "∑"],
    ["VOCABULARY", { lemma: "word", part_of_speech: "noun" }, "word", "Aa"],
    ["CS", { principle_md: "原理" }, "原理", "⌘"],
  ] as const) {
    const item = typeItem("uuid-type", template);
    const entry = entrySchema.parse({
      type: item.value,
      title: "标题",
      subject: "科目",
      body: "原文",
      details,
    }) as Entry;
    const html = render(createElement(Analysis, { e: entry }), [item]);
    assert.ok(html.includes(text));
    const glyph = render(createElement(TypeIcon, { type: item.value }), [item]);
    assert.ok(glyph.includes(icon));
    assert.ok(glyph.includes(`type-icon ${template.toLowerCase()}`));
    assert.ok(!glyph.includes("type-icon uuid-type"));
  }
});
test("列表、预览展示归档类型的名称；预设禁用规则按 active 模板", () => {
  const item = typeItem("uuid-type", "MATH", true);
  assert.match(
    render(
      createElement(MaterialPreview, {
        material: { type: item.value, details: { analysis_md: "内容" } },
      }),
      [item],
    ),
    /名称-uuid-type/,
  );
  assert.match(
    render(createElement(MaterialPreview, { material: { type: item.value } }), [
      item,
    ]),
    /已归档/,
  );
  const row = render(
    createElement(Row, {
      e: {
        id: "id",
        type: item.value,
        title: "标题",
        body: "原文",
        subject: "科目",
        source: "",
        updated_at: new Date().toISOString(),
        status: "INBOX",
      },
    }),
    [item],
  );
  assert.match(row, /名称-uuid-type/);
  assert.doesNotMatch(row, /已归档/);
  const active = render(createElement(TypeCreate), [typeItem("math", "MATH")]);
  assert.match(active, /<button[^>]*disabled=""[^>]*>数学错题（已添加）/);
  const archived = render(createElement(TypeCreate), [item]);
  assert.doesNotMatch(archived, /已添加/);
  assert.match(archived, /从预设添加/);
  assert.match(render(createElement(DictionaryManager), [item]), /模板：数学/);
});
test("没有类型的未完成草稿可恢复，服务端 entrySchema 仍拒绝空类型", () => {
  const owner = "00000000-0000-4000-8000-000000000001";
  const entry = {
    type: "",
    title: "未完成",
    subject: "",
    body: "材料",
    tags: [],
  };
  assert.equal(entrySchema.safeParse(entry).success, false);
  assert.ok(
    readDraft(
      JSON.stringify({
        owner,
        record: "new",
        updated: Date.now(),
        version: 0,
        entry,
      }),
      owner,
      "new",
    ),
  );
});

test("Today 自定义类型收集卡使用 value 链接、模板副标题，足迹按 value 计数且缺省 0", () => {
  const rows = [
    typeItem("uuid-a", "GENERIC"),
    typeItem("uuid-b", "VOCABULARY"),
    typeItem("old", "MATH", true),
  ];
  const cards = render(createElement(TypeCollection), rows);
  assert.match(cards, /href="\/entries\/new\?type=uuid-a"/);
  assert.match(cards, /名称-uuid-a/);
  assert.match(cards, /留下原文，梳理思考/);
  assert.match(cards, /在语境中记忆/);
  assert.doesNotMatch(cards, /名称-old/);
  const counts = render(
    createElement(TypeFootprints, {
      byType: [
        { type: "uuid-a", n: 3 },
        { type: "old", n: 8 },
        { type: "missing", n: 10 },
      ],
    }),
    rows,
  );
  assert.match(counts, /href="\/library\?type=uuid-a"/);
  assert.match(counts, /<span>名称-uuid-a<\/span><b>3<\/b>/);
  assert.match(counts, /<span>名称-uuid-b<\/span><b>0<\/b>/);
  assert.doesNotMatch(counts, /名称-old/);
});

test("无活跃类型时 Today 两处均引导分类管理；筛选保留归档、缺失当前值和标签", () => {
  const archived = typeItem("old", "MATH", true);
  for (const rows of [[], [archived]]) {
    for (const component of [TypeCollection, TypeFootprints]) {
      const html = render(createElement(component), rows);
      assert.match(html, /先创建类型/);
      assert.match(html, /href="\/settings#dictionary-manager"/);
      assert.doesNotMatch(html, /href="\/entries\/new\?type=/);
    }
  }
  const active = typeItem("active", "GENERIC");
  const options = render(
    createElement(DictionaryOptions, { kind: "TYPE", value: "missing" }),
    [archived, active],
  );
  assert.match(options, /<option value="old">名称-old（已归档）<\/option>/);
  assert.match(
    options,
    /<option value="missing">missing（不在字典中）<\/option>/,
  );
  assert.ok(options.indexOf('value="active"') < options.indexOf('value="old"'));
});
