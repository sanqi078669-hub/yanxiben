"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";

import { BookOpen, ArrowUpRight } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

import { rememberLibraryPosition } from "./libraryPosition";

import { names, fields, type Entry } from "../lib/model";
import type { EntryListItem } from "../lib/api-types";
type Any = Record<string, any>;
import { api } from "../lib/request";
export { api } from "../lib/request";
import {
  parseViewJson,
  historyViewSchema,
  snapshotViewSchema,
} from "../lib/view-data";
import { parseOptions } from "./OptionsEditor";
export function MD({ children }: { children?: string }) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { trust: false, strict: "ignore" }]]}
      >
        {children || "尚未填写"}
      </Markdown>
    </div>
  );
}
const icons = { MATH: "∑", CS: "⌘", VOCABULARY: "Aa", SENTENCE: "“ ”" };
export function TypeIcon({ type }: { type: keyof typeof names }) {
  return (
    <span className={"type-icon " + type.toLowerCase()}>{icons[type]}</span>
  );
}
export function Badge({ children }: { children: React.ReactNode }) {
  return <span className="badge">{children}</span>;
}
export function Empty({
  title = "这里还是一张白纸",
  text = "把值得再想一次的题目，收进你的研习本。",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <div className="empty">
      <BookOpen size={35} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function Row({
  e,
  action,
  returnTo,
}: {
  e: Pick<
    EntryListItem,
    | "id"
    | "type"
    | "title"
    | "body"
    | "subject"
    | "source"
    | "updated_at"
    | "status"
  >;
  action?: React.ReactNode;
  returnTo?: string;
}) {
  return (
    <div className="entry-row">
      <TypeIcon type={e.type} />
      <Link
        href={
          "/entries/" +
          e.id +
          (returnTo ? "?returnTo=" + encodeURIComponent(returnTo) : "")
        }
        className="entry-main"
        data-entry-id={e.id}
        onClick={() => {
          if (returnTo) rememberLibraryPosition(returnTo, e.id);
        }}
      >
        <h3>{e.title || e.body.slice(0, 45) || "图片记录"}</h3>
        <p>
          {e.subject}
          <span>·</span>
          {e.source || names[e.type]}
          <span>·</span>
          {new Date(e.updated_at).toLocaleDateString("zh-CN")}
        </p>
      </Link>
      <Badge>{e.status === "INBOX" ? "待整理" : "已整理"}</Badge>
      {action || <ArrowUpRight size={18} className="muted" />}
    </div>
  );
}
export function useLoad<T = Any>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  const generation = useRef(0);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    const request = ++generation.current;
    setLoading(true);
    setError("");
    return fn()
      .then((result) => {
        if (request === generation.current) setData(result);
      })
      .catch((e) => {
        if (request === generation.current) setError(e.message);
      })
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
  }, deps);
  useEffect(() => {
    reload();
    return () => {
      generation.current++;
    };
  }, [reload]);
  return { data, error, reload, setData, loading };
}
export function ErrorBox({ text, id }: { text: string; id?: string }) {
  return text ? (
    <div className="error" role="alert" id={id}>
      {text}
    </div>
  ) : null;
}
export function AttachmentImages({ e, role }: { e: Entry; role: string }) {
  return (
    <div className="reading-images">
      {e.attachments
        .filter((a) => a.role === role)
        .map((a) => (
          <a
            key={a.id}
            href={"/api/v1/attachments/" + a.id + "/content"}
            target="_blank"
            rel="noreferrer"
          >
            <img
              src={"/api/v1/attachments/" + a.id + "/content"}
              alt={role === "PROMPT" ? "题面图片" : "答案图片"}
            />
          </a>
        ))}
    </div>
  );
}
export function SentenceLink({ id }: { id: string }) {
  const { data, error } = useLoad(() => api("entries/" + id), [id]);
  if (error)
    return (
      <small className="muted">
        关联长难句暂不可用；原关联保留，可在回收站恢复。
      </small>
    );
  return data ? (
    <Link href={"/entries/" + id}>查看关联长难句</Link>
  ) : (
    <small>正在检查关联…</small>
  );
}
export function Analysis({ e }: { e: Entry }) {
  return (
    <>
      {fields[e.type]
        .filter(([k]) => e.details[k])
        .map(([k, l]) => (
          <section className="analysis-section" key={k}>
            <h3>{l}</h3>
            <MD>{e.details[k]}</MD>
          </section>
        ))}
      {e.contexts.map((c, i) => (
        <section className="context-card" key={i}>
          <h3>语境 {i + 1}</h3>
          <MD>{c.sentence_text}</MD>
          <MD>{c.meaning_md}</MD>
          <p>{c.collocation}</p>
          <small>{c.source}</small>
          {c.sentence_entry_id && <SentenceLink id={c.sentence_entry_id} />}
        </section>
      ))}
      {e.summary && (
        <div className="takeaway">
          <h3>一句话总结</h3>
          <MD>{e.summary}</MD>
        </div>
      )}
      <AttachmentImages e={e} role="ANSWER" />
    </>
  );
}
export function HistoryRow({ h }: { h: Any }) {
  const p = parseViewJson(h.payload, historyViewSchema);
  if (!p)
    return (
      <ErrorBox text="本条复习历史已损坏，暂时无法显示；其余记录仍可查看。" />
    );
  return (
    <details className="history-row">
      <summary>
        <span>
          {h.title || h.local_date}
          <small>
            {h.mode === "PRACTICE" ? "主动练习" : "计划复习"} ·{" "}
            {new Date(h.created_at).toLocaleString("zh-CN")}
          </small>
        </span>
        <Badge>
          {
            (
              { AGAIN: "不会", HARD: "困难", GOOD: "掌握", EASY: "熟练" } as Any
            )[h.rating]
          }
          {p.hintUsed ? " · 使用提示" : ""}
        </Badge>
      </summary>
      <MD>{p.answerMd || "本次未填写作答文字"}</MD>
      <p className="muted">
        下一次：{p.after.due_on} · {p.algorithmVersion}
      </p>
    </details>
  );
}

export function OptionsView({ raw }: { raw: string }) {
  const options = parseOptions(raw);
  return options ? (
    <MD>{options.map((s) => "- " + s).join("\n")}</MD>
  ) : (
    <ErrorBox text="选项格式已损坏，请在编辑页修正。" />
  );
}
export function RevisionContent({ raw }: { raw: string }) {
  const entry = parseViewJson(raw, snapshotViewSchema);
  return entry ? (
    <>
      <MD>{entry.body}</MD>
      <Analysis e={entry} />
    </>
  ) : (
    <ErrorBox text="本条历史快照已损坏，暂时无法显示；其余版本仍可查看。" />
  );
}
