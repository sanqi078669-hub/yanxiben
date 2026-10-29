"use client";
import Link from "next/link";

import {
  Inbox,
  Library,
  Plus,
  RotateCcw,
  ArrowUpRight,
  ArrowRight,
  CheckCircle2,
  Layers,
} from "lucide-react";

import { defaults, type Entry, type Template } from "../lib/model";
import { useDictionary } from "./DictionaryContext";
import { TypeIcon, Empty, Row, ErrorBox } from "./ui";
import { useLoad } from "./useLoad";
const subtitles: Record<Template, string> = {
  GENERIC: "留下原文，梳理思考",
  MATH: "从错因到方法",
  CS: "从疑问到原理",
  VOCABULARY: "在语境中记忆",
  SENTENCE: "拆开句子，读懂逻辑",
};
function TypeEmpty() {
  return (
    <div className="type-empty">
      <p>先创建类型，让每份思考有个归处。</p>
      <Link href="/settings#dictionary-manager">前往设置页「分类管理」</Link>
    </div>
  );
}
export function TypeCollection() {
  const { items, loading, templateOf } = useDictionary();
  const active = items.types.filter((item) => !item.archived);
  if (!active.length)
    return loading ? <p role="status">正在读取类型…</p> : <TypeEmpty />;
  return (
    <div className="collect-grid">
      {active.map((item) => (
        <Link
          href={"/entries/new?type=" + encodeURIComponent(item.value)}
          key={item.value}
        >
          <TypeIcon type={item.value} />
          <span>
            {item.label}
            <small>{subtitles[templateOf(item.value)]}</small>
          </span>
          <ArrowUpRight size={15} />
        </Link>
      ))}
    </div>
  );
}
export function TypeFootprints({
  byType = [],
}: {
  byType?: { type: string; n: number }[];
}) {
  const { items, loading } = useDictionary();
  const active = items.types.filter((item) => !item.archived);
  if (!active.length)
    return loading ? <p role="status">正在读取类型…</p> : <TypeEmpty />;
  return (
    <>
      {active.map((item) => (
        <Link
          href={"/library?type=" + encodeURIComponent(item.value)}
          key={item.value}
        >
          <TypeIcon type={item.value} />
          <span>{item.label}</span>
          <b>{byType.find((row) => row.type === item.value)?.n ?? 0}</b>
        </Link>
      ))}
    </>
  );
}
export default function Today({ profile }: { profile: typeof defaults }) {
  const { data: d, error } = useLoad("dashboard");
  const { error: dictionaryError } = useDictionary();
  const date = new Intl.DateTimeFormat("zh-CN", {
    timeZone: profile.timezone,
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
  return (
    <div className="journal-today">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {date}
            <span className="journal-date-note">
              {" "}
              / A LITTLE PROGRESS, EVERY DAY
            </span>
          </div>
          <h1>
            今天，也向前一点。<span className="sun-mark">✳</span>
          </h1>
          <p>你好，{profile.displayName}。把疑问留下，把知识带走。</p>
        </div>
        <Link href="/entries/new" className="button outline">
          <Plus size={18} />
          快速收集
        </Link>
      </div>
      <ErrorBox text={error || dictionaryError} />
      <div className="stats today-stats">
        <Link href="/review" className="stat">
          <span>
            待复习 <RotateCcw size={17} />
          </span>
          <strong>
            {d?.queue.total ?? "—"}
            <small>条</small>
          </strong>
          <p>今天再想一遍，记得更牢</p>
        </Link>
        <Link href="/inbox" className="stat">
          <span>
            待整理 <Inbox size={17} />
          </span>
          <strong>
            {d?.inbox ?? "—"}
            <small>条</small>
          </strong>
          <p>给收集的灵感一个归处</p>
        </Link>
        <Link href="/library" className="stat">
          <span>
            累计收集 <Library size={17} />
          </span>
          <strong>
            {d?.total ?? "—"}
            <small>条</small>
          </strong>
          <p>每一条，都是成长的注脚</p>
        </Link>
        <Link href="/review?history=1" className="stat">
          <span>
            今日已练习 <CheckCircle2 size={17} />
          </span>
          <strong>
            {d?.studied ?? "—"}
            <small>次</small>
          </strong>
          <p>认真完成的每次尝试都算数</p>
        </Link>
      </div>
      <div className="dashboard-grid">
        <section className="review-banner">
          <div>
            <span className="eyebrow">TODAY’S FOCUS</span>
            <h2>
              {d?.queue.total ? "温故，然后知新。" : "留一点时间，给理解。"}
            </h2>
            <p>
              {d?.queue.total
                ? `有 ${d.queue.total} 条记录等你回顾。先独立作答，再核对思路。`
                : "还没有到期的复习。整理一条记录，开始你的复习计划。"}
            </p>
            <Link
              href={d?.queue.total ? "/review" : "/inbox"}
              className="button light"
            >
              {d?.queue.total ? "开始今日复习" : "去整理记录"}
              <ArrowRight size={18} />
            </Link>
            <small>按日历安排 · 每次最多展示 {profile.dailyLimit} 条</small>
          </div>
          <div className="banner-art" aria-hidden="true">
            <div className="paper paper-back" />
            <div className="paper">
              <span>REVISIT & REFLECT</span>
              <b>知 新</b>
              <i />
              <i />
              <div>
                ✓ <span>理解，比记住更进一步</span>
              </div>
            </div>
            <span className="art-spark">✳</span>
          </div>
        </section>
        <section className="panel collection">
          <div className="section-title">
            <h2>随手收集</h2>
            <Plus size={17} />
          </div>
          <p className="muted">先记下来，分析可以慢慢来。</p>
          <TypeCollection />
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="panel recent today-recent">
          <div className="section-title">
            <h2>最近留下的思考</h2>
            <Link href="/library">
              全部记录 <ArrowRight size={15} />
            </Link>
          </div>
          {d?.recent.length ? (
            d.recent.map((e: Entry) => <Row key={e.id} e={e} />)
          ) : (
            <Empty
              title="从第一条记录开始"
              text="一道错题、一个生词，都是很好的起点。"
            />
          )}
        </section>
        <section className="panel subject-panel">
          <div className="section-title">
            <h2>我的学习足迹</h2>
            <Layers size={17} />
          </div>
          <TypeFootprints byType={d?.byType} />
          <div className="quiet-note">
            不必一次学会所有。
            <br />
            今天比昨天多懂一点，就很好。
          </div>
        </section>
      </div>
    </div>
  );
}
