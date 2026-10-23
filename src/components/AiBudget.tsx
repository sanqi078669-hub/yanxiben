"use client";
import { useEffect, useState } from "react";
import { aiApi } from "./AiTools";
import type { AiLimits } from "../lib/ai-limits";
type Status = {
  day: string;
  calls: number;
  limits: AiLimits;
  amounts: {
    currency: string;
    calls: number;
    spent: number;
    unknown: number;
  }[];
};
export function AiBudget() {
  const [status, setStatus] = useState<Status | null>(null),
    [calls, setCalls] = useState(100),
    [cap, setCap] = useState(""),
    [currency, setCurrency] = useState<"CNY" | "USD">("CNY"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    const value: Status = await aiApi("budget");
    setStatus(value);
    setCalls(value.limits.dailyCalls);
    setCap(value.limits.dailyCost ? String(value.limits.dailyCost.amount) : "");
    setCurrency(value.limits.dailyCost?.currency || "CNY");
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel form-panel">
      <h2>AI 每日用量限制</h2>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {status && (
        <>
          <p>
            {status.day}（学习设置时区）：已发起 {status.calls} 次调用。
          </p>
          {status.amounts.map((row) => (
            <p key={row.currency}>
              {row.currency === "UNKNOWN" ? "未配置单价" : row.currency}
              ：已知估算费用 {row.spent.toFixed(6)}，未知费用调用 {row.unknown}{" "}
              次。
            </p>
          ))}
        </>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setMessage("");
          try {
            await aiApi("config", {
              action: "limits",
              limits: {
                dailyCalls: calls,
                dailyCost:
                  cap === "" ? null : { amount: Number(cap), currency },
              },
            });
            await load();
            setMessage("AI 用量限制已保存");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          每日调用次数
          <input
            type="number"
            min={1}
            max={10000}
            required
            value={calls}
            onChange={(e) => setCalls(Number(e.target.value))}
          />
        </label>
        <label>
          每日估算费用阈值（留空不启用）
          <input
            type="number"
            min="0.000001"
            max={100000}
            step="any"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
          />
        </label>
        <label>
          费用币种
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as "CNY" | "USD")}
          >
            <option value="CNY">CNY</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <p className="muted">
          次数包括失败的发送尝试与连接测试。费用按配置的单价估算，达到阈值后停止后续调用，单次调用可能超过剩余额度。缺少匹配单价、币种不符或当天存在未知费用时，启用费用阈值会阻止发送。最终费用以服务商账单为准。
        </p>
        <button className="button outline" disabled={busy || !status}>
          保存用量限制
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() =>
            load()
              .then(() => setError(""))
              .catch((e) => setError(e.message))
          }
        >
          刷新今日用量
        </button>
      </form>
    </section>
  );
}
