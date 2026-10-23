// Frozen reference algorithms from f3b721e, for same-fixture performance comparison only.
import { all, one } from "../src/lib/db";
import { assert, settings } from "../src/modules/entries/service";
import type { Entry } from "../src/lib/model";
import { errors } from "../src/lib/model";
import { z } from "zod";
import { localDate } from "../src/modules/review/schedule";
import { summarize, statisticsQuery } from "../src/modules/review/statistics";
function unpack(row: Record<string, any>): Entry {
  const { payload, ...rest } = row;
  return { ...rest, ...JSON.parse(payload) } as Entry;
}
function getEntry(owner: string, id: string, deleted = false) {
  const row = one(
    "SELECT * FROM entries WHERE id=? AND owner=?" +
      (deleted ? "" : " AND deleted_at IS NULL"),
    id,
    owner,
  );
  assert(row, 404, "RESOURCE_NOT_FOUND", "记录不存在");
  return unpack(row);
}
export function baselineEntries(owner: string, q: URLSearchParams) {
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(q.get("limit") ?? 20);
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(1000000)
    .parse(q.get("page") ?? 1);
  let rows = all(
    "SELECT * FROM entries WHERE owner=? AND deleted_at IS " +
      (q.get("trash") === "1" ? "NOT NULL" : "NULL") +
      " ORDER BY updated_at DESC,id",
    owner,
  ).map(unpack);
  for (const key of ["type", "subject", "status"] as const) {
    if (q.get(key)) rows = rows.filter((e) => e[key] === q.get(key));
  }
  if (q.get("q")) {
    const query = q.get("q")!.toLowerCase();
    rows = rows.filter((e) =>
      [
        e.title,
        e.body,
        e.summary,
        e.source,
        JSON.stringify(e.details),
        JSON.stringify(e.contexts),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }
  if (q.get("knowledge"))
    rows = rows.filter((e) => e.knowledgeIds.includes(q.get("knowledge")!));
  if (q.get("error"))
    rows = rows.filter((e) => e.errors.includes(q.get("error")!));
  if (q.get("tag"))
    rows = rows.filter((e) =>
      e.tags.includes(q.get("tag")!.trim().toLowerCase()),
    );
  return {
    items: rows.slice((page - 1) * limit, page * limit),
    total: rows.length,
    page,
    limit,
  };
}
export function baselineQueue(owner: string) {
  const s = settings(owner);
  const rows = all(
    "SELECT r.* FROM reviews r JOIN entries e ON e.id=r.entry_id WHERE r.owner=? AND e.deleted_at IS NULL AND r.stage<>'PAUSED' AND r.due_on<=? ORDER BY r.due_on,CASE WHEN (SELECT l.rating FROM logs l WHERE l.review_id=r.id ORDER BY l.created_at DESC LIMIT 1) IN ('AGAIN','HARD') THEN 0 ELSE 1 END,r.id",
    owner,
    localDate(s.timezone),
  );
  return {
    items: rows
      .slice(0, s.dailyLimit)
      .map((r) => ({ ...r, entry: getEntry(owner, r.entry_id) })),
    total: rows.length,
    date: localDate(s.timezone),
  };
}
export function baselineStatistics(owner: string, raw: unknown) {
  const query = statisticsQuery.parse(raw);
  const rows = all(
    `SELECT l.id,e.id entryId,l.local_date date,l.rating,l.mode,l.payload FROM logs l
    JOIN reviews r ON r.id=l.review_id JOIN entries e ON e.id=r.entry_id
    WHERE l.owner=? AND e.owner=? AND e.deleted_at IS NULL AND l.local_date>=? AND l.local_date<=?
    AND (?='' OR e.subject=?) AND (?='' OR l.mode=?) ORDER BY l.created_at,l.id`,
    owner,
    owner,
    query.from,
    query.to,
    query.subject,
    query.subject,
    query.mode,
    query.mode,
  );
  return {
    query,
    ...summarize(
      rows.map((r) => {
        const payload = JSON.parse(r.payload);
        return {
          id: r.id,
          entryId: r.entryId,
          date: r.date,
          rating: r.rating,
          mode: r.mode,
          hint: !!payload.hintUsed,
          errorCauses: Array.isArray(payload.errorCauses)
            ? payload.errorCauses.filter(
                (e: unknown) => typeof e === "string" && errors.includes(e),
              )
            : undefined,
        };
      }),
    ),
  };
}
