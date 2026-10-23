"use client";
import { useState } from "react";
import Link from "next/link";
import { aiApi } from "./AiTools";
import { MaterialPreview } from "./MaterialPreview";
export function AiDiagnosis() {
  const [preview, setPreview] = useState<any>(null),
    [status, setStatus] = useState<any>(null),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false);
  return (
    <section className="panel form-panel ai-panel">
      <h2>AI 学习诊断</h2>
      <p role="status">
        {busy
          ? "正在准备学习观察…"
          : result
            ? "学习观察已生成，请结合样本范围查看。"
            : ""}
      </p>
      <p>
        依据最近 200 次练习的统计提出建议，不自动改变复习计划。分析最多 20
        条记录，样本有限时会说明。
      </p>
      <button
        className="button outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          setResult(null);
          setConsent(false);
          try {
            setStatus(await aiApi("status"));
            setPreview(await aiApi("diagnosis"));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        准备 / 刷新学习统计
      </button>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {preview && (
        <>
          <p>
            采样 {preview.material.sampleSize} 次练习 · 当前模型：
            {status?.model || "未配置"} · {status?.host}
          </p>
          <p>
            实际采样日期：{preview.material.from || "暂无"} 至{" "}
            {preview.material.to || "暂无"} · 涉及{" "}
            {preview.material.distinctEntries} 道题 · 发送{" "}
            {preview.material.entries.length} 道题的统计
          </p>
          {preview.material.smallSample && (
            <p role="note">
              样本不足 10 次或少于 3
              道题，仅提供练习观察，不据此判断长期薄弱点。
            </p>
          )}
          {!preview.material.sampleSize && (
            <p>先完成几次复习，再查看学习建议。</p>
          )}
          <details>
            <summary>查看将发送的记录标题与统计（不含作答原文）</summary>
            <MaterialPreview material={preview.material} />
          </details>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            同意将这些学习统计发送至当前 AI 服务
          </label>
          <button
            className="button outline"
            disabled={
              busy || !consent || !status?.ready || !preview.material.sampleSize
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                setResult(
                  await aiApi("diagnosis", {
                    digest: preview.digest,
                    target: status.target,
                    consent: true,
                  }),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "正在分析…"
              : preview.material.smallSample
                ? "生成本次练习观察"
                : "生成学习诊断"}
          </button>
        </>
      )}
      {result && (
        <div className="ai-result">
          <pre>{result.summary}</pre>
          {result.recommendations.map((r: any, i: number) => (
            <article key={i}>
              <h3>{r.title}</h3>
              <p>依据：{r.reason}</p>
              <p>下一步：{r.nextStep}</p>
              {r.entryIds.map((id: string) => (
                <p key={id}>
                  <Link href={"/entries/" + id}>
                    {preview.material.entries.find((e: any) => e.id === id)
                      ?.title || "查看记录"}
                  </Link>
                </p>
              ))}
            </article>
          ))}
          {result.warnings.map((w: string, i: number) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}
    </section>
  );
}
