import { z } from "zod";
import {
  entrySchema,
  legacyTemplate,
  type Template,
  type EntryInput,
} from "../../lib/model";

export const extractionSchema = z
  .object({
    type: z.string().trim().min(1).max(100),
    subject: z.string().trim().min(1).max(100),
    title: z.string().max(200),
    body: z.string().min(1).max(30000),
    options: z.array(z.string().max(2000)).max(20),
    warnings: z.array(z.string().max(500)).max(10),
  })
  .strict();
export type Extraction = z.infer<typeof extractionSchema>;

export function extractionPatch(
  result: Extraction,
  existingType?: string,
  template: Template = legacyTemplate(result.type) ?? "GENERIC",
): Pick<EntryInput, "type" | "subject" | "title" | "body" | "details"> {
  if (existingType && existingType !== result.type)
    throw new Error("识别模板与已保存记录不一致，请新建对应模板记录");
  return {
    type: result.type,
    subject: result.subject,
    title: result.title,
    body: result.body,
    details:
      template === "CS"
        ? { subtype: "QUESTION", options_json: JSON.stringify(result.options) }
        : {},
  };
}

export const studyActions = [
  "organize",
  "analyze",
  "hint",
  "feedback",
  "english",
  "variant",
] as const;
export type StudyAction = (typeof studyActions)[number];
export const actionNames: Record<StudyAction, string> = {
  organize: "辅助整理",
  analyze: "错因分析",
  hint: "分步提示",
  feedback: "作答点评",
  english: "英语语境解析",
  variant: "变式练习",
};
export const organizeSchema = z
  .object({
    title: z.string().max(200),
    summary: z.string().max(2000),
    tags: z.array(z.string().trim().min(1).max(50)).max(10),
    knowledgePoints: z.array(z.string().max(100)).max(10),
    warnings: z.array(z.string().max(500)).max(10),
  })
  .strict();
export const analysisSchema = z
  .object({
    feedback: z.string().min(1).max(10000),
    evidence: z.array(z.string().max(2000)).max(10),
    errorTags: z.array(z.string().trim().min(1).max(50)).max(30),
    warnings: z.array(z.string().max(500)).max(10),
  })
  .strict();
export const hintSchema = z
  .object({
    hint: z.string().min(1).max(3000),
    warnings: z.array(z.string().max(500)).max(10),
  })
  .strict();
export const feedbackSchema = z
  .object({
    feedback: z.string().min(1).max(8000),
    strengths: z.array(z.string().max(1000)).max(10),
    missing: z.array(z.string().max(1000)).max(10),
    rating: z.enum(["AGAIN", "HARD", "GOOD", "EASY"]),
    warnings: z.array(z.string().max(500)).max(10),
  })
  .strict();
export function safeRating(rating: string, hintUsed: boolean) {
  return hintUsed && rating === "EASY" ? "GOOD" : rating;
}
export function readableFeedback(text: string) {
  return text
    .replace(/hintUsed\s*=\s*true/g, "本次使用过提示")
    .replace(/hintUsed\s*=\s*false/g, "本次未使用提示")
    .replace(/\bEASY\b/g, "熟练")
    .replace(/\bGOOD\b/g, "掌握")
    .replace(/\bHARD\b/g, "困难")
    .replace(/\bAGAIN\b/g, "不会");
}
export const englishSchema = z
  .object({
    explanation: z.string().min(1).max(6000),
    translation: z.string().max(4000),
    structure: z.string().max(5000),
    wordMeaning: z.string().max(3000),
    collocations: z.array(z.string().max(300)).max(10),
    warnings: z.array(z.string().max(500)).max(10),
  })
  .strict();
export const variantSchema = z
  .object({
    question: z.string().min(1).max(6000),
    solution: z.string().min(1).max(8000),
    knowledgePoints: z.array(z.string().max(100)).max(10),
    warnings: z.array(z.string().max(500)).max(10),
  })
  .strict();
export const studySchemas: Record<StudyAction, z.ZodType> = {
  organize: organizeSchema,
  analyze: analysisSchema,
  hint: hintSchema,
  feedback: feedbackSchema,
  english: englishSchema,
  variant: variantSchema,
};
export const studyPrompts = {
  variant:
    "围绕输入的核心知识点生成一道同类型、条件完备且不同于原题的变式题。自行求解校验，避免含糊或无解的题目；如信息不足说明不确定性。输出 {question:string,solution:string,knowledgePoints:string[],warnings:string[]}。question不得含答案，solution提供完整解答。",
  english:
    "基于原句语境解析英语。生词要解释该语境下词义、词性和搭配；长难句要说明主干、从句、修饰和指代，给出自然译文。没有语境时说明多义性，不虚构出处。输出 {explanation:string,translation:string,structure:string,wordMeaning:string,collocations:string[],warnings:string[]}；不适用字段使用空字符串。",
  feedback:
    "评价本次 answer，不要把历史原解法当成本次作答。独立检查参考答案，指出正确部分和遗漏，建议 AGAIN不会/HARD困难/GOOD掌握/EASY熟练。使用过提示不得建议EASY。输出 {feedback:string,strengths:string[],missing:string[],rating:AGAIN|HARD|GOOD|EASY,warnings:string[]}，说明依据和不确定性。",
  hint: "依据 hintLevel 给出一级提示：1只点出相关概念，2提供解题方向，3提供下一步操作。任何级别都不直接给出最终答案或完整解答。只输出 {hint:string,warnings:string[]}。",
  organize:
    "为输入整理标题、总结与分类建议。不要编造原解法或作答经历；题目不足时明确说明。输出 {title:string,summary:string,tags:string[],knowledgePoints:string[],warnings:string[]}。知识点只作为建议，不声称已添加到知识地图。",
  analyze: (labels: string[]) =>
    "对比用户原解法和参考内容，指出首个错误步骤、原因与修正方向。证据必须引用输入的具体步骤；参考内容也可能错误，要独立检查。若原解法正确请明确说明，不强行归错。输出 {feedback:string,evidence:string[],errorTags:string[],warnings:string[]}。" +
    (labels.length
      ? `errorTags 只能从下列错因名称中选择，不得新造：${JSON.stringify(labels)}。`
      : "用户尚未配置错因，errorTags 必须返回空数组。"),
};
export function originalWork(e: EntryInput) {
  return (
    e.details.original_work_md ||
    e.details.my_answer_md ||
    e.details.initial_translation_md ||
    e.details.analysis_md ||
    ""
  );
}
export function studyMaterial(e: EntryInput, action: StudyAction = "organize") {
  if (action === "hint")
    return {
      type: e.type,
      subject: e.subject,
      body: e.body,
      options: e.details.options_json || "",
    };
  return {
    type: e.type,
    subject: e.subject,
    title: e.title,
    body: e.body,
    summary: e.summary,
    details: e.details,
    errors: e.errors,
    contexts: e.contexts.map(({ sentence_text, meaning_md, collocation }) => ({
      sentence_text,
      meaning_md,
      collocation,
    })),
  };
}
export const studyRequest = z
  .object({
    action: z.enum(studyActions),
    entryId: z.string().uuid().optional(),
    entry: entrySchema,
    answer: z.string().max(10000).default(""),
    hintUsed: z.boolean().default(false),
    hintLevel: z.number().int().min(1).max(3).default(1),
    target: z.string().length(64).optional(),
    consent: z.literal(true),
  })
  .strict();

export function variantDraft(
  entry: EntryInput,
  result: z.infer<typeof variantSchema>,
  template: Template = legacyTemplate(entry.type) ?? "GENERIC",
): EntryInput {
  const solutionKey =
    template === "GENERIC"
      ? "analysis_md"
      : template === "MATH"
        ? "solution_md"
        : template === "CS"
          ? "reference_answer_md"
          : template === "SENTENCE"
            ? "reference_translation_md"
            : "takeaway_md";
  return entrySchema.parse({
    type: entry.type,
    subject: entry.subject,
    title: "AI变式 · " + result.question.replace(/\s+/g, " ").slice(0, 160),
    body: result.question,
    source: "AI生成变式，需人工核对。原记录：" + entry.title.slice(0, 200),
    summary: "",
    status: "INBOX",
    details: {
      [solutionKey]: result.solution,
      ...(template === "CS" ? { subtype: "QUESTION" } : {}),
    },
    tags: ["AI变式"],
  });
}
