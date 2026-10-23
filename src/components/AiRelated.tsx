"use client";
import { useState } from "react";
import Link from "next/link";
import { aiApi } from "./AiTools";
import { MaterialPreview } from "./MaterialPreview";
import type { relatedPreview, relatedSchema } from "../modules/ai/related";
import type { z } from "zod";

export function AiRelated({
  entryId,
  onLinked,
}: {
  entryId: string;
  onLinked: () => void;
}) {
  const [mode, setMode] = useState<"basic" | "semantic">("semantic");
  const [preview, setPreview] = useState<ReturnType<
      typeof relatedPreview
    > | null>(null),
    [status, setStatus] = useState<any>(null),
    [result, setResult] = useState<z.infer<typeof relatedSchema> | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [linked, setLinked] = useState<string[]>([]);
  async function prepare() {
    setBusy(true);
    setError("");
    setResult(null);
    setConsent(false);
    try {
      setStatus(await aiApi("status"));
      setPreview(
        await aiApi("related?" + new URLSearchParams({ entryId, mode })),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel form-panel ai-panel">
      <h2>AI 相似错题</h2>
      <p>
        基础检索按文字、标签与知识点匹配；语义比较额外纳入没有关键词重合的近期同科目题目，最多
        40 条。确认后发送预览摘录，可能产生费用；仅比较窗口内的记录。
      </p>
      <label>
        候选范围
        <select
          value={mode}
          disabled={busy}
          onChange={(e) => {
            setMode(e.target.value as "basic" | "semantic");
            setPreview(null);
            setResult(null);
            setConsent(false);
          }}
        >
          <option value="semantic">语义比较（最多 40 条）</option>
          <option value="basic">基础匹配（最多 8 条）</option>
        </select>
      </label>
      <button className="button outline" disabled={busy} onClick={prepare}>
        准备 / 刷新候选预览
      </button>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <>
          {error && (
            <div role="status">
              <p>
                AI
                比较暂不可用，可查看基础匹配候选，或将候选范围切换为基础匹配后重试：
              </p>
              {preview.material.candidates
                .filter((e) => preview.material.basicIds.includes(e.id))
                .map((e) => (
                  <p key={e.id}>
                    <Link href={"/entries/" + e.id}>
                      {e.title || e.body.slice(0, 40) || "查看记录"}
                    </Link>
                  </p>
                ))}
            </div>
          )}
          <p>
            同科目共 {preview.material.total} 条，本次候选{" "}
            {preview.material.candidates.length} 条。当前模型：
            {status?.model || "未配置"} · {status?.host}
          </p>
          {preview.material.candidates.map((e: any) => (
            <p key={e.id}>
              <Link href={"/entries/" + e.id}>{e.title || "未命名记录"}</Link>
            </p>
          ))}
          <details>
            <summary>查看将发送的题面与候选摘录</summary>
            <div className="ai-preview">
              <MaterialPreview material={preview.material} />
            </div>
          </details>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            同意发送这些摘录至当前 AI 服务
          </label>
          <button
            className="button outline"
            disabled={
              busy ||
              !consent ||
              !status?.ready ||
              !preview.material.candidates.length
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                setResult(
                  await aiApi("related", {
                    entryId,
                    digest: preview.digest,
                    target: status.target,
                    consent: true,
                    mode,
                  }),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "处理中…" : "比较相似错题"}
          </button>
        </>
      )}
      {result && (
        <div className="ai-result">
          {!result.matches.length && <p>未找到足够相似的记录。</p>}
          {result.matches.map((m) => (
            <article key={m.id}>
              <h3>
                <Link href={"/entries/" + m.id}>
                  {preview?.material.candidates.find((e) => e.id === m.id)
                    ?.title || "查看记录"}
                </Link>
              </h3>
              <p>{m.reason}</p>
              <p>差异：{m.difference}</p>
              <button
                className="text-button"
                disabled={busy || linked.includes(m.id)}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const r = await fetch(
                      "/api/v1/entries/" + entryId + "/relations",
                      {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          "X-Requested-With": "yanxiben",
                        },
                        body: JSON.stringify({
                          targetId: m.id,
                          type: "SIMILAR",
                        }),
                      },
                    );
                    if (!r.ok)
                      throw new Error(
                        (await r.json()).error?.message || "关联失败",
                      );
                    setLinked((v) => [...v, m.id]);
                    onLinked();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {linked.includes(m.id) ? "已关联" : "确认添加为相似题关联"}
              </button>
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
