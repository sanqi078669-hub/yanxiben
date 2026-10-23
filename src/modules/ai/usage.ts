import { AsyncLocalStorage } from "node:async_hooks";
import type { costSchema } from "./pricing";
import type { z } from "zod";
export const aiUsage = new AsyncLocalStorage<{
  tokens: number | null;
  input?: number | null;
  output?: number | null;
  cost?: z.infer<typeof costSchema> | null;
}>();
