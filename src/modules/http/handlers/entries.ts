import { randomUUID } from "node:crypto";
import { z } from "zod";
import { all, one, run } from "../../../lib/db";
import {
  assert,
  entries,
  dashboard,
  getEntry,
  createEntry,
  updateEntry,
  trashEntry,
} from "../../entries/service";
import {
  batchTags,
  batchPause,
  undoBatch,
  batchReviewPreview,
} from "../../entries/batch";
import type { ApiContext } from "../context";
export async function entriesHandler(context: ApiContext) {
  const { req, p, parts, method, owner, json, ok } = context;
  if (p === "dashboard" && method === "GET") return ok(dashboard(owner));
  if (p === "entries/batch-review-preview" && method === "POST")
    return ok(batchReviewPreview(owner, await json()));
  if (p === "entries/batch-tags" && method === "POST")
    return ok(batchTags(owner, await json()));
  if (p === "entries/batch-pause" && method === "POST")
    return ok(batchPause(owner, await json()));
  if (p === "entries/batch-undo" && method === "POST")
    return ok(undoBatch(owner, await json()));
  if (p === "entries") {
    if (method === "GET") return ok(entries(owner, req.nextUrl.searchParams));
    if (method === "POST") return ok(createEntry(owner, await json()));
  }
  if (parts[0] === "entries" && parts[1]) {
    const id = z.string().uuid().parse(parts[1]);
    if (parts.length === 2) {
      if (method === "GET") {
        const e = getEntry(owner, id);
        return ok({
          ...e,
          review: one(
            "SELECT * FROM reviews WHERE entry_id=? AND owner=?",
            id,
            owner,
          ),
          relations: all(
            "SELECT r.*, e.title, e.type entry_type FROM relations r JOIN entries e ON e.id=CASE WHEN r.from_id=? THEN r.to_id ELSE r.from_id END WHERE r.owner=? AND (r.from_id=? OR r.to_id=?) AND e.deleted_at IS NULL",
            id,
            owner,
            id,
            id,
          ),
          history: all(
            "SELECT l.* FROM logs l JOIN reviews r ON r.id=l.review_id WHERE r.entry_id=? AND l.owner=? ORDER BY l.created_at DESC",
            id,
            owner,
          ),
        });
      }
      if (method === "PATCH") return ok(updateEntry(owner, id, await json()));
      if (method === "DELETE") return ok(trashEntry(owner, id));
    }
    if (parts[2] === "restore" && method === "POST")
      return ok(trashEntry(owner, id, true));
    if (parts[2] === "revisions" && method === "GET") {
      getEntry(owner, id);
      return ok(
        all(
          "SELECT * FROM revisions WHERE entry_id=? AND owner=? ORDER BY created_at DESC LIMIT 50",
          id,
          owner,
        ),
      );
    }
    if (parts[2] === "relations") {
      getEntry(owner, id);
      if (method === "POST") {
        const b = z
          .object({
            targetId: z.string().uuid(),
            type: z.enum([
              "SIMILAR",
              "SUPPORTS",
              "CONTRASTS",
              "CONTAINS_VOCABULARY",
            ]),
          })
          .strict()
          .parse(await json());
        getEntry(owner, b.targetId);
        assert(id !== b.targetId);
        run(
          "INSERT OR IGNORE INTO relations VALUES(?,?,?,?,?)",
          randomUUID(),
          owner,
          id,
          b.targetId,
          b.type,
        );
        return ok(true);
      }
      if (method === "DELETE") {
        const b = z
          .object({ id: z.string().uuid() })
          .strict()
          .parse(await json());
        run(
          "DELETE FROM relations WHERE id=? AND owner=? AND (from_id=? OR to_id=?)",
          b.id,
          owner,
          id,
          id,
        );
        return ok(true);
      }
    }
  }
}
