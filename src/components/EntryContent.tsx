"use client";
/* eslint-disable @next/next/no-img-element -- Private attachments require the browser's session cookie, which the public image optimizer does not forward. */
import Link from "next/link";
import { fields, type Entry } from "../lib/model";
import {
  parseViewJson,
  historyViewSchema,
  snapshotViewSchema,
} from "../lib/view-data";
import { parseOptions } from "./OptionsEditor";
import { MD } from "./Markdown";
import { Badge, ErrorBox } from "./ui";
import { useLoad } from "./useLoad";
type Any = Record<string, any>;
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
  const { data, error } = useLoad("entries/" + id);
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
