import { z } from "zod";
import { all } from "../../lib/db";
import { subjects, errors } from "../../lib/model";
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const date = new Date(v + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === v;
});
export const statisticsQuery = z.object({from: day, to: day, subject: z.enum(["", ...subjects] as [string,...string[]]).default(""), mode: z.enum(["", "PRACTICE", "SCHEDULED"]).default("")}).refine(v => v.from <= v.to, "起始日期不能晚于结束日期");
export type StatisticRow = {id: string; entryId: string; date: string; rating: string; mode: string; hint: boolean; errorCauses?: string[]};
export function summarize(rows: StatisticRow[]) {
  const seen = new Set<string>(), previous = new Map<string, boolean>();
  let total = 0, independent = 0, hints = 0, practice = 0, repeated = 0, repeatBase = 0;
  const monthly: Record<string, {total:number; independent:number; hints:number; difficult:number}> = {};
  const errorMonthly: Record<string, {known:number; unknown:number; counts:Record<string,number>}> = {};
  for (const row of rows) {
    if(seen.has(row.id)) continue;
    seen.add(row.id); total++;
    const bad = ["AGAIN", "HARD"].includes(row.rating), good = ["GOOD", "EASY"].includes(row.rating) && !row.hint;
    if(previous.has(row.entryId)) { repeatBase++; if(previous.get(row.entryId) && bad) repeated++; }
    previous.set(row.entryId, bad);
    if(good) independent++;
    if(row.hint) hints++;
    if(row.mode === "PRACTICE") practice++;
    const month = row.date.slice(0,7), m = monthly[month] ||= {total:0,independent:0,hints:0,difficult:0};
    const em = errorMonthly[month] ||= {known:0,unknown:0,counts:Object.fromEntries(errors.map(e=>[e,0]))};
    if (row.errorCauses) { em.known++; for (const e of new Set(row.errorCauses)) if(errors.includes(e)) em.counts[e]++; }
    else em.unknown++;
    m.total++; if(good)m.independent++; if(row.hint)m.hints++; if(bad)m.difficult++;
  }
  return {total, entries:previous.size, independent, hints, practice, scheduled:total-practice, repeated, repeatBase, monthly, errorMonthly};
}
export function learningStatistics(owner: string, raw: unknown) {
  const query = statisticsQuery.parse(raw);
  const rows = all(`SELECT l.id,e.id entryId,l.local_date date,l.rating,l.mode,l.payload FROM logs l
    JOIN reviews r ON r.id=l.review_id JOIN entries e ON e.id=r.entry_id
    WHERE l.owner=? AND e.owner=? AND e.deleted_at IS NULL AND l.local_date>=? AND l.local_date<=?
    AND (?='' OR e.subject=?) AND (?='' OR l.mode=?) ORDER BY l.created_at,l.id`, owner,owner,query.from,query.to,query.subject,query.subject,query.mode,query.mode);
  return {query, ...summarize(rows.map(r => { const payload = JSON.parse(r.payload); return {id:r.id,entryId:r.entryId,date:r.date,rating:r.rating,mode:r.mode,hint:!!payload.hintUsed,errorCauses:Array.isArray(payload.errorCauses) ? payload.errorCauses.filter((e:unknown)=> typeof e === "string" && errors.includes(e)) : undefined}; }))};
}
