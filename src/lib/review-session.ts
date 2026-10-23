import { z } from "zod";
import { errors } from "./model";
const causes = z.array(z.enum(errors as [string,...string[]])).max(6);

const rating = z.enum(["AGAIN", "HARD", "GOOD", "EASY"]);
export const attemptBody = z.object({
  expectedVersion: z.number().int(), mode: z.enum(["SCHEDULED", "PRACTICE"]),
  rating, hintUsed: z.boolean(), answerMd: z.string().max(100000),
  errorCauses: causes.optional(),
});
const schema = z.object({
  owner: z.string().uuid(), scope: z.string(), updated: z.number(),
  reviewId: z.string().uuid(), entryId: z.string().uuid(), title: z.string(),
  version: z.number().int(), mode: z.enum(["SCHEDULED", "PRACTICE"]), answer: z.string().max(100000), revealed: z.boolean(),
  hint: z.boolean(), aiHint: z.boolean(), rating, key: z.string().uuid(),
  errorCauses: causes.nullable().optional(),
  pending: z.object({ body: attemptBody, key: z.string().uuid() }).nullable(),
});
export type ReviewSession = z.infer<typeof schema>;
export function readReviewSession(raw: string | null, owner: string, scope: string, now = Date.now()) {
  try {
    const value = schema.parse(JSON.parse(raw || "null"));
    if (value.owner !== owner || value.scope !== scope || value.updated > now || now - value.updated > 7 * 86400000) return null;
    // A hint is sticky across reloads, including the period before a pending request.
    value.hint ||= value.aiHint || !!value.pending?.body.hintUsed;
    if (value.hint && value.rating === "EASY") value.rating = "GOOD";
    return value;
  } catch { return null; }
}
