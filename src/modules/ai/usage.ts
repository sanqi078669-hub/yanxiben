import { AsyncLocalStorage } from "node:async_hooks";
export const aiUsage = new AsyncLocalStorage<{
  tokens: number | null;
  input?: number | null;
  output?: number | null;
}>();
