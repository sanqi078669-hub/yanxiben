"use client";
import { useState } from "react";
import { aiApi } from "./AiTools";
import type { Price } from "../modules/ai/pricing";
export function AiPrices() {
  const [price, setPrice] = useState<Price>({
      model: "",
      host: "",
      currency: "CNY",
      input: 0,
      output: 0,
      source: "",
      updated: new Date().toISOString().slice(0, 10),
    }),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <details className="panel form-panel">
      <summary>设置 AI 费用估算单价</summary>
      <p>
        请按服务商当前价格表填写每百万输入 / 输出 token
        的标准单价，并填写官方价格页和生效日期。仅影响之后的调用；旧记录保留原价格依据。估算不包含缓存折扣、阶梯价、税费及其他优惠，实际费用以账单为准。
      </p>
      <button
        className="button outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const status = await aiApi("status"),
              prices = (await aiApi("prices")) as Price[];
            setPrice(
              prices.find(
                (p) => p.model === status.model && p.host === status.host,
              ) || {
                ...price,
                model: status.model || "",
                host: status.host || "",
              },
            );
            setMessage("已读取当前模型及已保存单价，请核对服务商价格表。");
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        读取当前模型与单价
      </button>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await aiApi("prices", price);
            setMessage("价格已保存，之后匹配模型与主机的调用将按此价格估算。");
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {(
          [
            ["model", "模型名称"],
            ["host", "接口主机（如 api.deepseek.com）"],
            ["source", "官方价格页 HTTPS 地址"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              required
              value={price[key]}
              onChange={(e) => setPrice({ ...price, [key]: e.target.value })}
            />
          </label>
        ))}
        <label>
          币种
          <select
            value={price.currency}
            onChange={(e) =>
              setPrice({
                ...price,
                currency: e.target.value as Price["currency"],
              })
            }
          >
            <option>CNY</option>
            <option>USD</option>
          </select>
        </label>
        {(["input", "output"] as const).map((key) => (
          <label key={key}>
            {key === "input" ? "输入" : "输出"}单价 / 百万 token
            <input
              required
              type="number"
              step="any"
              min="0"
              value={price[key]}
              onChange={(e) =>
                setPrice({ ...price, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
        <label>
          价格生效日期
          <input
            required
            type="date"
            value={price.updated}
            onChange={(e) => setPrice({ ...price, updated: e.target.value })}
          />
        </label>
        <button className="button" disabled={busy}>
          保存估算单价
        </button>
        <p role="status">{message}</p>
      </form>
    </details>
  );
}
