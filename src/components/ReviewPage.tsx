"use client";
import "katex/dist/katex.min.css";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, Clock, CheckCircle2, Eye } from "lucide-react";

import { afterSubmission } from "../modules/review/queue";

import { AiStudy } from "./AiStudy";

import {
  readReviewSession,
  reviewSessionSnapshot,
  type ReviewSession,
} from "../lib/review-session";
import {
  REVIEW_ANSWER_MAX_LENGTH,
  submissionWasRejected,
} from "../lib/review-contract";
import { names, errors } from "../lib/model";
import { api } from "../lib/request";
import { MD } from "./Markdown";
import {
  OptionsView,
  AttachmentImages,
  Analysis,
  HistoryRow,
} from "./EntryContent";
import { TypeIcon, Badge, Empty, ErrorBox } from "./ui";
import { useLoad } from "./useLoad";
type Any = Record<string, any>;
export default function ReviewPage({
  notify,
}: {
  notify: (s: string) => void;
}) {
  const params = useSearchParams();
  const practice = params.get("practice");
  const [focusMode, setFocusMode] = useState(false);
  const [errorCauses, setErrorCauses] = useState<string[] | null>(null);
  const [sessionOwner, setSessionOwner] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionMessage, setSessionMessage] = useState("");
  const [orphan, setOrphan] = useState<ReviewSession | null>(null);
  const restoredVersion = useRef<number | null>(null);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const answerHeading = useRef<HTMLDivElement>(null);
  const answerInput = useRef<HTMLTextAreaElement>(null);
  const [submissionRejected, setSubmissionRejected] = useState(false);
  const previousQuestion = useRef<string | undefined>(undefined);
  const scope = practice || "scheduled";
  const storageKey = `yanxi-review-v1:${sessionOwner}:${scope}`;
  const [showHistory, setShowHistory] = useState(params.get("history") === "1"),
    [index, setIndex] = useState(0),
    [answer, setAnswer] = useState(""),
    [revealed, setRevealed] = useState(false),
    [hint, setHint] = useState(false),
    [aiHint, setAiHint] = useState(false),
    [rating, setRating] = useState("GOOD"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [completed, setCompleted] = useState(false),
    [forcedPractice, setForcedPractice] = useState(false),
    [reviewConflict, setReviewConflict] = useState(false),
    [practiceItem, setPracticeItem] = useState<Any | null>(null);
  const isPractice = !!practice || forcedPractice;
  const key = useRef(crypto.randomUUID()),
    pending = useRef<{ body: Any; key: string } | null>(null);
  const {
    data: queue,
    error: queueError,
    reload,
    setData: setQueue,
  } = useLoad(() => api("reviews/queue"));
  const { data: history, reload: reloadHistory } = useLoad<any[]>(() =>
    api("reviews/history"),
  );
  useEffect(() => {
    if (practice) {
      api("entries/" + practice)
        .then(async (e) => {
          const r =
            e.review ||
            (await api("review-items", { entryId: practice, practice: true }));
          setPracticeItem({ ...r, entry: e });
        })
        .catch((e) => setError(e.message));
    }
  }, [practice]);
  const current = isPractice ? practiceItem : queue?.items[index];
  useEffect(() => {
    if (previousQuestion.current && current?.id !== previousQuestion.current)
      questionHeading.current?.focus();
    previousQuestion.current = current?.id;
  }, [current?.id]);
  useEffect(() => {
    if (revealed) answerHeading.current?.focus();
  }, [revealed]);
  useEffect(() => {
    if (completed) questionHeading.current?.focus();
  }, [completed]);
  useEffect(() => {
    api("auth/identity")
      .then((r) => setSessionOwner(r.owner))
      .catch(() => {
        setSessionReady(true);
        setSessionMessage("会话恢复暂不可用，请保持页面打开。");
      });
  }, []);
  useEffect(() => {
    if (!sessionOwner || sessionReady || (practice ? !practiceItem : !queue))
      return;
    try {
      const saved = readReviewSession(
        sessionStorage.getItem(storageKey),
        sessionOwner,
        scope,
      );
      if (saved) {
        const position = practice
          ? 0
          : queue.items.findIndex((item: Any) => item.id === saved.reviewId);
        const available = practice
          ? practiceItem?.id === saved.reviewId
          : position >= 0;
        if (available) {
          const item = practice ? practiceItem : queue.items[position];
          if (saved.mode === "PRACTICE" && !practice) {
            setForcedPractice(true);
            setPracticeItem(item);
          }
          setIndex(position);
          setAnswer(saved.answer);
          setRevealed(saved.revealed);
          setHint(saved.hint);
          setAiHint(saved.aiHint);
          setRating(saved.rating);
          setErrorCauses(saved.errorCauses ?? null);
          key.current = saved.key;
          pending.current = saved.pending;
          restoredVersion.current = saved.version;
          setSessionMessage(
            "已恢复本标签页的作答与提示状态。队列已按服务器最新状态更新。",
          );
          if (item.version !== saved.version && !saved.pending) {
            setReviewConflict(true);
            setError("这道题的复习计划已变化，原作答已保留，请转为主动练习。");
          }
        } else {
          setOrphan(saved);
          setSessionMessage(
            "上次的题目已不在当前队列中，可能已完成、暂停或删除。原作答保留如下。",
          );
        }
      }
    } catch {
      setSessionMessage("本浏览器不允许暂存会话，请保持页面打开。");
    }
    setSessionReady(true);
  }, [
    sessionOwner,
    sessionReady,
    practice,
    practiceItem,
    queue,
    storageKey,
    scope,
  ]);
  const saveSession = (request = pending.current) => {
    if (!sessionOwner || !sessionReady || !current || completed || orphan)
      return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify(
          reviewSessionSnapshot({
            owner: sessionOwner,
            scope,
            updated: Date.now(),
            reviewId: current.id,
            entryId: current.entry.id,
            title: current.entry.title || "未命名记录",
            version: restoredVersion.current ?? current.version,
            mode: isPractice ? "PRACTICE" : "SCHEDULED",
            answer,
            revealed,
            hint,
            aiHint,
            rating: rating as ReviewSession["rating"],
            key: key.current,
            pending: request as ReviewSession["pending"],
            errorCauses,
          }),
        ),
      );
    } catch {
      setSessionMessage("会话暂存失败，请保持页面打开并完成保存。");
    }
  };
  useEffect(() => {
    saveSession();
  }, [
    sessionOwner,
    sessionReady,
    current,
    answer,
    revealed,
    hint,
    aiHint,
    rating,
    errorCauses,
    completed,
    orphan,
  ]);
  useEffect(() => {
    document.body.classList.toggle("review-focus", focusMode);
    return () => document.body.classList.remove("review-focus");
  }, [focusMode]);
  const reset = () => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
    restoredVersion.current = null;
    setAnswer("");
    setRevealed(false);
    setHint(false);
    setAiHint(false);
    setRating("GOOD");
    setErrorCauses(null);
    key.current = crypto.randomUUID();
    pending.current = null;
    setSubmissionRejected(false);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">REVISIT · RETRIEVE · REFLECT</div>
          <h1>
            {isPractice ? "给理解，一次检验。" : "回看，是为了走得更远。"}
          </h1>
          <p>
            {isPractice
              ? "主动练习会保留历史，不改变原有到期日期。"
              : `今日到期 ${queue?.total ?? 0} 条 · 当前批次 ${queue?.items.length ?? 0} 条 · 先作答，再核对。`}
          </p>
        </div>
        <div className="ai-actions">
          <button
            className="button outline"
            aria-pressed={focusMode}
            onClick={() => setFocusMode((v) => !v)}
          >
            {focusMode ? "退出专注模式" : "专注模式"}
          </button>
          <Link
            className="button outline"
            href="/today"
            onClick={() => saveSession()}
          >
            稍后继续
          </Link>
          <button
            className="button outline"
            onClick={() => setShowHistory(!showHistory)}
          >
            <Clock size={17} />
            {showHistory ? "回到练习" : "复习历史"}
          </button>
        </div>
      </div>
      <p role="status">
        {sessionMessage ||
          "作答暂存在本标签页，刷新或稍后返回可继续（保留 7 天）。关闭标签页后可能无法恢复。"}
      </p>
      {orphan && (
        <section className="panel">
          <h2>上次未结束的作答：{orphan.title}</h2>
          <MD>{orphan.answer || "未填写文字"}</MD>
          <p>
            {orphan.hint ? "本次使用过提示" : "未使用提示"}
            。当前有效队列可在下方继续。
          </p>
          {orphan.pending && (
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(
                    `review-items/${orphan.reviewId}/attempts`,
                    orphan.pending!.body,
                    "POST",
                    { "Idempotency-Key": orphan.pending!.key },
                  );
                  setOrphan(null);
                  reset();
                  await reload();
                  reloadHistory();
                  setSessionMessage(
                    "已核对上次提交；相同请求不会重复记入历史或改变计划。",
                  );
                } catch (e) {
                  if (submissionWasRejected(e)) {
                    setOrphan((saved) =>
                      saved ? { ...saved, pending: null } : null,
                    );
                    try {
                      sessionStorage.setItem(
                        storageKey,
                        JSON.stringify(
                          reviewSessionSnapshot({ ...orphan, pending: null }),
                        ),
                      );
                    } catch {}
                  }
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              核对 / 重试上次提交
            </button>
          )}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  "清除上方暂存作答并继续当前队列？已保存的复习历史不受影响。",
                )
              ) {
                setOrphan(null);
                reset();
              }
            }}
          >
            清除暂存并继续
          </button>
        </section>
      )}
      <ErrorBox text={error || queueError} />
      {reviewConflict && current && (
        <button
          className="button outline"
          onClick={async () => {
            try {
              const fresh = await api("entries/" + current.entry.id);
              setPracticeItem({ ...fresh.review, entry: fresh });
              setForcedPractice(true);
              setReviewConflict(false);
              pending.current = null;
              restoredVersion.current = null;
              key.current = crypto.randomUUID();
              setError("");
              notify("已保留作答并转为主动练习，不修改最新复习计划");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          保留作答，转为主动练习
        </button>
      )}
      {!sessionReady && !queueError && !error ? (
        <p role="status">正在核对暂存会话…</p>
      ) : orphan ? null : showHistory ? (
        <section className="panel">
          <div className="section-title">
            <h2>每次认真尝试，都有记录</h2>
            <span className="muted">最近 200 次</span>
          </div>
          {history?.length ? (
            history.map((h) => <HistoryRow key={h.id} h={h} />)
          ) : (
            <Empty title="等待第一次练习" />
          )}
        </section>
      ) : completed ? (
        <section className="panel completion">
          <CheckCircle2 size={50} />
          <h2 ref={questionHeading} tabIndex={-1}>
            又多理解了一点。
          </h2>
          <p>这次练习已经保存。</p>
          <Link
            className="button"
            href={isPractice ? "/entries/" + current.entry.id : "/today"}
          >
            返回{isPractice ? "记录" : "今日学习"}
          </Link>
          {!isPractice && (
            <button
              className="button outline"
              onClick={async () => {
                await reload();
                setIndex(0);
                setCompleted(false);
                reset();
              }}
            >
              查看剩余到期任务
            </button>
          )}
        </section>
      ) : !isPractice && !queue ? (
        <section className="panel">
          <p>
            {queueError ? "复习队列未能读取，请重试。" : "正在读取复习队列…"}
          </p>
          {queueError && (
            <button className="button outline" onClick={() => reload()}>
              重新加载
            </button>
          )}
        </section>
      ) : current ? (
        <div className="review-workspace">
          <section className="panel form-panel">
            <div className="section-title">
              <div className="inline">
                <TypeIcon type={current.entry.type} />
                <span>{names[current.entry.type as keyof typeof names]}</span>
              </div>
              <Badge>
                {isPractice
                  ? "主动练习"
                  : `${index + 1} / ${queue.items.length}`}
              </Badge>
            </div>
            <h2 ref={questionHeading} tabIndex={-1}>
              {current.entry.title || "想一想，再作答"}
            </h2>
            <MD>{current.entry.body}</MD>
            {current.entry.type === "CS" &&
              current.entry.details.options_json && (
                <OptionsView raw={current.entry.details.options_json} />
              )}
            <AttachmentImages e={current.entry} role="PROMPT" />
            {!revealed && (
              <details>
                <summary>需要帮助？展开 AI 分步提示</summary>
                <AiStudy
                  key={current.entry.id}
                  entry={current.entry}
                  actions={["hint"]}
                  onHint={() => {
                    setAiHint(true);
                    setHint(true);
                    setRating("GOOD");
                  }}
                />
              </details>
            )}
            <label>
              我的独立作答
              <textarea
                ref={answerInput}
                rows={6}
                placeholder="写下答案、推导过程或你的理解…（也可以先在纸上完成）"
                value={answer}
                maxLength={REVIEW_ANSWER_MAX_LENGTH}
                disabled={busy || !!pending.current}
                onChange={(e) => setAnswer(e.target.value)}
              />
              <small>
                {answer.length.toLocaleString()} /{" "}
                {REVIEW_ANSWER_MAX_LENGTH.toLocaleString()} 字符
              </small>
              {answer.length > REVIEW_ANSWER_MAX_LENGTH && (
                <ErrorBox text="已保留旧版超长答案。请复制备份或缩短至 50,000 字符以内再提交，不会自动截断。" />
              )}
            </label>
            {!revealed ? (
              <div className="review-actions">
                <button className="button" onClick={() => setRevealed(true)}>
                  <Eye size={17} />
                  已尝试，展开解析
                </button>
                <button
                  className="text-button"
                  disabled={busy || !!pending.current}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api(`review-items/${current.id}/hint`, {
                        expectedVersion:
                          restoredVersion.current ?? current.version,
                      });
                      setHint(true);
                      setAiHint(true);
                      setRevealed(true);
                      if (rating === "EASY") setRating("GOOD");
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  需要提示，先看看思路
                </button>
                {!isPractice && (
                  <button
                    className="text-button"
                    onClick={() => {
                      reset();
                      setIndex((index + 1) % queue.items.length);
                    }}
                  >
                    暂时跳过
                  </button>
                )}
              </div>
            ) : (
              <>
                <div
                  className="answer-divider"
                  ref={answerHeading}
                  tabIndex={-1}
                >
                  核对思路 · 诚实评价这一次
                </div>
                <Analysis e={current.entry} />
                {!busy && !pending.current && (
                  <details>
                    <summary>需要核对？展开 AI 作答点评</summary>
                    <AiStudy
                      key={current.entry.id + "feedback"}
                      entry={current.entry}
                      actions={["feedback"]}
                      answer={answer}
                      hintUsed={hint}
                      onRating={setRating}
                    />
                  </details>
                )}
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={hint}
                    disabled={busy || !!pending.current || aiHint}
                    onChange={(e) => {
                      setHint(e.target.checked);
                      if (e.target.checked && rating === "EASY")
                        setRating("GOOD");
                    }}
                  />
                  作答过程中使用了提示
                </label>
                <fieldset disabled={busy || !!pending.current}>
                  <legend>本次作答的错因（选填、自评）</legend>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={errorCauses !== null}
                      onChange={(e) =>
                        setErrorCauses(e.target.checked ? [] : null)
                      }
                    />
                    记录本次错因；不勾选则保留为未知
                  </label>
                  {errorCauses !== null && (
                    <>
                      <p>可多选；未选择任何类别表示本次未发现这些错因。</p>
                      {errors.map((cause) => (
                        <label className="checkbox-label" key={cause}>
                          <input
                            type="checkbox"
                            checked={errorCauses.includes(cause)}
                            onChange={(e) =>
                              setErrorCauses((old) =>
                                e.target.checked
                                  ? [...(old || []), cause]
                                  : (old || []).filter((v) => v !== cause),
                              )
                            }
                          />
                          {cause}
                        </label>
                      ))}
                    </>
                  )}
                </fieldset>
                <div className="ratings">
                  {[
                    ["AGAIN", "不会", "需要重新理解"],
                    ["HARD", "困难", "有思路，仍卡顿"],
                    ["GOOD", "掌握", "能独立完成"],
                    ["EASY", "熟练", "清晰、顺畅地完成"],
                  ].map(([v, l, s]) => (
                    <button
                      key={v}
                      className={rating === v ? "selected" : ""}
                      aria-pressed={rating === v}
                      disabled={
                        busy || !!pending.current || (hint && v === "EASY")
                      }
                      onClick={() => setRating(v)}
                    >
                      <b>{l}</b>
                      <small>{s}</small>
                    </button>
                  ))}
                </div>
                <button
                  className="button full"
                  disabled={
                    busy ||
                    (!pending.current &&
                      (answer.length > REVIEW_ANSWER_MAX_LENGTH ||
                        reviewConflict))
                  }
                  onClick={async () => {
                    setBusy(true);
                    setSubmissionRejected(false);
                    setError("");
                    if (!pending.current)
                      pending.current = {
                        body: {
                          expectedVersion:
                            restoredVersion.current ?? current.version,
                          mode: isPractice ? "PRACTICE" : "SCHEDULED",
                          rating,
                          hintUsed: hint,
                          answerMd: answer,
                          ...(errorCauses !== null ? { errorCauses } : {}),
                        },
                        key: key.current,
                      };
                    saveSession(pending.current);
                    try {
                      await api(
                        "review-items/" + current.id + "/attempts",
                        pending.current.body,
                        "POST",
                        { "Idempotency-Key": pending.current.key },
                      );
                      notify("复习已保存");
                      reloadHistory();
                      reset();
                      if (isPractice) setCompleted(true);
                      else {
                        const next = afterSubmission(
                          queue.items,
                          current.id,
                          index,
                        );
                        setQueue({
                          ...queue,
                          items: next.items,
                          total: Math.max(0, queue.total - 1),
                        });
                        setIndex(next.index);
                        setCompleted(next.complete);
                      }
                    } catch (e) {
                      const rejected = submissionWasRejected(e);
                      if (rejected) {
                        setSubmissionRejected(true);
                        pending.current = null;
                        key.current = crypto.randomUUID();
                        saveSession(null);
                      }
                      setReviewConflict(
                        [
                          "VERSION_CONFLICT",
                          "ALREADY_REVIEWED_TODAY",
                          "PAUSED",
                          "NOT_DUE",
                        ].includes((e as Any).code),
                      );
                      setError(
                        (e as Error).message +
                          (rejected
                            ? "；本次未保存，答案已保留，可以修改后重新提交。"
                            : "；结果尚未确认，请用原请求核对后再继续，避免重复记录。"),
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy
                    ? "正在保存…"
                    : pending.current
                      ? "重试保存本次复习"
                      : "完成本次复习"}
                  <Check size={17} />
                </button>
                {submissionRejected && (
                  <button
                    className="button outline"
                    onClick={() => {
                      setSubmissionRejected(false);
                      setError("");
                      answerInput.current?.focus();
                    }}
                  >
                    放弃本次提交，继续编辑
                  </button>
                )}
                {pending.current && !busy && (
                  <p role="status">
                    本次结果尚未确认，原答案和请求标识已保留。点击“重试保存本次复习”核对结果；成功后会解除等待。放弃本地重试不能撤销可能已保存的历史。
                  </p>
                )}
              </>
            )}
          </section>
          <aside className="review-aside">
            <span className="eyebrow">A NOTE TO YOURSELF</span>
            <h2>
              想起来，
              <br />
              比看明白
              <br />
              更重要。
            </h2>
            <p>
              先合上答案，给自己一点时间。卡住的地方，正是下一次成长的起点。
            </p>
            <div className="review-steps">
              <span>01 阅读题面</span>
              <span>02 独立尝试</span>
              <span>03 核对与评价</span>
            </div>
          </aside>
        </div>
      ) : (
        <section className="panel">
          <Empty
            title={isPractice ? "正在准备练习…" : "今天的到期任务已完成"}
            text="也可以从资料库选择一条记录，进行不改变计划的主动练习。"
          />
          <div className="center">
            <Link className="button outline" href="/library">
              去资料库看看
              <ArrowRight size={17} />
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
