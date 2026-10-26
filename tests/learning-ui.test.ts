import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseOptions, OptionsEditor } from "../src/components/OptionsEditor";
import { MaterialPreview } from "../src/components/MaterialPreview";
import { readDraft, draftLifetime } from "../src/lib/drafts";
import {
  HistoryRow,
  OptionsView,
  RevisionContent,
} from "../src/components/EntryContent";

test("损坏历史、选项及快照仅显示本条错误，不在渲染时抛异常", () => {
  for (const raw of ["{", "{}", "[]", "null"]) {
    assert.match(
      renderToStaticMarkup(createElement(HistoryRow, { h: { payload: raw } })),
      /本条复习历史已损坏/,
    );
    assert.match(
      renderToStaticMarkup(createElement(RevisionContent, { raw })),
      /本条历史快照已损坏/,
    );
  }
  assert.match(
    renderToStaticMarkup(createElement(OptionsView, { raw: "{}" })),
    /选项格式已损坏/,
  );
  assert.match(
    renderToStaticMarkup(createElement(OptionsView, { raw: '["选项甲"]' })),
    /选项甲/,
  );
});

test("选项兼容旧数据，保留换行、引号和公式，损坏数据不静默丢弃", () => {
  const options = ['A. "栈"\n$x^2$', "B. 队列"];
  assert.deepEqual(parseOptions(JSON.stringify(options)), options);
  assert.deepEqual(parseOptions(""), []);
  assert.equal(parseOptions('{"A":1}'), null);
  assert.equal(parseOptions("[1]"), null);
  const html = renderToStaticMarkup(
    createElement(OptionsEditor, { value: "损坏内容", onChange: () => {} }),
  );
  assert.match(html, /损坏内容/);
  assert.match(html, /原选项格式无法读取/);
});

test("材料中文预览保留全部发送内容且不执行题面 HTML", () => {
  const html = renderToStaticMarkup(
    createElement(MaterialPreview, {
      material: {
        type: "CS",
        body: '<script>alert("x")</script>',
        hintUsed: false,
        details: {
          options_json: '["选项甲","选项乙"]',
          my_answer_md: "我的答案",
        },
        contexts: [
          {
            sentence_text: "语境原文",
            meaning_md: "意义",
            collocation: "搭配",
          },
        ],
      },
    }),
  );
  for (const text of [
    "408 专业课",
    "选项甲",
    "选项乙",
    "我的答案",
    "语境原文",
    "意义",
    "否",
  ])
    assert.ok(html.includes(text));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("options_json"));
});

test("草稿按账号记录隔离，拒绝过期、未来及损坏内容，保留未填完标签", () => {
  const owner = "00000000-0000-4000-8000-000000000001";
  const now = Date.now();
  const value = {
    owner,
    record: "new",
    updated: now,
    version: 0,
    entry: {
      type: "MATH",
      title: "",
      subject: "高等数学",
      body: "未保存题目",
      tags: [""],
    },
  };
  assert.equal(
    readDraft(JSON.stringify(value), owner, "new", now)?.entry.body,
    "未保存题目",
  );
  assert.equal(
    readDraft(
      JSON.stringify(value),
      "00000000-0000-4000-8000-000000000002",
      "new",
      now,
    ),
    null,
  );
  assert.equal(readDraft(JSON.stringify(value), owner, "other", now), null);
  assert.equal(
    readDraft(JSON.stringify(value), owner, "new", now + draftLifetime),
    null,
  );
  assert.equal(readDraft(JSON.stringify(value), owner, "new", now - 1), null);
  assert.equal(readDraft("bad", owner, "new", now), null);
  assert.equal(
    readDraft(
      JSON.stringify({ ...value, entry: { ...value.entry, subject: "" } }),
      owner,
      "new",
      now,
    )?.entry.body,
    "未保存题目",
  );
});
