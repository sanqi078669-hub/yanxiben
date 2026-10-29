"use client";
import { useState } from "react";
import Link from "next/link";

import { Plus, Network } from "lucide-react";

import { AiDiagnosis } from "./AiDiagnosis";

import { LearningStatistics } from "./LearningStatistics";

import { KnowledgeTools } from "./KnowledgeTools";

import { DictionaryLabel, useDictionary } from "./DictionaryContext";
import { DictionaryOptions } from "./DictionaryOptions";
import { api } from "../lib/request";
import { Badge, Empty, ErrorBox } from "./ui";
import { useLoad } from "./useLoad";
export default function KnowledgePage({
  notify,
  timezone,
}: {
  notify: (s: string) => void;
  timezone: string;
}) {
  const { data: nodes, error, reload } = useLoad<any[]>("knowledge-nodes");
  const { items, loading, error: dictionaryError } = useDictionary();
  const [name, setName] = useState(""),
    [chosenSubject, setSubject] = useState<string | null>(null),
    [parentId, setParent] = useState(""),
    [description, setDescription] = useState(""),
    [err, setError] = useState("");
  const firstActive = [...items.subjects]
    .filter((item) => !item.archived)
    .sort(
      (a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value),
    )[0];
  const subject = chosenSubject ?? firstActive?.value ?? "";
  const subjectGuide = (
    <p role="status">
      先创建或恢复科目，再添加知识点。
      <Link href="/settings#dictionary-manager">前往设置页「分类管理」</Link>
    </p>
  );
  const render = (parent: string | null, depth = 0): React.ReactNode =>
    nodes
      ?.filter((n) => n.parent_id === parent)
      .map((n) => (
        <div
          key={n.id}
          className="knowledge-node"
          style={{ marginLeft: depth ? 18 : 0 }}
        >
          <div>
            <Network size={18} />
            <Link href={"/library?knowledge=" + n.id}>
              <b>{n.name}</b>
              <small>
                <DictionaryLabel
                  kind="SUBJECT"
                  value={n.subject}
                  markArchived
                />
                {n.archived ? " · 已归档" : ""}
                {n.description ? " · " + n.description : ""}
              </small>
            </Link>
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await api(
                    "knowledge-nodes/" + n.id,
                    { archived: !n.archived },
                    "PATCH",
                  );
                  reload();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {n.archived ? "取消归档" : "归档"}
            </button>
          </div>
          {depth < 30 && render(n.id, depth + 1)}
        </div>
      ));
  return (
    <div className="journal-knowledge">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONNECT THE DOTS</div>
          <h1>让知识，彼此连接。</h1>
          <p>按科目建立自己的知识树，从一个概念找到相关的思考。</p>
        </div>
      </div>
      <ErrorBox text={error || err || dictionaryError} />
      <div className="detail-grid knowledge-map">
        <section className="panel">
          <div className="section-title">
            <h2>我的知识地图</h2>
            <Badge>{nodes?.length || 0} 个节点</Badge>
          </div>
          {!loading && !firstActive && subjectGuide}
          {nodes?.length ? (
            render(null)
          ) : subject ? (
            <Empty
              title="从一个知识点开始"
              text="比如「极限与连续」或「进程与线程」，再逐渐补充它的分支。"
            />
          ) : null}
        </section>
        <form
          className="panel form-panel"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!subject) return;
            setError("");
            try {
              await api("knowledge-nodes", {
                name,
                subject,
                parentId: parentId || null,
                description,
              });
              setName("");
              setDescription("");
              notify("知识点已添加");
              reload();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <h3>添加知识点</h3>
          {loading ? (
            <p role="status">正在读取科目…</p>
          ) : (
            !subject && subjectGuide
          )}
          <label>
            名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              disabled={!subject}
            />
          </label>
          <label>
            所属科目
            <select
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setParent("");
              }}
            >
              <option value="">
                {firstActive ? "请选择科目" : "先创建或恢复科目"}
              </option>
              <DictionaryOptions kind="SUBJECT" value={subject} />
            </select>
          </label>
          <label>
            父知识点
            <select
              value={parentId}
              onChange={(e) => setParent(e.target.value)}
              disabled={!subject}
            >
              <option value="">作为根节点</option>
              {nodes
                ?.filter((n) => n.subject === subject && !n.archived)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            说明
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!subject}
            />
          </label>
          <button className="button full" disabled={!subject}>
            <Plus size={16} />
            添加知识点
          </button>
        </form>
      </div>
      <details className="panel form-panel knowledge-insights">
        <summary>学习诊断与统计（默认折叠）</summary>
        <AiDiagnosis />
        <LearningStatistics key={timezone} timezone={timezone} />
      </details>
      <KnowledgeTools nodes={nodes || []} onChange={reload} />
    </div>
  );
}
