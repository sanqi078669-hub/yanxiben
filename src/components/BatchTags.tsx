"use client";
import { useState } from "react";
import { api } from "../lib/request";
import type { Entry } from "../lib/model";
type Receipt = {
  id: string;
  results: { id: string; ok: boolean; message: string }[];
};
export function BatchTags({
  items,
  reload,
}: {
  items: Pick<Entry, "id" | "version" | "title">[];
  reload: () => unknown;
}) {
  const [operation, setOperation] = useState<"tags" | "pause">("tags"),
    [plans, setPlans] = useState<
      { id: string; reviewVersion: number | null; message: string }[]
    >([]);
  const [selected, setSelected] = useState<string[]>([]),
    [tag, setTag] = useState(""),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState<Receipt | null>(null);
  const [undone, setUndone] = useState(false);
  const chosen = items.filter((e) => selected.includes(e.id));
  return (
    <details className="panel form-panel">
      <summary>批量整理：标签与复习计划（仅当前页，最多 20 条）</summary>
      <p>
        勾选当前页内记录并核对范围。添加标签保留原标签，暂停计划保留作答历史；操作可撤销，发生后续编辑时会提示冲突。
      </p>
      <fieldset disabled={busy}>
        <label>
          批量操作
          <select
            value={operation}
            onChange={(e) => {
              setOperation(e.target.value as "tags" | "pause");
              setPreview(false);
            }}
          >
            <option value="tags">添加标签</option>
            <option value="pause">暂停复习计划</option>
          </select>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={items.length > 0 && chosen.length === items.length}
            onChange={(e) => {
              setSelected(e.target.checked ? items.map((i) => i.id) : []);
              setPreview(false);
            }}
          />
          选择当前页全部 {items.length} 条
        </label>
        {items.map((e) => (
          <label className="checkbox-label" key={e.id}>
            <input
              type="checkbox"
              checked={selected.includes(e.id)}
              onChange={(v) => {
                setSelected((old) =>
                  v.target.checked
                    ? [...old, e.id]
                    : old.filter((i) => i !== e.id),
                );
                setPreview(false);
              }}
            />
            {e.title || "未命名记录"}
          </label>
        ))}
        {operation === "tags" && (
          <label>
            要添加的标签
            <input
              maxLength={50}
              value={tag}
              onChange={(e) => {
                setTag(e.target.value);
                setPreview(false);
              }}
            />
          </label>
        )}
        <button
          className="button outline"
          disabled={!chosen.length || (operation === "tags" && !tag.trim())}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              if (operation === "pause")
                setPlans(
                  await api(
                    "entries/batch-review-preview",
                    chosen.map((e) => ({ id: e.id, version: e.version })),
                  ),
                );
              setPreview(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          预览影响范围
        </button>
        {preview && (
          <section>
            <h3>
              {operation === "tags"
                ? `将为以下 ${chosen.length} 条记录添加“${tag.trim()}”`
                : `将尝试暂停以下 ${chosen.length} 条记录的复习计划`}
            </h3>
            <ul>
              {chosen.map((e) => (
                <li key={e.id}>
                  {e.title || "未命名记录"} · 版本 {e.version}
                  {operation === "pause"
                    ? " · " + plans.find((p) => p.id === e.id)?.message
                    : ""}
                </li>
              ))}
            </ul>
            <button
              className="button"
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  setReceipt(
                    await api<Receipt>(
                      operation === "tags"
                        ? "entries/batch-tags"
                        : "entries/batch-pause",
                      {
                        items: chosen.map((e) => ({
                          id: e.id,
                          version: e.version,
                          ...(operation === "pause"
                            ? {
                                reviewVersion:
                                  plans.find((p) => p.id === e.id)
                                    ?.reviewVersion ?? null,
                              }
                            : {}),
                        })),
                        ...(operation === "tags" ? { tag } : {}),
                        confirm: true,
                      },
                    ),
                  );
                  setSelected([]);
                  setPreview(false);
                  setUndone(false);
                  reload();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {operation === "tags" ? "确认添加标签" : "确认暂停以上计划"}
            </button>
          </section>
        )}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {receipt && (
        <section role="status">
          <p>
            成功 {receipt.results.filter((r) => r.ok).length} 条；失败{" "}
            {receipt.results.filter((r) => !r.ok).length} 条。
          </p>
          <ul>
            {receipt.results.map((r) => (
              <li key={r.id}>
                {items.find((e) => e.id === r.id)?.title || r.id}：{r.message}
              </li>
            ))}
          </ul>
          <button
            disabled={busy || undone}
            className="button outline"
            onClick={async () => {
              setBusy(true);
              try {
                const result = await api<Receipt>("entries/batch-undo", {
                  id: receipt.id,
                });
                setReceipt(result);
                setUndone(result.results.every((r) => r.ok));
                reload();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {undone ? "已撤销" : "撤销本次批量修改"}
          </button>
        </section>
      )}
    </details>
  );
}
