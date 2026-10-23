import { z } from "zod";
export const aiLimitsSchema = z
  .object({
    dailyCalls: z.number().int().min(1).max(10000).default(100),
    dailyCost: z
      .object({
        amount: z.number().finite().positive().max(100000),
        currency: z.enum(["CNY", "USD"]),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export type AiLimits = z.infer<typeof aiLimitsSchema>;
export const defaultAiLimits: AiLimits = { dailyCalls: 100, dailyCost: null };
