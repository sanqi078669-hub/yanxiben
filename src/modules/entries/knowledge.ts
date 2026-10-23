import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { all, one, run, transaction } from "../../lib/db";
import { assert, unpack } from "./service";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function initKnowledgeTools() {
  run(
    "CREATE TABLE IF NOT EXISTS knowledge_aliases(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),node_id TEXT NOT NULL REFERENCES knowledge(id),name TEXT NOT NULL)",
  );
  run(
    "CREATE TABLE IF NOT EXISTS knowledge_merges(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),payload TEXT NOT NULL,undone INTEGER NOT NULL DEFAULT 0)",
  );
}
export function knowledgeAliases(owner: string) {
  initKnowledgeTools();
  return all(
    "SELECT * FROM knowledge_aliases WHERE owner=? ORDER BY name,id",
    owner,
  );
}
export function knowledgeMerges(owner: string) {
  initKnowledgeTools();
  return all(
    "SELECT id,payload FROM knowledge_merges WHERE owner=? AND undone=0 ORDER BY rowid DESC LIMIT 30",
    owner,
  ).map((row) => {
    const data = JSON.parse(row.payload);
    return {
      id: row.id,
      source: data.before.source.name,
      target: data.before.target.name,
      affected: data.before.records.length,
    };
  });
}
export function addAlias(owner: string, raw: unknown) {
  initKnowledgeTools();
  const b = z
    .object({
      nodeId: z.string().uuid(),
      name: z.string().trim().min(1).max(100),
    })
    .strict()
    .parse(raw);
  assert(
    one(
      "SELECT id FROM knowledge WHERE id=? AND owner=? AND archived=0",
      b.nodeId,
      owner,
    ),
    404,
    "NOT_FOUND",
    "知识点不存在或已归档",
  );
  if (
    !one(
      "SELECT id FROM knowledge_aliases WHERE owner=? AND node_id=? AND name=?",
      owner,
      b.nodeId,
      b.name,
    )
  )
    run(
      "INSERT INTO knowledge_aliases VALUES(?,?,?,?)",
      randomUUID(),
      owner,
      b.nodeId,
      b.name,
    );
  return knowledgeAliases(owner);
}
export function mergePreview(
  owner: string,
  sourceId: string,
  targetId: string,
) {
  initKnowledgeTools();
  z.string().uuid().parse(sourceId);
  z.string().uuid().parse(targetId);
  const nodes = all("SELECT * FROM knowledge WHERE owner=? ORDER BY id", owner),
    source = nodes.find((n) => n.id === sourceId),
    target = nodes.find((n) => n.id === targetId);
  assert(
    source &&
      target &&
      source.id !== target.id &&
      source.subject === target.subject &&
      !source.archived &&
      !target.archived,
    400,
    "INVALID_MERGE",
    "请选择同科目两个不同的未归档知识点",
  );
  let ancestor = target;
  const seen = new Set<string>();
  while (ancestor?.parent_id) {
    assert(!seen.has(ancestor.id), 400, "INVALID_TREE", "知识点层级异常");
    seen.add(ancestor.id);
    assert(
      ancestor.parent_id !== source.id,
      400,
      "INVALID_MERGE",
      "不能合并到自己的子孙节点",
    );
    ancestor = nodes.find((n) => n.id === ancestor.parent_id)!;
  }
  const records = all(
    "SELECT * FROM entries WHERE owner=? ORDER BY id",
    owner,
  ).filter((e) => JSON.parse(e.payload).knowledgeIds.includes(sourceId));
  const aliases = knowledgeAliases(owner).filter(
    (a) => a.node_id === sourceId || a.node_id === targetId,
  );
  const children = nodes.filter((n) => n.parent_id === sourceId);
  const state = { source, target, records, aliases, children };
  return {
    source: source.name,
    target: target.name,
    records: records.map((e) => ({
      id: e.id,
      title: e.title,
      deleted: !!e.deleted_at,
    })),
    children: children.map((n) => n.name),
    digest: hash(state),
    state,
  };
}
export function mergeKnowledge(owner: string, raw: unknown) {
  const b = z
    .object({
      sourceId: z.string().uuid(),
      targetId: z.string().uuid(),
      digest: z.string(),
      confirm: z.literal(true),
    })
    .strict()
    .parse(raw);
  return transaction(() => {
    const preview = mergePreview(owner, b.sourceId, b.targetId);
    assert(
      preview.digest === b.digest,
      409,
      "STALE_PREVIEW",
      "知识点或记录已变化，请重新预览",
    );
    const before = preview.state,
      now = new Date().toISOString();
    for (const row of before.records) {
      const payload = JSON.parse(row.payload);
      payload.knowledgeIds = [
        ...new Set(
          payload.knowledgeIds.map((id: string) =>
            id === b.sourceId ? b.targetId : id,
          ),
        ),
      ];
      run(
        "INSERT INTO revisions VALUES(?,?,?,?,?,?,?)",
        randomUUID(),
        owner,
        row.id,
        row.version,
        JSON.stringify(unpack(row)),
        "知识点合并前",
        now,
      );
      run(
        "UPDATE entries SET payload=?,version=version+1,updated_at=? WHERE id=? AND owner=?",
        JSON.stringify(payload),
        now,
        row.id,
        owner,
      );
    }
    run(
      "UPDATE knowledge SET parent_id=? WHERE parent_id=? AND owner=?",
      b.targetId,
      b.sourceId,
      owner,
    );
    run(
      "UPDATE knowledge SET archived=1 WHERE id=? AND owner=?",
      b.sourceId,
      owner,
    );
    run(
      "UPDATE knowledge_aliases SET node_id=? WHERE node_id=? AND owner=?",
      b.targetId,
      b.sourceId,
      owner,
    );
    const aliasId = randomUUID();
    run(
      "INSERT INTO knowledge_aliases VALUES(?,?,?,?)",
      aliasId,
      owner,
      b.targetId,
      before.source.name,
    );
    const nodeIds = [
      b.sourceId,
      b.targetId,
      ...before.children.map((n) => n.id),
    ];
    const after = {
      nodes: nodeIds.map((id) =>
        one("SELECT * FROM knowledge WHERE id=? AND owner=?", id, owner),
      ),
      records: before.records.map((e) =>
        one("SELECT * FROM entries WHERE id=? AND owner=?", e.id, owner),
      ),
      aliases: knowledgeAliases(owner).filter(
        (a) => a.node_id === b.sourceId || a.node_id === b.targetId,
      ),
    };
    const id = randomUUID();
    run(
      "INSERT INTO knowledge_merges VALUES(?,?,?,0)",
      id,
      owner,
      JSON.stringify({ before, after, aliasId }),
    );
    return { id, affected: before.records.length };
  });
}
export function undoKnowledgeMerge(owner: string, id: string) {
  initKnowledgeTools();
  z.string().uuid().parse(id);
  return transaction(() => {
    const event = one(
      "SELECT * FROM knowledge_merges WHERE id=? AND owner=? AND undone=0",
      id,
      owner,
    );
    assert(event, 404, "NOT_FOUND", "合并记录不存在或已撤销");
    const { before, after, aliasId } = JSON.parse(event.payload);
    for (const row of after.nodes)
      assert(
        hash(
          one("SELECT * FROM knowledge WHERE id=? AND owner=?", row.id, owner),
        ) === hash(row),
        409,
        "VERSION_CONFLICT",
        "知识点已改变，不能自动撤销",
      );
    for (const row of after.records)
      assert(
        hash(
          one("SELECT * FROM entries WHERE id=? AND owner=?", row.id, owner),
        ) === hash(row),
        409,
        "VERSION_CONFLICT",
        "关联记录已编辑，不能自动撤销",
      );
    assert(
      hash(
        knowledgeAliases(owner).filter(
          (a) =>
            a.node_id === before.source.id || a.node_id === before.target.id,
        ),
      ) === hash(after.aliases),
      409,
      "VERSION_CONFLICT",
      "别名已改变，不能自动撤销",
    );
    for (const row of before.records) {
      const current = one("SELECT * FROM entries WHERE id=?", row.id)!;
      run(
        "INSERT INTO revisions VALUES(?,?,?,?,?,?,?)",
        randomUUID(),
        owner,
        row.id,
        current.version,
        JSON.stringify(unpack(current)),
        "撤销知识点合并前",
        new Date().toISOString(),
      );
      run(
        "UPDATE entries SET payload=?,version=version+1,updated_at=? WHERE id=? AND owner=?",
        row.payload,
        new Date().toISOString(),
        row.id,
        owner,
      );
    }
    for (const node of [before.source, ...before.children])
      run(
        "UPDATE knowledge SET parent_id=?,archived=? WHERE id=? AND owner=?",
        node.parent_id,
        node.archived,
        node.id,
        owner,
      );
    run("DELETE FROM knowledge_aliases WHERE id=? AND owner=?", aliasId, owner);
    for (const alias of before.aliases)
      run(
        "UPDATE knowledge_aliases SET node_id=? WHERE id=? AND owner=?",
        alias.node_id,
        alias.id,
        owner,
      );
    run("UPDATE knowledge_merges SET undone=1 WHERE id=?", id);
    return true;
  });
}
