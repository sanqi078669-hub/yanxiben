import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { ApiContext } from "../src/modules/http/context";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import KnowledgePage from "../src/components/KnowledgePage";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-knowledge-"));
const { run, one } = await import("../src/lib/db");
const { defaults, entrySchema } = await import("../src/lib/model");
const { createEntry, getEntry, updateEntry } =
  await import("../src/modules/entries/service");
const {
  mergePreview,
  mergeKnowledge,
  undoKnowledgeMerge,
  addAlias,
  knowledgeAliases,
} = await import("../src/modules/entries/knowledge");
const { knowledgeHandler } =
  await import("../src/modules/http/handlers/knowledge");
const dictionary = await import("../src/modules/dictionaries/service");
async function knowledgeRequest(
  owner: string,
  method: string,
  body?: unknown,
  id?: string,
) {
  const route = "knowledge-nodes" + (id ? "/" + id : "");
  const response = await knowledgeHandler({
    req: new NextRequest("http://localhost/api/v1/" + route, { method }),
    p: route,
    parts: route.split("/"),
    method,
    owner,
    s: {} as ApiContext["s"],
    json: async () => body,
    ok: (data) => NextResponse.json({ data }),
  });
  return (await response!.json()).data;
}
function setup() {
  const owner = randomUUID(),
    source = randomUUID(),
    target = randomUUID(),
    child = randomUUID();
  run(
    "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
    owner,
    owner,
    "hash",
    JSON.stringify(defaults),
    "user",
  );
  for (const [id, name, parent] of [
    [source, "导数", null],
    [target, "求导", null],
    [child, "幂函数", source],
  ])
    run(
      "INSERT INTO knowledge VALUES(?,?,?,?,?,?,0)",
      id,
      owner,
      "高等数学",
      parent,
      name,
      "",
    );
  const entry = createEntry(
    owner,
    entrySchema.parse({
      type: "MATH",
      subject: "高等数学",
      title: "求导",
      body: "求 x² 的导数",
      knowledgeIds: [source, target],
    }),
  );
  return { owner, source, target, child, entry };
}
test("同义合并去重关联、迁移子节点并保留可撤销历史", () => {
  const { owner, source, target, child, entry } = setup();
  addAlias(owner, { nodeId: source, name: "微商" });
  const p = mergePreview(owner, source, target);
  assert.equal(p.records.length, 1);
  assert.deepEqual(p.children, ["幂函数"]);
  const merged = mergeKnowledge(owner, {
    sourceId: source,
    targetId: target,
    digest: p.digest,
    confirm: true,
  });
  assert.deepEqual(getEntry(owner, entry.id).knowledgeIds, [target]);
  assert.equal(
    one("SELECT parent_id FROM knowledge WHERE id=?", child)!.parent_id,
    target,
  );
  assert.equal(
    one("SELECT archived FROM knowledge WHERE id=?", source)!.archived,
    1,
  );
  assert.equal(
    knowledgeAliases(owner).filter((a) => a.node_id === target).length,
    2,
  );
  undoKnowledgeMerge(owner, merged.id);
  assert.deepEqual(getEntry(owner, entry.id).knowledgeIds, [source, target]);
  assert.equal(getEntry(owner, entry.id).version, 3);
  assert.equal(
    one("SELECT parent_id FROM knowledge WHERE id=?", child)!.parent_id,
    source,
  );
  assert.equal(knowledgeAliases(owner)[0].node_id, source);
  assert.throws(() => undoKnowledgeMerge(owner, merged.id));
});
test("拒绝循环、跨账号、过期预览和覆盖后续编辑的撤销", () => {
  const { owner, source, target, child, entry } = setup();
  assert.throws(() => mergePreview(owner, source, child));
  assert.throws(() => mergePreview(randomUUID(), source, target));
  const p = mergePreview(owner, source, target);
  updateEntry(owner, entry.id, { expectedVersion: 1, title: "已修改" });
  assert.throws(() =>
    mergeKnowledge(owner, {
      sourceId: source,
      targetId: target,
      digest: p.digest,
      confirm: true,
    }),
  );
  const current = mergePreview(owner, source, target);
  const merged = mergeKnowledge(owner, {
    sourceId: source,
    targetId: target,
    digest: current.digest,
    confirm: true,
  });
  updateEntry(owner, entry.id, { expectedVersion: 3, title: "合并后继续编辑" });
  assert.throws(() => undoKnowledgeMerge(owner, merged.id));
  assert.equal(getEntry(owner, entry.id).title, "合并后继续编辑");
});

test("自定义科目可建节点、读回和关联记录，归档科目不隐藏节点或覆盖标签", async () => {
  const { owner } = setup();
  const subject = dictionary.create(owner, "SUBJECT", "线性代数");
  const node = await knowledgeRequest(owner, "POST", {
    name: "矩阵的秩",
    subject: "  " + subject.value + "  ",
    parentId: null,
    description: "定义",
  });
  assert.equal(node.subject, subject.value);
  const saved = createEntry(owner, {
    type: "MATH",
    title: "矩阵练习",
    subject: subject.value,
    body: "求矩阵的秩",
    knowledgeIds: [node.id],
  });
  assert.deepEqual(getEntry(owner, saved.id).knowledgeIds, [node.id]);
  dictionary.archive(owner, "SUBJECT", subject.value, subject.version);
  await knowledgeRequest(
    owner,
    "PATCH",
    { name: "矩阵秩", description: "更新定义" },
    node.id,
  );
  const nodes = await knowledgeRequest(owner, "GET");
  const updated = nodes.find((n: { id: string }) => n.id === node.id);
  assert.equal(updated.subject, subject.value);
  assert.equal(updated.name, "矩阵秩");
  assert.equal(updated.description, "更新定义");
  assert.equal(updated.archived, 0);
  assert.equal(dictionary.labelOf(owner, "SUBJECT", subject.value), "线性代数");
  assert.equal(
    dictionary
      .list(owner, "SUBJECT", true)
      .find((s) => s.value === subject.value)!.archived,
    true,
  );
  await knowledgeRequest(owner, "PATCH", { archived: true }, node.id);
  assert.equal(
    one("SELECT archived FROM knowledge WHERE id=?", node.id)!.archived,
    1,
  );
});

test("父节点必须同账号、同科目且未归档；缺失科目自动 ensure", async () => {
  const { owner, source } = setup();
  const { owner: other, source: otherNode } = setup();
  const subject = randomUUID();
  const body = { name: "子节点", subject, parentId: source, description: "" };
  await assert.rejects(knowledgeRequest(owner, "POST", body));
  assert.equal(
    dictionary.list(owner, "SUBJECT", true).some((s) => s.value === subject),
    false,
  );
  await assert.rejects(
    knowledgeRequest(owner, "POST", {
      ...body,
      subject: "高等数学",
      parentId: otherNode,
    }),
  );
  await knowledgeRequest(owner, "PATCH", { archived: true }, source);
  await assert.rejects(
    knowledgeRequest(owner, "POST", { ...body, subject: "高等数学" }),
  );
  const root = await knowledgeRequest(owner, "POST", {
    ...body,
    parentId: null,
  });
  const child = await knowledgeRequest(owner, "POST", {
    ...body,
    parentId: root.id,
  });
  assert.equal(child.parent_id, root.id);
  assert.equal(
    dictionary.list(owner, "SUBJECT").find((s) => s.value === subject)!.label,
    subject,
  );
  assert.equal(
    (await knowledgeRequest(other, "GET")).some(
      (n: { id: string }) => n.id === root.id,
    ),
    false,
  );
  await assert.rejects(
    knowledgeRequest(other, "PATCH", { name: "越权" }, root.id),
  );
});

test("知识点科目 trim 并限制 1–100 字符", async () => {
  const { owner } = setup();
  for (const subject of ["", " \n ", "科".repeat(101)])
    await assert.rejects(
      knowledgeRequest(owner, "POST", {
        name: "边界",
        subject,
        parentId: null,
        description: "",
      }),
    );
  const node = await knowledgeRequest(owner, "POST", {
    name: "边界",
    subject: " " + "科".repeat(100) + " ",
    parentId: null,
    description: "",
  });
  assert.equal(node.subject.length, 100);
});

test("无科目时禁用知识点创建并链接到分类管理，不默认固定科目", () => {
  const html = renderToStaticMarkup(
    createElement(KnowledgePage, {
      notify: () => {},
      timezone: "Asia/Shanghai",
    }),
  );
  assert.match(html, /先创建或恢复科目/);
  assert.match(html, /href="\/settings#dictionary-manager"/);
  assert.match(html, /<input[^>]*disabled=""/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>.*?添加知识点/s);
  assert.doesNotMatch(html, /<option[^>]*>高等数学<\/option>/);
});
