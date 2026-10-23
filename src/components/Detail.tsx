"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2, ChevronLeft, FileText, Target, X } from "lucide-react";

import { AiStudy } from "./AiStudy";
import { AiRelated } from "./AiRelated";

import { names, errors, type Entry } from "../lib/model";
import {
  api,
  MD,
  OptionsView,
  TypeIcon,
  Badge,
  Empty,
  useLoad,
  ErrorBox,
  AttachmentImages,
  Analysis,
  HistoryRow,
  RevisionContent,
} from "./NotebookShared";
type Any = Record<string, any>;
export default function Detail({
  id,
  notify,
}: {
  id: string;
  notify: (s: string) => void;
}) {
  const router = useRouter();
  const returnQuery = useSearchParams().get("returnTo") || "";
  const returnTo = /^\/(library|inbox)(\?|$)/.test(returnQuery)
    ? returnQuery
    : "/library";
  const { data: e, error, reload } = useLoad(() => api("entries/" + id), [id]);
  const [tab, setTab] = useState("analysis"),
    [revisions, setRevisions] = useState<any[]>([]),
    [target, setTarget] = useState(""),
    [relation, setRelation] = useState("SIMILAR"),
    [actionError, setActionError] = useState("");
  const { data: choices } = useLoad(() => api("entries?limit=100"));
  const action = async (fn: () => Promise<unknown>, message: string) => {
    setActionError("");
    try {
      await fn();
      notify(message);
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  };
  if (!e)
    return (
      <>
        <ErrorBox text={error} />
        {!error && <div className="loading">正在读取思考…</div>}
      </>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="back-link" href={returnTo}>
            <ChevronLeft size={16} />
            返回列表
          </Link>
          <div className="detail-title">
            <TypeIcon type={e.type} />
            <h1>{e.title || e.body.slice(0, 45) || "图片记录"}</h1>
          </div>
          <p>
            {e.subject} · {e.status === "INBOX" ? "待整理" : "已整理"} · 第{" "}
            {e.version} 版 · {e.source || "未注明来源"}
          </p>
        </div>
        <Link className="button" href={"/entries/" + id + "/edit"}>
          <FileText size={17} />
          继续整理
        </Link>
      </div>
      <ErrorBox text={actionError} />
      <details className="panel form-panel">
        <summary>AI 辅助：查找相似题、提示与变式</summary>
        <AiRelated key={id} entryId={id} onLinked={reload} />
        <AiStudy key={id + "study"} entry={e} actions={["hint", "variant"]} />
      </details>
      <div className="detail-grid">
        <div>
          <section className="panel form-panel">
            <div className="section-title">
              <h2>原始材料</h2>
              <Badge>{names[e.type as keyof typeof names]}</Badge>
            </div>
            <MD>{e.body}</MD>
            {e.type === "CS" && e.details.options_json && (
              <OptionsView raw={e.details.options_json} />
            )}
            <AttachmentImages e={e} role="PROMPT" />
          </section>
          <section className="panel form-panel">
            <div className="tabs">
              <button
                className={tab === "analysis" ? "selected" : ""}
                onClick={() => setTab("analysis")}
              >
                分析与理解
              </button>
              <button
                className={tab === "history" ? "selected" : ""}
                onClick={() => setTab("history")}
              >
                复习历史 · {e.history.length}
              </button>
              <button
                className={tab === "versions" ? "selected" : ""}
                onClick={async () => {
                  setTab("versions");
                  try {
                    setRevisions(await api("entries/" + id + "/revisions"));
                  } catch (e) {
                    setActionError((e as Error).message);
                  }
                }}
              >
                内容版本
              </button>
            </div>
            {tab === "analysis" ? (
              <Analysis e={e as Entry} />
            ) : tab === "history" ? (
              e.history.length ? (
                e.history.map((h: Any) => <HistoryRow key={h.id} h={h} />)
              ) : (
                <Empty
                  title="还没有练习历史"
                  text="从一次独立作答开始检验理解。"
                />
              )
            ) : revisions.length ? (
              revisions.map((r) => (
                <details className="revision" key={r.id}>
                  <summary>
                    版本 {r.version} ·{" "}
                    {new Date(r.created_at).toLocaleString("zh-CN")} ·{" "}
                    {r.reason}
                  </summary>
                  <RevisionContent raw={r.snapshot} />
                </details>
              ))
            ) : (
              <Empty
                title="还没有历史快照"
                text="手动保存及重要操作时会保留历史版本。"
              />
            )}
          </section>
        </div>
        <aside>
          <section className="panel form-panel">
            <h3>安排下一次回看</h3>
            {e.review ? (
              <>
                <p className="muted">
                  {e.review.stage === "PAUSED"
                    ? "计划已暂停"
                    : "下次到期：" + e.review.due_on}
                </p>
                <Badge>
                  {
                    (
                      {
                        NEW: "新加入",
                        LEARNING: "学习中",
                        MAINTENANCE: "长期巩固",
                        PAUSED: "已暂停",
                      } as Any
                    )[e.review.stage]
                  }
                </Badge>
                <button
                  className="button outline full"
                  onClick={() =>
                    action(
                      () =>
                        api(
                          "review-items/" + e.review.id,
                          {
                            expectedVersion: e.review.version,
                            paused: e.review.stage !== "PAUSED",
                          },
                          "PATCH",
                        ),
                      e.review.stage === "PAUSED"
                        ? "已恢复，保留原到期日，可能已逾期"
                        : "已暂停计划",
                    )
                  }
                >
                  {e.review.stage === "PAUSED"
                    ? "恢复复习计划"
                    : "暂停复习计划"}
                </button>
              </>
            ) : (
              <>
                <p className="muted">
                  加入后默认今天到期。每一次作答，都是一次主动检验。
                </p>
                <button
                  className="button full"
                  onClick={() =>
                    action(
                      () => api("review-items", { entryId: id }),
                      "已加入复习计划",
                    )
                  }
                >
                  <Plus size={17} />
                  加入复习
                </button>
              </>
            )}
            <Link
              className="button outline full"
              href={"/review?practice=" + id}
            >
              <Target size={17} />
              主动练习
            </Link>
            <p className="tip">主动练习只记录历史，不改变到期日期。</p>
          </section>
          <section className="panel form-panel">
            <h3>知识之间，也有联系</h3>
            {e.relations.map((r: Any) => (
              <div key={r.id} className="relation-row">
                <Link
                  href={"/entries/" + (r.from_id === id ? r.to_id : r.from_id)}
                >
                  {r.title || "未命名记录"}
                  <small>
                    {
                      (
                        {
                          SIMILAR: "相似",
                          SUPPORTS: "支撑",
                          CONTRASTS: "对比",
                          CONTAINS_VOCABULARY: "包含词汇",
                        } as Any
                      )[r.type]
                    }
                  </small>
                </Link>
                <button
                  className="icon-button"
                  aria-label="移除关联"
                  onClick={() =>
                    action(
                      () =>
                        api(
                          "entries/" + id + "/relations",
                          { id: r.id },
                          "DELETE",
                        ),
                      "已移除关联",
                    )
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <label>
              关联记录
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">选择记录</option>
                {choices?.items
                  .filter((x: Entry) => x.id !== id)
                  .map((x: Entry) => (
                    <option key={x.id} value={x.id}>
                      {x.title || x.body.slice(0, 30) || "图片记录"}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              关联类型
              <select
                value={relation}
                onChange={(e) => setRelation(e.target.value)}
              >
                <option value="SIMILAR">相似</option>
                <option value="SUPPORTS">支撑</option>
                <option value="CONTRASTS">对比</option>
                <option value="CONTAINS_VOCABULARY">包含词汇</option>
              </select>
            </label>
            <button
              className="button outline full"
              disabled={!target}
              onClick={() =>
                action(
                  () =>
                    api("entries/" + id + "/relations", {
                      targetId: target,
                      type: relation,
                    }),
                  "已建立关联",
                )
              }
            >
              添加关联
            </button>
          </section>
          <div className="chip-list">
            {e.tags.map((t: string) => (
              <Badge key={t}>#{t}</Badge>
            ))}
            {e.errors.map((t: string) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
          <button
            className="danger-button"
            onClick={async () => {
              if (!confirm("将这条记录移入回收站？附件和历史会保留。")) return;
              try {
                await api("entries/" + id, undefined, "DELETE");
                notify("已移入回收站");
                router.push("/library");
              } catch (e) {
                setActionError((e as Error).message);
              }
            }}
          >
            <Trash2 size={16} />
            移入回收站
          </button>
        </aside>
      </div>
    </>
  );
}
