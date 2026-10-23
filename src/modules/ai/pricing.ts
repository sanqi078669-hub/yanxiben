import { z } from "zod";
import { all, one, run } from "../../lib/db";
export const priceSchema = z
  .object({
    model: z.string().trim().min(1).max(150),
    host: z.string().trim().min(1).max(200),
    currency: z.enum(["CNY", "USD"]),
    input: z.number().finite().nonnegative().max(100000),
    output: z.number().finite().nonnegative().max(100000),
    source: z.string().url().startsWith("https://").max(1000),
    updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type Price = z.infer<typeof priceSchema>;
export const costSchema = z
  .object({
    amount: z.number().finite().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    price: priceSchema,
  })
  .strict();
function init() {
  run(
    "CREATE TABLE IF NOT EXISTS ai_prices(owner TEXT NOT NULL,model TEXT NOT NULL,host TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner,model,host))",
  );
}
export function priceList(owner: string) {
  init();
  return all("SELECT payload FROM ai_prices WHERE owner=?", owner).map((r) =>
    priceSchema.parse(JSON.parse(r.payload)),
  );
}
export function savePrice(owner: string, raw: unknown) {
  init();
  const price = priceSchema.parse(raw);
  run(
    "INSERT OR REPLACE INTO ai_prices VALUES(?,?,?,?)",
    owner,
    price.model,
    price.host,
    JSON.stringify(price),
  );
  return price;
}
export function estimate(
  owner: string,
  model: string,
  host: string,
  input: number | null | undefined,
  output: number | null | undefined,
) {
  init();
  if (input == null || output == null) return null;
  const row = one(
    "SELECT payload FROM ai_prices WHERE owner=? AND model=? AND host=?",
    owner,
    model,
    host,
  );
  if (!row) return null;
  const price = priceSchema.parse(JSON.parse(row.payload));
  return {
    amount: (input * price.input + output * price.output) / 1e6,
    inputTokens: input,
    outputTokens: output,
    price,
  };
}
