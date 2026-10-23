import { z } from "zod";
export const types = ["MATH", "CS", "VOCABULARY", "SENTENCE"] as const;
export const names = {
  MATH: "数学错题",
  CS: "408 专业课",
  VOCABULARY: "英语生词",
  SENTENCE: "英语长难句",
};
export const subjects = [
  "高等数学",
  "数据结构",
  "计算机组成原理",
  "操作系统",
  "计算机网络",
  "英语",
];
export const errors = ["概念", "条件", "方法", "计算", "审题", "表达"];
export const fields: Record<string, [string, string][]> = {
  MATH: [
    ["original_work_md", "我的原解法"],
    ["error_step_md", "错误步骤"],
    ["solution_md", "正确解法"],
    ["applicability_md", "适用条件"],
    ["decision_rule_md", "方法选择"],
    ["takeaway_md", "可复用总结"],
  ],
  CS: [
    ["my_answer_md", "我的答案 / 原理解"],
    ["reference_answer_md", "参考答案"],
    ["principle_md", "原理与推理"],
    ["comparison_md", "易混概念"],
    ["boundary_md", "边界与反例"],
    ["self_explanation_md", "自己的解释"],
  ],
  VOCABULARY: [
    ["lemma", "词条原形"],
    ["surface_form", "原词形"],
    ["part_of_speech", "词性"],
    ["takeaway_md", "个人总结"],
  ],
  SENTENCE: [
    ["context_md", "上下文"],
    ["initial_translation_md", "初次理解"],
    ["main_clause_md", "句子主干"],
    ["clause_analysis_md", "从句与结构"],
    ["reference_logic_md", "指代与逻辑"],
    ["reference_translation_md", "参考译文"],
    ["difficulty_md", "理解障碍"],
  ],
};
const str = z.string().max(50000);
export const contextSchema = z
  .object({
    sentence_text: str,
    meaning_md: str,
    source: str,
    collocation: str,
    sentence_entry_id: z.string().uuid().or(z.literal("")).default(""),
  })
  .strict();
export const entrySchema = z
  .object({
    type: z.enum(types),
    title: z.string().trim().max(200),
    subject: z.enum(subjects as [string, ...string[]]),
    body: str,
    source: z.string().max(2000).default(""),
    summary: str.default(""),
    status: z.enum(["INBOX", "ORGANIZED"]).default("INBOX"),
    details: z.record(z.string(), str).default({}),
    contexts: z.array(contextSchema).max(100).default([]),
    knowledgeIds: z.array(z.string().uuid()).max(100).default([]),
    tags: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
    errors: z.array(z.enum(errors as [string, ...string[]])).default([]),
    attachments: z
      .array(
        z
          .object({ id: z.string().uuid(), role: z.enum(["PROMPT", "ANSWER"]) })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict();
export type EntryInput = z.infer<typeof entrySchema>;
export type Entry = EntryInput & {
  id: string;
  owner: string;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
export type Review = {
  id: string;
  entry_id: string;
  owner: string;
  stage: string;
  stage_index: number;
  success_streak: number;
  due_on: string;
  version: number;
};
export const settingsSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "无效时区"),
    dailyLimit: z.number().int().min(1).max(200),
    intervals: z
      .array(z.number().int().min(1).max(365))
      .length(6)
      .refine((v) => v.every((x, i) => !i || x > v[i - 1]), "间隔必须递增"),
  })
  .strict();
export const defaults = {
  displayName: "学习者",
  timezone: "Asia/Shanghai",
  dailyLimit: 20,
  intervals: [1, 3, 7, 14, 30, 60],
};
