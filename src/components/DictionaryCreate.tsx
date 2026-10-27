"use client";
import { useId, useState } from "react";
import { api } from "../lib/request";
import type { DictionaryItem } from "../modules/dictionaries/service";
import { dictionaryGroup, useDictionary } from "./DictionaryContext";
import { ErrorBox } from "./ui";

export function DictionaryCreate({
  kind,
  onCreated,
  expanded = false,
}: {
  kind: "TYPE" | "SUBJECT" | "ERROR";
  onCreated?: (item: DictionaryItem) => void;
  expanded?: boolean;
}) {
  const { reload } = useDictionary();
  const [open, setOpen] = useState(expanded),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const id = useId();
  const title = kind === "TYPE" ? "类型" : kind === "SUBJECT" ? "科目" : "错因";
  return (
    <div className="dictionary-create">
      {!open && !expanded ? (
        <button
          type="button"
          className="button outline small"
          onClick={() => setOpen(true)}
        >
          ＋ 新建{title}
        </button>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              const item = await api<DictionaryItem>(
                `dictionaries/${dictionaryGroup[kind]}`,
                { label: name },
              );
              await reload();
              onCreated?.(item);
              setName("");
              if (!expanded) setOpen(false);
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor={id}>{title}名称</label>
          <div className="dictionary-inline">
            <input
              id={id}
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              placeholder={`输入新${title}名称`}
            />
            <button type="submit" className="button small" disabled={busy}>
              {busy ? "创建中…" : `创建${title}`}
            </button>
            {!expanded && (
              <button
                type="button"
                className="button outline small"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                取消
              </button>
            )}
          </div>
          <ErrorBox text={error} />
        </form>
      )}
    </div>
  );
}
