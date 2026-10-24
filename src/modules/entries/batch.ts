import { randomUUID } from "node:crypto";
import { z } from "zod";
import { one, run, transaction } from "../../lib/db";
import { getEntry, updateEntry, assert } from "./service";
import { enforceAccountQuota } from "../data-management/quota";

function init() {
  /* Schema is initialized centrally by lib/db. */
}
const selection = z
  .array(
    z
      .object({
        id: z.string().uuid(),
        version: z.number().int().positive(),
        reviewVersion: z.number().int().positive().nullable().optional(),
      })
      .strict(),
  )
  .min(1)
  .max(20)
  .refine((v) => new Set(v.map((e) => e.id)).size === v.length);
type Result = { id: string; ok: boolean; message: string };
export function batchReviewPreview(owner: string, raw: unknown) {
  const items = selection.parse(raw);
  return items.map((item) => {
    try {
      const entry = getEntry(owner, item.id);
      assert(
        entry.version === item.version,
        409,
        "VERSION_CONFLICT",
        "记录已修改",
      );
      const review = one(
        "SELECT version,stage FROM reviews WHERE entry_id=? AND owner=?",
        item.id,
        owner,
      );
      return {
        id: item.id,
        reviewVersion: review?.version ?? null,
        message: review
          ? review.stage === "PAUSED"
            ? "已暂停，无需修改"
            : "将暂停当前计划"
          : "没有复习计划，将报告失败",
      };
    } catch (e) {
      return {
        id: item.id,
        reviewVersion: null,
        message: (e as Error).message,
      };
    }
  });
}
export function batchPause(owner: string, raw: unknown) {
  init();
  const b = z
      .object({ items: selection, confirm: z.literal(true) })
      .strict()
      .parse(raw),
    changes: unknown[] = [],
    results: Result[] = [];
  for (const item of b.items) {
    try {
      transaction(() => {
        const entry = getEntry(owner, item.id);
        assert(
          entry.version === item.version,
          409,
          "VERSION_CONFLICT",
          "记录已修改，请重新选择",
        );
        const review = one(
          "SELECT * FROM reviews WHERE entry_id=? AND owner=?",
          item.id,
          owner,
        );
        assert(review, 404, "NO_PLAN", "记录没有复习计划");
        assert(
          review.version === item.reviewVersion,
          409,
          "VERSION_CONFLICT",
          "复习计划已变化，请重新预览",
        );
        if (review.stage === "PAUSED") {
          results.push({
            id: item.id,
            ok: true,
            message: "计划已暂停，无需修改",
          });
          return;
        }
        run(
          "UPDATE reviews SET stage='PAUSED',version=version+1 WHERE id=? AND owner=?",
          review.id,
          owner,
        );
        changes.push({
          kind: "pause",
          id: item.id,
          reviewId: review.id,
          version: review.version + 1,
          stage: review.stage,
        });
        results.push({ id: item.id, ok: true, message: "已暂停计划" });
      });
    } catch (e) {
      results.push({ id: item.id, ok: false, message: (e as Error).message });
    }
  }
  const id = randomUUID();
  run(
    "INSERT INTO batch_edits VALUES(?,?,?)",
    id,
    owner,
    JSON.stringify(changes),
  );
  return { id, results };
}
export function batchTags(owner: string, raw: unknown) {
  init();
  const b = z
    .object({
      items: selection,
      tag: z.string().trim().min(1).max(50),
      confirm: z.literal(true),
    })
    .strict()
    .parse(raw);
  const changes: { id: string; version: number; tags: string[] }[] = [],
    results: Result[] = [];
  const id = randomUUID();
  transaction(() => {
    run("INSERT INTO batch_edits VALUES(?,?,?)", id, owner, "[]");
    enforceAccountQuota(owner);
  });
  for (const item of b.items) {
    try {
      const entry = getEntry(owner, item.id);
      assert(
        entry.version === item.version,
        409,
        "VERSION_CONFLICT",
        "记录已修改，请重新选择",
      );
      const tag = b.tag.toLowerCase();
      if (entry.tags.includes(tag)) {
        results.push({
          id: item.id,
          ok: true,
          message: "已有此标签，无需修改",
        });
        continue;
      }
      const saved = updateEntry(
        owner,
        item.id,
        {
          expectedVersion: item.version,
          tags: [...entry.tags, tag],
          manual: true,
        },
        (saved) => {
          run(
            "UPDATE batch_edits SET payload=? WHERE id=? AND owner=?",
            JSON.stringify([
              ...changes,
              { id: item.id, version: saved.version, tags: entry.tags },
            ]),
            id,
            owner,
          );
          enforceAccountQuota(owner);
        },
      );
      changes.push({ id: item.id, version: saved.version, tags: entry.tags });
      results.push({ id: item.id, ok: true, message: "已添加标签" });
    } catch (error) {
      results.push({
        id: item.id,
        ok: false,
        message: (error as Error).message,
      });
    }
  }
  return { id, results };
}
export function undoBatch(owner: string, raw: unknown) {
  init();
  const b = z.object({ id: z.string().uuid() }).strict().parse(raw);
  const receipt = one(
    "SELECT payload FROM batch_edits WHERE id=? AND owner=?",
    b.id,
    owner,
  );
  assert(receipt, 404, "NOT_FOUND", "批量操作不存在或已撤销");
  const results: Result[] = [];
  let remaining = JSON.parse(receipt.payload) as {
    kind?: string;
    id: string;
    version: number;
    tags: string[];
    reviewId?: string;
    stage?: string;
  }[];
  if (!remaining.length)
    run("DELETE FROM batch_edits WHERE id=? AND owner=?", b.id, owner);
  for (const change of [...remaining]) {
    try {
      const next = remaining.filter((item) => item !== change);
      const finish = () => {
        if (next.length)
          run(
            "UPDATE batch_edits SET payload=? WHERE id=? AND owner=?",
            JSON.stringify(next),
            b.id,
            owner,
          );
        else run("DELETE FROM batch_edits WHERE id=? AND owner=?", b.id, owner);
        enforceAccountQuota(owner);
      };
      if (change.kind === "pause")
        transaction(() => {
          getEntry(owner, change.id);
          const review = one(
            "SELECT version FROM reviews WHERE id=? AND owner=?",
            change.reviewId!,
            owner,
          );
          assert(
            review?.version === change.version,
            409,
            "VERSION_CONFLICT",
            "计划已有后续修改，不能自动撤销",
          );
          run(
            "UPDATE reviews SET stage=?,version=version+1 WHERE id=? AND owner=?",
            change.stage!,
            change.reviewId!,
            owner,
          );
          finish();
        });
      else
        updateEntry(
          owner,
          change.id,
          {
            expectedVersion: change.version,
            tags: change.tags,
            manual: true,
          },
          finish,
        );
      remaining = next;
      results.push({ id: change.id, ok: true, message: "已撤销" });
    } catch (error) {
      results.push({
        id: change.id,
        ok: false,
        message: (error as Error).message,
      });
    }
  }
  return { id: b.id, results };
}
