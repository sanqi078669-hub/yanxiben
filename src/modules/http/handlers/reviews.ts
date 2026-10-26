import { z } from "zod";
import { hasAnalysisContent } from "../../../lib/model";
import { all, one, run, transaction } from "../../../lib/db";
import {
  assert,
  getEntry,
  addReview,
  reviewQueue,
  attempt,
  recordEntryHint,
} from "../../entries/service";
import { activeStage } from "../../review/schedule";
import { learningStatistics } from "../../review/statistics";
import type { ApiContext } from "../context";
import { idempotencyKey } from "../middleware";
export async function reviewsHandler(context: ApiContext) {
  const { req, p, parts, method, owner, json, ok } = context;
  if (p === "reviews/statistics" && method === "GET")
    return ok(
      learningStatistics(owner, Object.fromEntries(req.nextUrl.searchParams)),
    );
  if (p === "reviews/queue" && method === "GET") return ok(reviewQueue(owner));
  if (p === "reviews/history" && method === "GET")
    return ok(
      all(
        "SELECT l.*,e.title FROM logs l JOIN reviews r ON r.id=l.review_id JOIN entries e ON e.id=r.entry_id WHERE l.owner=? AND e.deleted_at IS NULL ORDER BY l.created_at DESC LIMIT 200",
        owner,
      ),
    );
  if (p === "review-items" && method === "POST") {
    const b = z
      .object({
        entryId: z.string().uuid(),
        practice: z.boolean().optional(),
      })
      .strict()
      .parse(await json());
    return ok(addReview(owner, b.entryId, b.practice));
  }
  if (parts[0] === "review-items" && parts[1]) {
    if (parts[2] === "hint" && method === "POST") {
      const b = z
        .object({ expectedVersion: z.number().int() })
        .strict()
        .parse(await json());
      const r = one(
        "SELECT * FROM reviews WHERE owner=? AND id=?",
        owner,
        parts[1],
      );
      assert(r, 404, "RESOURCE_NOT_FOUND", "复习项不存在");
      assert(
        hasAnalysisContent(getEntry(owner, r.entry_id)),
        400,
        "ANALYSIS_UNAVAILABLE",
        "这条记录还没有分析内容，无法查看提示",
      );
      return ok(recordEntryHint(owner, r.entry_id, b.expectedVersion));
    }
    if (parts[2] === "attempts" && method === "POST")
      return ok(attempt(owner, parts[1], await json(), idempotencyKey(req)));
    if (method === "PATCH") {
      const b = z
        .object({ expectedVersion: z.number().int(), paused: z.boolean() })
        .strict()
        .parse(await json());
      return ok(
        transaction(() => {
          const r = one(
            "SELECT * FROM reviews WHERE id=? AND owner=?",
            parts[1],
            owner,
          );
          assert(r, 404, "RESOURCE_NOT_FOUND", "计划不存在");
          getEntry(owner, r.entry_id);
          assert(
            r.version === b.expectedVersion,
            409,
            "VERSION_CONFLICT",
            "计划已更新",
          );
          run(
            "UPDATE reviews SET stage=?,version=version+1 WHERE id=?",
            b.paused
              ? "PAUSED"
              : activeStage(
                  r as { stage_index: number; success_streak: number },
                ),
            r.id,
          );
          return true;
        }),
      );
    }
  }
}
