import { randomUUID } from "node:crypto";
import { z } from "zod";
import { all, one, run } from "../../../lib/db";
import { assert } from "../../entries/service";
import { subjects } from "../../../lib/model";
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
    const { state, ...preview } = mergePreview(
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
          subject: z.enum(subjects as [string, ...string[]]),
          parentId: z.string().uuid().nullable(),
          description: z.string().max(10000),
        })
        .strict()
        .parse(await json());
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
    }
  }
  if (parts[0] === "knowledge-nodes" && parts[1] && method === "PATCH") {
    const b = z
      .object({ archived: z.boolean() })
      .strict()
      .parse(await json());
    assert(
      one("SELECT id FROM knowledge WHERE id=? AND owner=?", parts[1], owner),
      404,
      "RESOURCE_NOT_FOUND",
      "知识点不存在",
    );
    run(
      "UPDATE knowledge SET archived=? WHERE id=? AND owner=?",
      b.archived ? 1 : 0,
      parts[1],
      owner,
    );
    return ok(true);
  }
}
