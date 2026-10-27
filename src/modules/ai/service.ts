import { z } from "zod";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { one, dataDir } from "../../lib/db";
import {
  assert,
  getEntry,
  hintReviewVersion,
  recordEntryHint,
} from "../entries/service";
import {
  extractionSchema,
  studyRequest,
  studyMaterial,
  studyPrompts,
  studySchemas,
  originalWork,
  safeRating,
  readableFeedback,
} from "./contracts";
import { complete } from "./provider";
import { withImageProcessing } from "../images/processing";
import { aiDictionary } from "./dictionaries";

const running = new Set<string>();
const recent = new Map<string, number[]>();
export async function limited<T>(owner: string, work: () => Promise<T>) {
  assert(
    !running.has(owner),
    429,
    "AI_BUSY",
    "已有 AI 请求正在处理，请等待结果",
  );
  const now = Date.now();
  for (const [key, times] of recent)
    if (!times.some((t) => now - t < 60000)) recent.delete(key);
  const times = (recent.get(owner) || []).filter((t) => now - t < 60000);
  assert(
    times.length < 10,
    429,
    "AI_RATE_LIMITED",
    "AI 请求过于频繁，请一分钟后重试",
  );
  recent.set(owner, [...times, now]);
  running.add(owner);
  try {
    return await work();
  } finally {
    running.delete(owner);
  }
}
export async function study(
  owner: string,
  raw: unknown,
  transport?: typeof fetch,
) {
  const input = studyRequest.parse(raw),
    material = studyMaterial(input.entry, input.action);
  const dictionary = aiDictionary(owner);
  let hintVersion: number | undefined;
  if (input.action === "hint") {
    assert(input.entryId, 400, "AI_ENTRY_REQUIRED", "提示需要绑定已保存的记录");
    const entry = getEntry(owner, input.entryId);
    assert(
      JSON.stringify(studyMaterial(entry, "hint")) === JSON.stringify(material),
      409,
      "VERSION_CONFLICT",
      "记录已变化，请刷新后请求提示",
    );
    hintVersion = hintReviewVersion(owner, input.entryId);
  }
  if (input.action === "english")
    assert(
      ["VOCABULARY", "SENTENCE"].includes(
        dictionary.templateOf(input.entry.type),
      ),
      400,
      "AI_TEMPLATE_MISMATCH",
      "英语解析仅支持生词和长难句模板",
    );
  if (input.action === "analyze")
    assert(
      originalWork(input.entry).trim(),
      400,
      "AI_WORK_REQUIRED",
      "请先填写我的原解法、我的答案或初次理解，再分析具体错因",
    );
  if (input.action === "feedback")
    assert(
      input.answer.trim(),
      400,
      "AI_ANSWER_REQUIRED",
      "请先填写本次独立作答再获取点评",
    );
  assert(
    material.body.trim(),
    400,
    "AI_TEXT_REQUIRED",
    "请先填写题目文字，图片记录请先识别并确认题面",
  );
  assert(
    JSON.stringify(material).length <= 30000,
    400,
    "AI_INPUT_TOO_LONG",
    "本次材料超过 30000 字符，请精简后重试",
  );
  const result: any = await limited(owner, () =>
    complete(
      input.action === "analyze"
        ? studyPrompts.analyze(
            dictionary.active("ERROR").map((item) => item.label),
          )
        : studyPrompts[input.action],
      dictionary.material({
        ...material,
        ...(input.action === "hint" ? { hintLevel: input.hintLevel } : {}),
        ...(input.action === "feedback"
          ? { answer: input.answer, hintUsed: input.hintUsed }
          : {}),
      }),
      studySchemas[input.action],
      [],
      transport,
      owner,
      input.target,
    ),
  );
  if (hintVersion !== undefined)
    recordEntryHint(owner, input.entryId!, hintVersion);
  if (input.action === "analyze") {
    const tags: string[] = [];
    for (const name of result.errorTags) {
      const value = dictionary.valueOf("ERROR", name);
      if (value) tags.push(value);
      else result.warnings.push(`AI 返回了未识别的错因：${name}`);
    }
    result.errorTags = [...new Set(tags)];
  }
  if (input.action === "feedback") {
    result.rating = safeRating(result.rating, input.hintUsed);
    result.feedback = readableFeedback(result.feedback);
    for (const field of ["strengths", "missing", "warnings"])
      result[field] = result[field].map(readableFeedback);
  }
  return result;
}
export async function extract(
  owner: string,
  raw: unknown,
  transport?: typeof fetch,
) {
  const input = z
    .object({
      attachmentIds: z.array(z.string().uuid()).min(1).max(3),
      target: z.string().length(64).optional(),
      consent: z.literal(true),
    })
    .strict()
    .parse(raw);
  const dictionary = aiDictionary(owner);
  assert(
    dictionary.active("TYPE").length,
    400,
    "AI_DICTIONARY_REQUIRED",
    "请先创建类型",
  );
  assert(
    dictionary.active("SUBJECT").length,
    400,
    "AI_DICTIONARY_REQUIRED",
    "请先创建科目",
  );
  return limited(owner, async () => {
    const images: string[] = [];
    for (const id of [...new Set(input.attachmentIds)]) {
      const attachment = one(
        "SELECT * FROM attachments WHERE id=? AND owner=?",
        id,
        owner,
      );
      assert(attachment, 404, "RESOURCE_NOT_FOUND", "图片不存在或无权访问");
      const bytes = await withImageProcessing(() =>
        sharp(readFileSync(path.join(dataDir, "attachments", id)), {
          limitInputPixels: 40000000,
        })
          .resize({
            width: 1600,
            height: 1600,
            fit: "inside",
            withoutEnlargement: true,
          })
          .png()
          .toBuffer(),
      );
      images.push("data:image/png;base64," + bytes.toString("base64"));
    }
    const result = await complete(
      "识别图片中的题目，不解答。逐字保留题干、公式（使用 $ LaTeX $）和选项。多道题请提示分开上传。输出 {type:string,subject:string,title:string,body:string,options:string[],warnings:string[]}。无法辨认的字符写[无法辨认]并在 warnings 说明，不得猜测。" +
        `类型只能从下列名称中选一个，不得新造：${JSON.stringify(dictionary.active("TYPE").map((item) => item.label))}。科目只能从下列名称中选一个，不得新造：${JSON.stringify(dictionary.active("SUBJECT").map((item) => item.label))}。`,
      {},
      extractionSchema,
      images,
      transport,
      owner,
      input.target,
    );
    const type = dictionary.valueOf("TYPE", result.type);
    const subject = dictionary.valueOf("SUBJECT", result.subject);
    assert(type, 422, "AI_UNKNOWN_TYPE", "AI 返回了未识别的类型");
    assert(subject, 422, "AI_UNKNOWN_SUBJECT", "AI 返回了未识别的科目");
    return { ...result, type, subject };
  });
}
