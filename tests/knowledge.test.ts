import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
function setup() {
  const owner = randomUUID(),
    source = randomUUID(),
    target = randomUUID(),
    child = randomUUID();
  run(
    "INSERT INTO users VALUES(?,?,?,?)",
    owner,
    owner,
    "hash",
    JSON.stringify(defaults),
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
