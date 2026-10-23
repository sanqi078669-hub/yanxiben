import { z } from "zod";
import { createHash } from "node:crypto";
import { all } from "../../lib/db";
import { getEntry, assert } from "../entries/service";
import { complete } from "./provider";
import { limited } from "./service";
import type { Entry } from "../../lib/model";

const excerpt = (e: Entry) => ({
  id: e.id,
  title: e.title,
  subject: e.subject,
  body: e.body.slice(0, 1800),
  summary: e.summary.slice(0, 600),
  tags: e.tags,
  errors: e.errors,
});
function tokens(text: string) {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]{2}/g) || []).filter(
      (t) => t.length > 1,
    ),
  );
}
export function relatedPreview(
  owner: string,
  id: string,
  mode: "basic" | "semantic" = "basic",
) {
  const entry = getEntry(owner, z.string().uuid().parse(id));
  assert(!entry.deleted_at, 404, "RESOURCE_NOT_FOUND", "记录已删除");
  const words = tokens(entry.body + " " + entry.title + " " + entry.summary);
  const rows = all(
    "SELECT * FROM entries WHERE owner=? AND deleted_at IS NULL AND id<>? AND subject=? ORDER BY updated_at DESC",
    owner,
    id,
    entry.subject,
  );
  const basicCandidates = rows
    .map((row) => ({ ...row, ...JSON.parse(row.payload) }) as Entry)
    .map((e) => ({
      e,
      score:
        e.knowledgeIds.filter((k) => entry.knowledgeIds.includes(k)).length *
          5 +
        e.tags.filter((t) => entry.tags.includes(t)).length * 3 +
        [...tokens(e.body + " " + e.title + " " + e.summary)].filter((w) =>
          words.has(w),
        ).length,
    }))
    .filter((v) => v.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ e }) => excerpt(e));
  // Use the configured language model for semantic comparison instead of requiring
  // a second embedding service. Include records without lexical overlap.
  const candidates =
    mode === "semantic"
      ? [
          ...new Map(
            [
              ...basicCandidates,
              ...rows.map((row) =>
                excerpt({ ...row, ...JSON.parse(row.payload) } as Entry),
              ),
            ].map((e) => [e.id, e]),
          ).values(),
        ].slice(0, 40)
      : basicCandidates;
  const material = {
    entry: excerpt(entry),
    candidates,
    basicIds: basicCandidates.map((e) => e.id),
    mode,
    total: rows.length,
    scope:
      mode === "semantic"
        ? "同科目基础候选加最近更新记录，最多40条；通过当前语言模型比较语义，不使用外部嵌入服务。超出窗口的记录未参与本次比较。"
        : "同科目记录中按文字、标签与知识点匹配的最多8条候选",
  };
  return {
    material,
    digest: createHash("sha256").update(JSON.stringify(material)).digest("hex"),
  };
}
export const relatedSchema = z
  .object({
    matches: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            reason: z.string().min(1).max(2000),
            difference: z.string().max(2000),
          })
          .strict(),
      )
      .max(8),
    warnings: z.array(z.string().max(500)).max(10),
  })
  .strict();
export async function related(
  owner: string,
  raw: unknown,
  transport?: typeof fetch,
) {
  const input = z
      .object({
        entryId: z.string().uuid(),
        digest: z.string(),
        target: z.string().length(64).optional(),
        consent: z.literal(true),
        mode: z.enum(["basic", "semantic"]).optional(),
      })
      .strict()
      .parse(raw),
    preview = relatedPreview(owner, input.entryId, input.mode);
  assert(
    input.digest === preview.digest,
    409,
    "AI_PREVIEW_STALE",
    "候选内容已变化，请刷新预览后重试",
  );
  if (!preview.material.candidates.length)
    return {
      matches: [],
      warnings: ["没有找到可比较的候选，请补充题面、标签或知识点。"],
    };
  const result = await limited(owner, () =>
    complete(
      "依据题意和解法比较题目与所有候选，特别识别措辞不同而解法相同的题，排除仅文字相近而概念不同的题。reason开头注明共同知识点、共同错因、共同解法之一或多项，并解释依据；错因无证据则不要推测。最多返回8条，不够相似则不返回。只能引用候选 id。输出 {matches:[{id:string,reason:string,difference:string}],warnings:string[]}。不要虚构记录。",
      preview.material,
      relatedSchema,
      [],
      transport,
      owner,
      input.target,
    ),
  );
  const ids = new Set(preview.material.candidates.map((e) => e.id));
  assert(
    result.matches.every((m) => ids.has(m.id)) &&
      new Set(result.matches.map((m) => m.id)).size === result.matches.length,
    502,
    "AI_INVALID_REFERENCE",
    "AI 返回了无效记录引用，请重试",
  );
  return result;
}
