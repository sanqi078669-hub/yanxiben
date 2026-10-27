"use client";
import { useState } from "react";
import { names, types, type Template } from "../lib/model";
import { api } from "../lib/request";
import type { DictionaryItem } from "../modules/dictionaries/service";
import { useDictionary } from "./DictionaryContext";
import { DictionaryCreate } from "./DictionaryCreate";
import { ErrorBox } from "./ui";

export const templateNames: Record<Template, string> = {
  GENERIC: "通用",
  MATH: "数学",
  CS: "408",
  VOCABULARY: "生词",
  SENTENCE: "长难句",
};
export function TypeCreate({
  onCreated,
}: {
  onCreated?: (item: DictionaryItem) => void;
}) {
  const { items, reload, loading } = useDictionary();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="type-create">
      <DictionaryCreate kind="TYPE" onCreated={onCreated} />
      <details>
        <summary>从预设添加</summary>
        <p className="muted">预设决定字段，创建后不能更换模板。</p>
        <div className="type-presets">
          {types.map((template) => {
            const added = items.types.some(
              (item) => !item.archived && item.template === template,
            );
            return (
              <button
                type="button"
                className="button outline small"
                key={template}
                disabled={busy || loading || added}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const item = await api<DictionaryItem>(
                      "dictionaries/types",
                      { label: names[template], template },
                    );
                    await reload();
                    onCreated?.(item);
                  } catch (error) {
                    setError((error as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {names[template]}
                {added ? "（已添加）" : ""}
              </button>
            );
          })}
        </div>
        <ErrorBox text={error} />
      </details>
    </div>
  );
}
