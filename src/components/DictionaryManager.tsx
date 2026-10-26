"use client";
import { useState } from "react";
import { api, RequestError } from "../lib/request";
import type { DictionaryItem } from "../modules/dictionaries/service";
import { dictionaryGroup, useDictionary } from "./DictionaryContext";
import { DictionaryCreate } from "./DictionaryCreate";
import { ErrorBox } from "./ui";

function DictionaryGroup({ kind }: { kind: "SUBJECT" | "ERROR" }) {
  const { items, reload, loading, error } = useDictionary();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const title = kind === "SUBJECT" ? "科目" : "错因";
  const rows = items[dictionaryGroup[kind]];
  const active = rows.filter((item) => !item.archived),
    archived = rows.filter((item) => item.archived);
  const execute = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await reload();
    } catch (error) {
      if (error instanceof RequestError && error.code === "VERSION_CONFLICT") {
        try {
          await reload();
        } catch {}
        setMessage(error.message + " 列表已刷新，请检查后重试。");
      } else setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const patch = (item: DictionaryItem, patch: Record<string, unknown>) =>
    execute(() =>
      api(
        `dictionaries/${dictionaryGroup[kind]}/${encodeURIComponent(item.value)}`,
        { expectedVersion: item.version, ...patch },
        "PATCH",
      ),
    );
  const move = (index: number, offset: number) => {
    const reordered = [...active];
    [reordered[index], reordered[index + offset]] = [
      reordered[index + offset],
      reordered[index],
    ];
    return execute(() =>
      api(
        `dictionaries/${dictionaryGroup[kind]}/order`,
        {
          items: reordered.map((item) => ({
            value: item.value,
            expectedVersion: item.version,
          })),
        },
        "PATCH",
      ),
    );
  };
  const renderRow = (item: DictionaryItem, index: number) => (
    <DictionaryRow
      key={item.value}
      item={item}
      busy={busy || loading}
      onPatch={(patchValue) => patch(item, patchValue)}
      onMove={(offset) => move(index, offset)}
      first={index === 0}
      last={index === active.length - 1}
    />
  );
  return (
    <section className="dictionary-group" aria-label={`${title}管理`}>
      <h3>{title}</h3>
      <ErrorBox text={message || error} />
      {!active.length && !loading && (
        <p className="muted">还没有可用{title}，可以新建或恢复归档项。</p>
      )}
      <div>{active.map(renderRow)}</div>
      <DictionaryCreate kind={kind} />
      {archived.length > 0 && (
        <details className="dictionary-archived">
          <summary>
            已归档{title}（{archived.length}）
          </summary>
          {archived.map(renderRow)}
        </details>
      )}
    </section>
  );
}

function DictionaryRow({
  item,
  busy,
  onPatch,
  onMove,
  first,
  last,
}: {
  item: DictionaryItem;
  busy: boolean;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onMove: (offset: number) => Promise<void>;
  first: boolean;
  last: boolean;
}) {
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(item.label);
  return (
    <div className="dictionary-row">
      <div className="dictionary-name">
        <strong>{item.label}</strong>
        {item.archived && <span className="muted">（已归档）</span>}
      </div>
      <div className="dictionary-actions">
        <button
          type="button"
          className="button outline small"
          disabled={busy}
          onClick={() => {
            setName(item.label);
            setEditing(!editing);
          }}
        >
          改名
        </button>
        <button
          type="button"
          className="button outline small"
          disabled={busy}
          onClick={() => onPatch({ archived: !item.archived })}
        >
          {item.archived ? "恢复" : "归档"}
        </button>
        {!item.archived && (
          <>
            <button
              type="button"
              className="button outline small"
              aria-label={`${item.label}上移`}
              disabled={busy || first}
              onClick={() => onMove(-1)}
            >
              ↑ 上移
            </button>
            <button
              type="button"
              className="button outline small"
              aria-label={`${item.label}下移`}
              disabled={busy || last}
              onClick={() => onMove(1)}
            >
              ↓ 下移
            </button>
          </>
        )}
      </div>
      {editing && (
        <form
          className="dictionary-rename"
          onSubmit={(event) => {
            event.preventDefault();
            void onPatch({ label: name });
          }}
        >
          <label>
            {item.label}的新名称
            <input
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          </label>
          <button type="submit" className="button small" disabled={busy}>
            保存名称
          </button>
          <button
            type="button"
            className="button outline small"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            取消
          </button>
        </form>
      )}
    </div>
  );
}

export default function DictionaryManager() {
  const { loading, error, reload } = useDictionary();
  return (
    <section
      className="panel form-panel dictionary-manager"
      aria-label="分类管理"
    >
      <h2>分类管理</h2>
      <p className="muted">
        管理科目与错因。改名会更新记录中的显示名称；归档后仍保留已有记录。
      </p>
      {loading && <p role="status">正在读取分类…</p>}
      {error && (
        <button
          type="button"
          className="button outline small"
          onClick={() => void reload().catch(() => {})}
        >
          重试读取分类
        </button>
      )}
      <div className="dictionary-groups">
        <DictionaryGroup kind="SUBJECT" />
        <DictionaryGroup kind="ERROR" />
      </div>
    </section>
  );
}
