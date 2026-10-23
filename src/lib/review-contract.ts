import { z } from "zod";
import { errors } from "./model";

export const REVIEW_ANSWER_MAX_LENGTH = 50000;
export const reviewAttemptSchema = z
  .object({
    expectedVersion: z.number().int(),
    mode: z.enum(["SCHEDULED", "PRACTICE"]),
    rating: z.enum(["AGAIN", "HARD", "GOOD", "EASY"]),
    hintUsed: z.boolean(),
    answerMd: z.string().max(REVIEW_ANSWER_MAX_LENGTH),
    errorCauses: z
      .array(z.enum(errors as [string, ...string[]]))
      .max(6)
      .optional(),
  })
  .strict();

/** These responses mean validation failed before committing the attempt. */
export function submissionWasRejected(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const { status, code } = error as { status?: number; code?: string };
  return (
    [400, 413, 415, 422].includes(status || 0) ||
    (status === 409 &&
      [
        "VERSION_CONFLICT",
        "ALREADY_REVIEWED_TODAY",
        "PAUSED",
        "NOT_DUE",
        "IDEMPOTENCY_CONFLICT",
      ].includes(code || ""))
  );
}
