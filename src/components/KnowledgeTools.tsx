"use client";
import { useEffect, useState } from "react";
type Node = { id: string; name: string; subject: string; archived: number };
import { api } from "../lib/request";
function request(path: string, body?: unknown) {
  return api("knowledge-tools/" + path, body);
}
export function KnowledgeTools({
  nodes,
  onChange,
}: {
  nodes: Node[];
  onChange: () => void;
}) {
  const [merges, setMerges] = useState<
    { id: string; source: string; target: string; affected: number }[]
  >([]);
  const [source, setSource] = useState(""),
    [target, setTarget] = useState(""),
    [name, setName] = useState(""),
    [aliases, setAliases] = useState<
      { id: string; node_id: string; name: string }[]
    >([]),
    [preview, setPreview] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () =>
    Promise.all([
      request("aliases").then(setAliases),
      request("merges").then(setMerges),
    ]).catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await refresh();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="panel form-panel">
      <summary>知识点别名与同义合并</summary>
      <p>
        合并会迁移记录关联和直接子节点，原知识点保留并归档。不会因为名称相似自动合并。
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <label>
        保留的知识点
        <select
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setPreview(null);
          }}
        >
          <option value="">请选择</option>
          {nodes
            .filter((n) => !n.archived)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.subject} · {n.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        添加别名
        <input
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button
        className="button outline"
        disabled={busy || !target || !name.trim()}
        onClick={() =>
          act(async () => {
            await request("aliases", { nodeId: target, name });
            setName("");
            setMessage("别名已保存");
          })
        }
      >
        保存别名
      </button>
      <p>
        已有别名：
        {aliases
          .filter((a) => a.node_id === target)
          .map((a) => a.name)
          .join("、") || "暂无"}
      </p>
      <label>
        需要合并的知识点
        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setPreview(null);
          }}
        >
          <option value="">请选择</option>
          {nodes
            .filter((n) => !n.archived && n.id !== target)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.subject} · {n.name}
              </option>
            ))}
        </select>
      </label>
      <button
        className="button outline"
        disabled={busy || !source || !target}
        onClick={() =>
          act(async () => {
            setPreview(
              await request(
                "preview?" + new URLSearchParams({ source, target }),
              ),
            );
          })
        }
      >
        预览合并影响
      </button>
      {preview && (
        <div>
          <p>
            {preview.source} → {preview.target}，影响 {preview.records.length}{" "}
            条记录、{preview.children.length} 个直接子节点（包含回收站记录）。
          </p>
          <ul>
            {preview.records.map((e: any) => (
              <li key={e.id}>
                {e.title || "未命名记录"}
                {e.deleted ? "（已删除）" : ""}
              </li>
            ))}
          </ul>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await request("merge", {
                  sourceId: source,
                  targetId: target,
                  digest: preview.digest,
                  confirm: true,
                });
                setPreview(null);
                setMessage("合并完成，可在关联内容未继续修改前撤销。");
              })
            }
          >
            确认合并以上内容
          </button>
        </div>
      )}
      <h3>最近未撤销的合并</h3>
      <p>
        刷新后仍可在此撤销；关联记录、知识点或别名发生后续修改时会拒绝覆盖。
      </p>
      {merges.map((merge) => (
        <p key={merge.id}>
          {merge.source} → {merge.target} · {merge.affected} 条记录{" "}
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await request("undo", { id: merge.id });
                setMessage("已撤销合并");
              })
            }
          >
            撤销此合并
          </button>
        </p>
      ))}
    </details>
  );
}
