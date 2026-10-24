"use client";
import { useState } from "react";
import Link from "next/link";

import { Plus, Network } from "lucide-react";

import { AiDiagnosis } from "./AiDiagnosis";

import { LearningStatistics } from "./LearningStatistics";

import { KnowledgeTools } from "./KnowledgeTools";

import { subjects } from "../lib/model";
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
  const [name, setName] = useState(""),
    [subject, setSubject] = useState("高等数学"),
    [parentId, setParent] = useState(""),
    [description, setDescription] = useState(""),
    [err, setError] = useState("");
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
                {n.subject}
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
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONNECT THE DOTS</div>
          <h1>让知识，彼此连接。</h1>
          <p>按科目建立自己的知识树，从一个概念找到相关的思考。</p>
        </div>
      </div>
      <ErrorBox text={error || err} />
      <AiDiagnosis />
      <LearningStatistics key={timezone} timezone={timezone} />
      <KnowledgeTools nodes={nodes || []} onChange={reload} />
      <div className="detail-grid">
        <section className="panel">
          <div className="section-title">
            <h2>我的知识地图</h2>
            <Badge>{nodes?.length || 0} 个节点</Badge>
          </div>
          {nodes?.length ? (
            render(null)
          ) : (
            <Empty
              title="从一个知识点开始"
              text="比如「极限与连续」或「进程与线程」，再逐渐补充它的分支。"
            />
          )}
        </section>
        <form
          className="panel form-panel"
          onSubmit={async (e) => {
            e.preventDefault();
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
          <label>
            名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
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
              {subjects.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            父知识点
            <select
              value={parentId}
              onChange={(e) => setParent(e.target.value)}
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
            />
          </label>
          <button className="button full">
            <Plus size={16} />
            添加知识点
          </button>
        </form>
      </div>
    </>
  );
}
