import { z } from "zod";
import { errors } from "./model";
import {
  REVIEW_ANSWER_MAX_LENGTH,
  reviewAttemptSchema,
} from "./review-contract";
export const attemptBody = reviewAttemptSchema;
// Read-only compatibility for drafts written before the 50k contract was shared.
const legacyLimit = 100000;
const schema = z.object({
  formatVersion: z.literal(2).optional(),
  owner: z.string().uuid(),
  scope: z.string(),
  updated: z.number(),
  reviewId: z.string().uuid(),
  entryId: z.string().uuid(),
  title: z.string(),
  version: z.number().int(),
  mode: z.enum(["SCHEDULED", "PRACTICE"]),
  answer: z.string().max(REVIEW_ANSWER_MAX_LENGTH),
  recoveryAnswer: z.string().max(legacyLimit).optional(),
  revealed: z.boolean(),
  hint: z.boolean(),
  aiHint: z.boolean(),
  rating: z.enum(["AGAIN", "HARD", "GOOD", "EASY"]),
  key: z.string().uuid(),
  errorCauses: z
    .array(z.enum(errors as [string, ...string[]]))
    .max(6)
    .nullable()
    .optional(),
  pending: z.object({ body: attemptBody, key: z.string().uuid() }).nullable(),
});
const legacySchema = schema.extend({
  formatVersion: z.undefined(),
  answer: z.string().max(legacyLimit),
  pending: z
    .object({
      body: attemptBody.extend({ answerMd: z.string().max(legacyLimit) }),
      key: z.string().uuid(),
    })
    .nullable(),
});
export type ReviewSession = z.infer<typeof schema>;
export function reviewSessionSnapshot(value: ReviewSession) {
  const { recoveryAnswer: _previous, ...rest } = value;
  return {
    ...rest,
    formatVersion: 2 as const,
    answer: value.answer.length > REVIEW_ANSWER_MAX_LENGTH ? "" : value.answer,
    ...(value.answer.length > REVIEW_ANSWER_MAX_LENGTH
      ? { recoveryAnswer: value.answer }
      : {}),
  };
}
export function readReviewSession(
  raw: string | null,
  owner: string,
  scope: string,
  now = Date.now(),
): ReviewSession | null {
  try {
    const parsed: unknown = JSON.parse(raw || "null");
    const current = schema.safeParse(parsed);
    const value = current.success ? current.data : legacySchema.parse(parsed);
    if (
      value.owner !== owner ||
      value.scope !== scope ||
      value.updated > now ||
      now - value.updated > 7 * 86400000
    )
      return null;
    value.hint ||= value.aiHint || !!value.pending?.body.hintUsed;
    if (value.hint && value.rating === "EASY") value.rating = "GOOD";
    // Over-limit legacy requests never passed the server's pre-write schema.
    if (
      value.pending &&
      value.pending.body.answerMd.length > REVIEW_ANSWER_MAX_LENGTH
    ) {
      value.answer = value.pending.body.answerMd;
      value.pending = null;
    }
    return {
      ...value,
      formatVersion: 2,
      answer: value.recoveryAnswer ?? value.answer,
    };
  } catch {
    return null;
  }
}
