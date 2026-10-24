"use client";
import { api } from "../lib/request";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { aiApi } from "./AiTools";
import { MaterialPreview } from "./MaterialPreview";
import { AiFeedback } from "./AiHistory";
import {
  actionNames,
  studyMaterial,
  variantDraft,
  type StudyAction,
} from "../modules/ai/contracts";
import { entrySchema, type EntryInput } from "../lib/model";

export function AiStudy({
  entry,
  actions,
  onApply,
  onHint,
  answer = "",
  hintUsed = false,
  onRating,
}: {
  entry: EntryInput & { id?: string };
  actions: StudyAction[];
  onApply?: (patch: Partial<EntryInput>) => void;
  onHint?: () => void;
  answer?: string;
  hintUsed?: boolean;
  onRating?: (rating: string) => void;
}) {
  const [status, setStatus] = useState<any>(null),
    [action, setAction] = useState<StudyAction>(actions[0]),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<any>(null);
  const [hintLevel, setHintLevel] = useState(1);
  const [variantAnswer, setVariantAnswer] = useState(""),
    [showSolution, setShowSolution] = useState(false),
    [createdId, setCreatedId] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [snapshot, setSnapshot] = useState("");
  const [previous, setPrevious] = useState<Record<string, unknown> | null>(
    null,
  );
  const material = {
      ...studyMaterial(entry, action),
      ...(action === "feedback" ? { answer, hintUsed } : {}),
    },
    current = JSON.stringify(material);
  useEffect(() => {
    aiApi("status")
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel form-panel ai-panel">
      <h2>AI 学习助手</h2>
      <p role="status" aria-live="polite">
        {busy
          ? "正在生成 AI 建议…"
          : result
            ? "AI 建议已生成，请核对后决定是否采用。"
            : ""}
      </p>
      <p>建议供核对参考，原始记录不会自动更改。</p>
      {!status?.ready ? (
        <Link href="/settings">到设置配置 AI 模型</Link>
      ) : (
        <>
          <p>
            当前：{status.model} · {status.host}
          </p>
          <label>
            需要什么帮助
            <select
              value={action}
              disabled={busy}
              onChange={(e) => {
                setAction(e.target.value as StudyAction);
                setPrevious(null);
                setResult(null);
                setError("");
              }}
            >
              {actions.map((a) => (
                <option key={a} value={a}>
                  {actionNames[a]}
                </option>
              ))}
            </select>
          </label>
          <details>
            <summary>查看本次发送的文字（不发送图片）</summary>
            <MaterialPreview material={material} />
          </details>
          {action === "hint" && (
            <label>
              提示深度
              <select
                value={hintLevel}
                disabled={busy}
                onChange={(e) => {
                  setHintLevel(Number(e.target.value));
                  setResult(null);
                }}
              >
                <option value={1}>1 · 相关概念</option>
                <option value={2}>2 · 解题方向</option>
                <option value={3}>3 · 下一步操作</option>
              </select>
            </label>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            同意将上方预览的文字发送至当前 AI 服务
          </label>
          <button
            className="button outline"
            disabled={
              busy ||
              !consent ||
              !entry.body.trim() ||
              (action === "feedback" && !answer.trim())
            }
            onClick={async () => {
              setSnapshot(current);
              setVariantAnswer("");
              setShowSolution(false);
              setCreatedId("");
              setBusy(true);
              setError("");
              if (result) {
                const { audit: _audit, ...content } = result;
                setPrevious(content);
              }
              setResult(null);
              try {
                const base = Object.fromEntries(
                  Object.keys(entrySchema.shape).map((k) => [
                    k,
                    (entry as any)[k],
                  ]),
                );
                base.tags = entry.tags.map((t) => t.trim()).filter(Boolean);
                const value = await aiApi("study", {
                  action,
                  entry: base,
                  ...(entry.id ? { entryId: entry.id } : {}),
                  hintLevel,
                  answer,
                  hintUsed,
                  target: status.target,
                  consent: true,
                });
                if (alive.current) {
                  setResult(value);
                  if (action === "hint") onHint?.();
                }
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在分析…" : "生成" + actionNames[action]}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {result && (
        <div className="ai-result">
          <h3>{actionNames[action]} · AI 建议</h3>
          {result.audit && (
            <>
              <p>
                来源：{result.audit.model} ·{" "}
                {new Date(result.audit.created_at).toLocaleString("zh-CN")} ·
                人工采纳不代表答案已被系统证明正确。
              </p>
              <AiFeedback id={result.audit.id} />
            </>
          )}
          {previous && (
            <details>
              <summary>对比上一次生成结果</summary>
              <MaterialPreview material={previous} />
            </details>
          )}
          {action === "organize" ? (
            <>
              <h4>{result.title}</h4>
              <pre>{result.summary}</pre>
              <p>标签：{result.tags?.join("、")}</p>
              <p>知识点建议：{result.knowledgePoints?.join("、")}</p>
            </>
          ) : (
            <>
              <pre>{result.hint || result.feedback}</pre>
              {result.evidence?.map((s: string, i: number) => (
                <p key={i}>依据：{s}</p>
              ))}
              {action === "analyze" && (
                <p>错因建议：{result.errorTags?.join("、") || "未归类"}</p>
              )}
            </>
          )}
          {result.warnings?.map((s: string, i: number) => (
            <p key={i}>{s}</p>
          ))}
          {onApply && action === "organize" && (
            <>
              <button
                className="button"
                disabled={current !== snapshot}
                onClick={() => {
                  onApply({
                    title: result.title,
                    summary: result.summary,
                    tags: [
                      ...new Set([
                        ...entry.tags.filter((t) => t.trim()),
                        ...result.tags,
                      ]),
                    ].slice(0, 30),
                  });
                  setResult(null);
                }}
              >
                确认替换标题与总结、合并标签
              </button>
              <p>
                知识点建议仅展示，可在知识地图中自行创建。
                {current !== snapshot
                  ? "输入已变化，请重新生成。"
                  : "确认后沿用表单的保存机制。"}
              </p>
            </>
          )}
          {onApply && action === "analyze" && (
            <button
              className="button"
              disabled={current !== snapshot}
              onClick={() => {
                onApply({
                  summary: [
                    entry.summary,
                    "AI 错因建议（已人工确认）：\n" + result.feedback,
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                  errors: [
                    ...new Set([...entry.errors, ...result.errorTags]),
                  ] as string[],
                });
                setResult(null);
              }}
            >
              确认追加错因建议到总结、合并错因标签
            </button>
          )}
          {action === "feedback" && (
            <>
              <p>正确部分：{result.strengths?.join("；") || "暂无"}</p>
              <p>需要补充：{result.missing?.join("；") || "暂无"}</p>
              <p>
                建议评分：
                {
                  { AGAIN: "不会", HARD: "困难", GOOD: "掌握", EASY: "熟练" }[
                    result.rating as string
                  ]
                }
              </p>
              {onRating && (
                <button
                  className="button"
                  disabled={current !== snapshot}
                  onClick={() =>
                    onRating(
                      hintUsed && result.rating === "EASY"
                        ? "GOOD"
                        : result.rating,
                    )
                  }
                >
                  采用建议评分（仍需手动提交复习）
                </button>
              )}
            </>
          )}
          {action === "english" && (
            <>
              <h4>语境说明</h4>
              <pre>{result.explanation}</pre>
              <h4>译文与句子结构</h4>
              <pre>{result.translation + "\n\n" + result.structure}</pre>
              <h4>词义与搭配</h4>
              <pre>
                {result.wordMeaning + "\n" + result.collocations.join("\n")}
              </pre>
              {onApply && (
                <button
                  className="button"
                  disabled={current !== snapshot}
                  onClick={() => {
                    onApply({
                      summary: [
                        entry.summary,
                        "AI 英语解析（已人工确认）：",
                        result.explanation,
                        result.translation,
                        result.structure,
                        result.wordMeaning,
                        result.collocations.join("；"),
                      ]
                        .filter(Boolean)
                        .join("\n\n"),
                    });
                    setResult(null);
                  }}
                >
                  确认追加英语解析到总结
                </button>
              )}
            </>
          )}
          {action === "variant" && (
            <>
              <h4>变式题面</h4>
              <pre>{result.question}</pre>
              <p>知识点：{result.knowledgePoints.join("、")}</p>
              <label>
                变式独立作答（当前页草稿）
                <textarea
                  value={variantAnswer}
                  onChange={(e) => setVariantAnswer(e.target.value)}
                />
              </label>
              <button
                className="text-button"
                onClick={() => setShowSolution(!showSolution)}
              >
                {showSolution ? "隐藏参考解答" : "已尝试，查看参考解答"}
              </button>
              {showSolution && <pre>{result.solution}</pre>}
              <p>AI 生成题目和解答均需核对，保存后不会自动加入复习。</p>
              {createdId ? (
                <Link href={"/entries/" + createdId}>查看已保存的变式</Link>
              ) : (
                <button
                  className="button"
                  disabled={busy || current !== snapshot}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const draft = variantDraft(entry, result);
                      if (variantAnswer.trim()) {
                        const field =
                          entry.type === "MATH"
                            ? "original_work_md"
                            : entry.type === "CS"
                              ? "my_answer_md"
                              : entry.type === "SENTENCE"
                                ? "initial_translation_md"
                                : "takeaway_md";
                        draft.details[field] = [
                          draft.details[field],
                          variantAnswer,
                        ]
                          .filter(Boolean)
                          .join("\n\n");
                      }
                      const created = await api("entries", draft);
                      setCreatedId(created.id);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  确认另存为新记录
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
