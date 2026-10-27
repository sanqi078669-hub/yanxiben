import { randomUUID } from "node:crypto";
import { z } from "zod";
import { all, one, run, transaction } from "../../../lib/db";
import { ensure } from "../../dictionaries/ensure";
import { assert } from "../../entries/service";
import {
  knowledgeAliases,
  knowledgeMerges,
  addAlias,
  mergePreview,
  mergeKnowledge,
  undoKnowledgeMerge,
} from "../../entries/knowledge";
import type { ApiContext } from "../context";
export async function knowledgeHandler(context: ApiContext) {
  const { req, p, parts, method, owner, json, ok } = context;
  if (p === "knowledge-tools/aliases" && method === "GET")
    return ok(knowledgeAliases(owner));
  if (p === "knowledge-tools/merges" && method === "GET")
    return ok(knowledgeMerges(owner));
  if (p === "knowledge-tools/aliases" && method === "POST")
    return ok(addAlias(owner, await json()));
  if (p === "knowledge-tools/preview" && method === "GET") {
    const { state: _state, ...preview } = mergePreview(
      owner,
      req.nextUrl.searchParams.get("source") || "",
      req.nextUrl.searchParams.get("target") || "",
    );
    return ok(preview);
  }
  if (p === "knowledge-tools/merge" && method === "POST")
    return ok(mergeKnowledge(owner, await json()));
  if (p === "knowledge-tools/undo" && method === "POST")
    return ok(
      undoKnowledgeMerge(
        owner,
        z
          .object({ id: z.string().uuid() })
          .strict()
          .parse(await json()).id,
      ),
    );
  if (p === "knowledge-nodes") {
    if (method === "GET")
      return ok(
        all(
          "SELECT * FROM knowledge WHERE owner=? ORDER BY subject,name",
          owner,
        ),
      );
    if (method === "POST") {
      const b = z
        .object({
          name: z.string().trim().min(1).max(100),
          subject: z.string().trim().min(1).max(100),
          parentId: z.string().uuid().nullable(),
          description: z.string().max(10000),
        })
        .strict()
        .parse(await json());
      return transaction(() => {
        if (b.parentId)
          assert(
            one(
              "SELECT id FROM knowledge WHERE id=? AND owner=? AND subject=? AND archived=0",
              b.parentId,
              owner,
              b.subject,
            ),
          );
        const id = randomUUID();
        ensure(owner, "SUBJECT", b.subject);
        run(
          "INSERT INTO knowledge VALUES(?,?,?,?,?,?,0)",
          id,
          owner,
          b.subject,
          b.parentId,
          b.name,
          b.description,
        );
        return ok(one("SELECT * FROM knowledge WHERE id=?", id));
      });
    }
  }
  if (parts[0] === "knowledge-nodes" && parts[1] && method === "PATCH") {
    const b = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(10000).optional(),
        archived: z.boolean().optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, "请提供要修改的字段")
      .parse(await json());
    return transaction(() => {
      const node = one(
        "SELECT subject,name,description,archived FROM knowledge WHERE id=? AND owner=?",
        parts[1],
        owner,
      );
      assert(node, 404, "RESOURCE_NOT_FOUND", "知识点不存在");
      const archived =
        b.archived === undefined ? node.archived : Number(b.archived);
      ensure(owner, "SUBJECT", node.subject, !archived);
      run(
        "UPDATE knowledge SET name=?,description=?,archived=? WHERE id=? AND owner=?",
        b.name ?? node.name,
        b.description ?? node.description,
        archived,
        parts[1],
        owner,
      );
      return ok(true);
    });
  }
}
