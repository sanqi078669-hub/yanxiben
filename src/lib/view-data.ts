import { z } from "zod";
import { entrySchema } from "./model";

export function parseViewJson<T extends z.ZodType>(
  raw: string,
  schema: T,
): z.infer<T> | null {
  try {
    const value = schema.safeParse(JSON.parse(raw));
    return value.success ? value.data : null;
  } catch {
    return null;
  }
}
export const historyViewSchema = z.object({
  hintUsed: z.boolean(),
  answerMd: z.string(),
  after: z.object({ due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  algorithmVersion: z.string(),
});
export const snapshotViewSchema = entrySchema.extend({
  id: z.string().uuid(),
  owner: z.string().uuid(),
  version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
