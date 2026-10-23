import { randomUUID } from "node:crypto";
import { all, one, run, transaction } from "../../lib/db";
import { assert, settings } from "../entries/service";
import { localDate } from "../review/schedule";
import { configuredLimits } from "./config";
import { priceList, type Price } from "./pricing";

export function pricedUsage(
  price: Price | undefined,
  input: number | null | undefined,
  output: number | null | undefined,
) {
  return price && input != null && output != null
    ? {
        amount: (input * price.input + output * price.output) / 1e6,
        inputTokens: input,
        outputTokens: output,
        price,
      }
    : null;
}
export function budgetStatus(owner: string) {
  const day = localDate(settings(owner).timezone);
  const rows = all(
    "SELECT currency,calls,spent,unknown FROM ai_daily_budget WHERE owner=? AND day=?",
    owner,
    day,
  );
  return {
    day,
    limits: configuredLimits(owner),
    calls: rows.reduce((n, row) => n + row.calls, 0),
    amounts: rows,
  };
}
/** Reserve a call before sending, serialize each account across server processes.
 * Unknown charges stay unknown, including interrupted/crashed calls. */
export function reserveBudget(owner: string, model: string, host: string) {
  const id = randomUUID(),
    now = Date.now(),
    status = budgetStatus(owner);
  const price = priceList(owner).find(
    (p) => p.model === model && p.host === host,
  );
  const currency = price?.currency || "UNKNOWN",
    cap = status.limits.dailyCost;
  transaction(() => {
    const active = one(
      "SELECT expires FROM ai_budget_active WHERE owner=?",
      owner,
    );
    assert(
      !active || active.expires <= now,
      429,
      "AI_BUSY",
      "已有 AI 请求正在处理，请等待结果",
    );
    const rows = all(
      "SELECT currency,calls,spent,unknown FROM ai_daily_budget WHERE owner=? AND day=?",
      owner,
      status.day,
    );
    assert(
      rows.reduce((n, r) => n + r.calls, 0) < status.limits.dailyCalls,
      429,
      "AI_DAILY_CALL_LIMIT",
      "已达到每日 AI 调用次数限制，可在设置调整或明天继续",
    );
    if (cap) {
      assert(
        price && price.currency === cap.currency,
        400,
        "AI_PRICE_REQUIRED",
        "费用限制需要当前模型与币种匹配的单价，请先配置价格",
      );
      assert(
        !rows.some((r) => r.unknown > 0),
        409,
        "AI_COST_UNKNOWN",
        "今天存在未知费用的调用，无法可靠执行费用限制；请核对服务商账单后调整限制，或明天继续",
      );
      const spent = rows
        .filter((r) => r.currency === cap.currency)
        .reduce((n, r) => n + r.spent, 0);
      assert(
        spent < cap.amount,
        429,
        "AI_DAILY_COST_LIMIT",
        "已达到每日 AI 估算费用限制，可在设置调整或明天继续",
      );
    }
    run(
      "INSERT OR REPLACE INTO ai_budget_active VALUES(?,?,?)",
      owner,
      id,
      now + 240000,
    );
    run(
      "INSERT INTO ai_daily_budget VALUES(?,?,?,1,0,1) ON CONFLICT(owner,day,currency) DO UPDATE SET calls=calls+1,unknown=unknown+1",
      owner,
      status.day,
      currency,
    );
  });
  let finished = false;
  return (
    input: number | null | undefined,
    output: number | null | undefined,
  ) => {
    const cost = pricedUsage(price, input, output);
    if (finished) return cost;
    transaction(() => {
      if (cost)
        run(
          "UPDATE ai_daily_budget SET spent=spent+?,unknown=unknown-1 WHERE owner=? AND day=? AND currency=?",
          cost.amount,
          owner,
          status.day,
          currency,
        );
      run("DELETE FROM ai_budget_active WHERE owner=? AND id=?", owner, id);
    });
    finished = true;
    return cost;
  };
}
