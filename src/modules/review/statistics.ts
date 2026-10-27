import { z } from "zod";
import { db } from "../../lib/db";
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const date = new Date(v + "T00:00:00Z");
    return (
      Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v
    );
  });
export const statisticsQuery = z
  .object({
    from: day,
    to: day,
    subject: z.string().trim().max(100).default(""),
    mode: z.enum(["", "PRACTICE", "SCHEDULED"]).default(""),
  })
  .refine((v) => v.from <= v.to, "起始日期不能晚于结束日期");
export type StatisticRow = {
  id: string;
  entryId: string;
  date: string;
  rating: string;
  mode: string;
  hint: boolean;
  errorCauses?: string[];
};
export function summarize(rows: Iterable<StatisticRow>) {
  const seen = new Set<string>(),
    previous = new Map<string, boolean>();
  let total = 0,
    independent = 0,
    hints = 0,
    practice = 0,
    repeated = 0,
    repeatBase = 0;
  const monthly: Record<
    string,
    { total: number; independent: number; hints: number; difficult: number }
  > = {};
  const errorMonthly: Record<
    string,
    { known: number; unknown: number; counts: Record<string, number> }
  > = {};
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    total++;
    const bad = ["AGAIN", "HARD"].includes(row.rating),
      good = ["GOOD", "EASY"].includes(row.rating) && !row.hint;
    if (previous.has(row.entryId)) {
      repeatBase++;
      if (previous.get(row.entryId) && bad) repeated++;
    }
    previous.set(row.entryId, bad);
    if (good) independent++;
    if (row.hint) hints++;
    if (row.mode === "PRACTICE") practice++;
    const month = row.date.slice(0, 7),
      m = (monthly[month] ||= {
        total: 0,
        independent: 0,
        hints: 0,
        difficult: 0,
      });
    const em = (errorMonthly[month] ||= {
      known: 0,
      unknown: 0,
      counts: Object.create(null) as Record<string, number>,
    });
    if (row.errorCauses) {
      em.known++;
      for (const e of new Set(row.errorCauses))
        if (e.trim()) em.counts[e] = (em.counts[e] ?? 0) + 1;
    } else em.unknown++;
    m.total++;
    if (good) m.independent++;
    if (row.hint) m.hints++;
    if (bad) m.difficult++;
  }
  return {
    total,
    entries: previous.size,
    independent,
    hints,
    practice,
    scheduled: total - practice,
    repeated,
    repeatBase,
    monthly,
    errorMonthly,
  };
}
export function learningStatistics(owner: string, raw: unknown) {
  const query = statisticsQuery.parse(raw);
  const where = [
    "l.owner=?",
    "e.owner=?",
    "e.deleted_at IS NULL",
    "l.local_date>=?",
    "l.local_date<=?",
  ];
  const args: string[] = [owner, owner, query.from, query.to];
  if (query.subject) {
    where.push("e.subject=?");
    args.push(query.subject);
  }
  if (query.mode) {
    where.push("l.mode=?");
    args.push(query.mode);
  }
  const statement =
    db.prepare(`SELECT l.id,e.id entryId,l.local_date date,l.rating,l.mode,
    coalesce(json_extract(l.payload,'$.hintUsed'),0) hint,
    CASE WHEN json_type(l.payload,'$.errorCauses')='array' THEN json_extract(l.payload,'$.errorCauses') ELSE NULL END causes
    FROM logs l JOIN reviews r ON r.id=l.review_id AND r.owner=l.owner JOIN entries e ON e.id=r.entry_id
    WHERE ${where.join(" AND ")} ORDER BY l.created_at,l.id`);
  function* rows(): Generator<StatisticRow> {
    for (const r of statement.iterate(...args))
      yield {
        id: r.id as string,
        entryId: r.entryId as string,
        date: r.date as string,
        rating: r.rating as string,
        mode: r.mode as string,
        hint: !!r.hint,
        errorCauses:
          r.causes === null
            ? undefined
            : (JSON.parse(r.causes as string) as unknown[]).filter(
                (e): e is string => typeof e === "string" && !!e.trim(),
              ),
      };
  }
  // Keep ordered repeat semantics while streaming only the required fields.
  // Avoid materializing all answer payloads or a large SQLite window temp table.
  return { query, ...summarize(rows()) };
}
