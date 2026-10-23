"use client";
import { useState } from "react";
import { aiApi } from "./AiTools";
import { MaterialPreview } from "./MaterialPreview";
import { actionNames, type StudyAction } from "../modules/ai/contracts";
import type { AiAuditRecord as Audit } from "../lib/ai-audit-types";
export function AiFeedback({ id }: { id: string }) {
  const [feedback, setFeedback] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <details>
      <summary>标记建议有误 / 留下反馈</summary>
      <label>
        问题与修正意见
        <textarea
          value={feedback}
          maxLength={2000}
          onChange={(e) => setFeedback(e.target.value)}
        />
      </label>
      <button
        className="button outline"
        disabled={busy || !feedback.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await aiApi("feedback", { id, feedback });
            setMessage(
              "反馈已保存到本地，可在设置的 AI 调用记录中查看。不会发送给服务商。",
            );
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        保存反馈
      </button>
      <p role="status">{message}</p>
    </details>
  );
}
export function AiHistory() {
  const [rows, setRows] = useState<Audit[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [model, setModel] = useState(""),
    [action, setAction] = useState(""),
    [date, setDate] = useState("");
  return (
    <section className="panel form-panel">
      <h2>AI 建议与调用记录</h2>
      <p>
        展示最近 100
        次调用。保存模型建议与反馈，不保存输入题面、原作答或密钥。建议可能含题目相关内容，请妥善保管本机数据。
      </p>
      <button
        className="button outline"
        onClick={async () => {
          try {
            setRows(await aiApi("history"));
            setLoaded(true);
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        读取 / 刷新记录
      </button>
      {error && <p role="alert">{error}</p>}
      {loaded && (
        <>
          <div className="filters">
            <label>
              模型
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">全部模型</option>
                {[...new Set(rows.map((r) => r.model))].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label>
              功能
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
              >
                <option value="">全部功能</option>
                {[...new Set(rows.map((r) => r.action))].map((a) => (
                  <option key={a} value={a}>
                    {actionNames[a.replace("study:", "") as StudyAction] || a}
                  </option>
                ))}
              </select>
            </label>
            <label>
              调用日期（UTC）
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
          <p>
            token
            用量以服务商返回值为准；未返回则为未知。缺少单价或输入/输出用量时无法估算。估算按调用时保存的标准单价计算，未计缓存折扣、税费和优惠，实际费用以账单为准。
          </p>
          {!rows.length && <p>尚无调用记录。</p>}
          {rows
            .filter(
              (r) =>
                (!model || r.model === model) &&
                (!action || r.action === action) &&
                (!date || r.created_at.startsWith(date)),
            )
            .map((r) => (
              <details key={r.id}>
                <summary>
                  {new Date(r.created_at).toLocaleString("zh-CN")} ·{" "}
                  {actionNames[r.action.replace("study:", "") as StudyAction] ||
                    r.action}{" "}
                  · {r.model} · {r.status === "success" ? "成功" : "失败"}
                </summary>
                <p>
                  {r.host} · {r.duration} 毫秒 ·{" "}
                  {r.tokens === null ? "用量未知" : `${r.tokens} tokens`}
                </p>
                {r.cost ? (
                  <p>
                    估算：{r.cost.amount.toFixed(6)} {r.cost.price.currency} ·
                    输入 {r.cost.inputTokens} / 输出 {r.cost.outputTokens}{" "}
                    tokens · 单价 {r.cost.price.input}/{r.cost.price.output}{" "}
                    每百万 token · 生效 {r.cost.price.updated} ·{" "}
                    <a
                      href={r.cost.price.source}
                      target="_blank"
                      rel="noreferrer"
                    >
                      价格依据
                    </a>
                  </p>
                ) : (
                  <p>费用无法估算：未配置价格或缺少输入 / 输出用量。</p>
                )}
                {r.feedback && <p>已记录反馈：{r.feedback}</p>}
                {r.result && <MaterialPreview material={r.result} />}
                <AiFeedback id={r.id} />
              </details>
            ))}
        </>
      )}
    </section>
  );
}
