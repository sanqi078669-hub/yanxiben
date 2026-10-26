import { z } from "zod";
import { entrySchema } from "./model";
export const draftPrefix = "yanxi-draft-v1:";
export const draftLifetime = 7 * 86400000;
export const draftSchema = z.object({
  owner: z.string().uuid(),
  record: z.string(),
  updated: z.number(),
  version: z.number().int().min(0),
  entry: entrySchema.extend({
    subject: entrySchema.shape.subject.or(z.literal("")),
    tags: z.array(z.string().max(50)).max(30),
  }),
});
export type Draft = z.infer<typeof draftSchema>;
export function readDraft(
  raw: string | null,
  owner: string,
  record: string,
  now = Date.now(),
): Draft | null {
  try {
    const d = draftSchema.parse(JSON.parse(raw || "null"));
    return d.owner === owner &&
      d.record === record &&
      d.updated <= now &&
      now - d.updated < draftLifetime
      ? d
      : null;
  } catch {
    return null;
  }
}
export function clearBrowserDrafts() {
  for (const key of Object.keys(localStorage))
    if (key.startsWith(draftPrefix)) localStorage.removeItem(key);
  for (const key of Object.keys(sessionStorage))
    if (key.startsWith("yanxi-review-v1:") || key === "yanxi-library-position")
      sessionStorage.removeItem(key);
}
