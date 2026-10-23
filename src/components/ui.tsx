"use client";
import Link from "next/link";
import { BookOpen, ArrowUpRight } from "lucide-react";
import { rememberLibraryPosition } from "./libraryPosition";
import { names } from "../lib/model";
import type { EntryListItem } from "../lib/api-types";
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
export function ErrorBox({ text, id }: { text: string; id?: string }) {
  return text ? (
    <div className="error" role="alert" id={id}>
      {text}
    </div>
  ) : null;
}
