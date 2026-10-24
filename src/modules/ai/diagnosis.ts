import { z } from "zod";
import { createHash } from "node:crypto";
import { all } from "../../lib/db";
import { assert } from "../entries/service";
import { complete } from "./provider";
import { limited } from "./service";

export function diagnosisPreview(owner: string) {
  const rows = all(
    "SELECT l.rating,l.mode,l.payload,l.local_date,e.id,e.title,e.subject FROM logs l JOIN reviews r ON r.id=l.review_id JOIN entries e ON e.id=r.entry_id WHERE l.owner=? AND e.owner=? AND e.deleted_at IS NULL ORDER BY l.created_at DESC LIMIT 200",
    owner,
    owner,
  );
  const groups = new Map<
    string,
    {
      id: string;
      title: string;
      subject: string;
      attempts: number;
      again: number;
      hard: number;
      good: number;
      easy: number;
      hints: number;
      practice: number;
    }
  >();
  for (const r of rows) {
    const v = groups.get(r.id) || {
      id: r.id,
      title: r.title,
      subject: r.subject,
      attempts: 0,
      again: 0,
      hard: 0,
      good: 0,
      easy: 0,
      hints: 0,
      practice: 0,
    };
    v.attempts++;
    if (r.rating === "AGAIN") v.again++;
    if (r.rating === "HARD") v.hard++;
    if (r.rating === "GOOD") v.good++;
    if (r.rating === "EASY") v.easy++;
    if (JSON.parse(r.payload).hintUsed) v.hints++;
    if (r.mode === "PRACTICE") v.practice++;
    groups.set(r.id, v);
  }
  const material = {
    scope:
      "仅最近200次练习，按不会/困难次数排序取最多20条记录；不代表完整学习能力评价",
    sampleSize: rows.length,
    distinctEntries: groups.size,
    from: rows.length
      ? rows.map((r) => r.local_date as string).sort()[0]
      : null,
    to: rows.length
      ? rows
          .map((r) => r.local_date as string)
          .sort()
          .at(-1)
      : null,
    smallSample: rows.length < 10 || groups.size < 3,
    entries: [...groups.values()]
      .sort((a, b) => b.again + b.hard - (a.again + a.hard))
      .slice(0, 20),
  };
  return {
    material,
    digest: createHash("sha256").update(JSON.stringify(material)).digest("hex"),
  };
}
export const diagnosisSchema = z
  .object({
    summary: z.string().min(1).max(6000),
    recommendations: z
      .array(
        z
          .object({
            title: z.string().max(200),
            reason: z.string().max(2000),
            nextStep: z.string().max(2000),
            entryIds: z.array(z.string().uuid()).max(20),
          })
          .strict(),
      )
      .max(8),
    warnings: z.array(z.string().max(500)).max(10),
  })
  .strict();
export async function diagnose(
  owner: string,
  raw: unknown,
  transport?: typeof fetch,
) {
  const input = z
      .object({
        digest: z.string(),
        target: z.string().length(64).optional(),
        consent: z.literal(true),
      })
      .strict()
      .parse(raw),
    preview = diagnosisPreview(owner);
  assert(
    input.digest === preview.digest,
    409,
    "AI_PREVIEW_STALE",
    "练习数据已变化，请刷新统计预览",
  );
  assert(
    preview.material.sampleSize > 0,
    400,
    "AI_NO_HISTORY",
    "还没有练习历史，请先完成几次复习再生成诊断",
  );
  const result = await limited(owner, () =>
    complete(
      "sampleSize 是总作答次数；distinctEntries 是采样内不同题目数；entries 是其中最多20题的统计，未列出的题目不得推断。from/to 是实际采样日期范围。smallSample 为真时只描述本次观察和建议下一次练习，不判断长期薄弱点或能力变化。基于给定统计提供温和、可执行的学习建议。只能依据样本，不推测智力、心理或全局能力。区分主动练习与计划复习，解释提示使用的局限。不改变计划。输出 {summary:string,recommendations:[{title,reason,nextStep,entryIds:string[]}],warnings:string[]}。只能引用输入中存在的记录id。",
      preview.material,
      diagnosisSchema,
      [],
      transport,
      owner,
      input.target,
    ),
  );
  const ids = new Set(preview.material.entries.map((e) => e.id));
  assert(
    result.recommendations.every((r) => r.entryIds.every((id) => ids.has(id))),
    502,
    "AI_INVALID_REFERENCE",
    "AI 诊断引用无效，请重试",
  );
  const readable = (text: string) => {
    for (const e of preview.material.entries)
      text = text.replaceAll(e.id, e.title || "未命名记录");
    const labels: Record<string, string> = {
      sampleSize: "采样作答次数",
      attempts: "作答次数",
      hints: "提示次数",
      practice: "主动练习次数",
      again: "不会次数",
      hard: "困难次数",
      good: "掌握次数",
      easy: "熟练次数",
      scope: "统计范围",
      entries: "题目统计",
    };
    return text.replace(
      /\b(sampleSize|attempts|hints|practice|again|hard|good|easy|scope|entries)\b/g,
      (k) => labels[k],
    );
  };
  result.summary = readable(result.summary);
  result.warnings = result.warnings.map(readable);
  result.recommendations = result.recommendations.map((r) => ({
    ...r,
    title: readable(r.title),
    reason: readable(r.reason),
    nextStep: readable(r.nextStep),
  }));
  return result;
}
