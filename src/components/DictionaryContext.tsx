"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../lib/request";
import { legacyTemplate, names, type Template } from "../lib/model";
import type {
  DictionaryItem,
  DictionaryKind,
} from "../modules/dictionaries/service";

type Items = {
  types: DictionaryItem[];
  subjects: DictionaryItem[];
  errors: DictionaryItem[];
};
const empty: Items = { types: [], subjects: [], errors: [] };
export const dictionaryGroup = {
  TYPE: "types",
  SUBJECT: "subjects",
  ERROR: "errors",
} as const;
const fallbackLabel = (value: string) => (value.trim() ? value : "未命名");
export const dictionaryTemplate = (
  items: DictionaryItem[],
  value: string,
): Template =>
  items.find((item) => item.value === value)?.template ??
  legacyTemplate(value) ??
  "GENERIC";
export const DictionaryContext = createContext({
  items: empty,
  label: (kind: DictionaryKind, value: string) =>
    (kind === "TYPE" ? names[value] : undefined) ?? fallbackLabel(value),
  templateOf: (value: string): Template => dictionaryTemplate([], value),
  reload: async () => empty,
  loading: false,
  error: "",
});

export function DictionaryProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const active = useRef(false);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await api<Items>("dictionaries?includeArchived=1");
      if (active.current && current === generation.current) setItems(result);
      return result;
    } catch (error) {
      if (active.current && current === generation.current)
        setError((error as Error).message);
      throw error;
    } finally {
      if (active.current && current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    void reload().catch(() => {});
    return () => {
      active.current = false;
    };
  }, [reload]);
  const label = useCallback(
    (kind: DictionaryKind, value: string) =>
      items[dictionaryGroup[kind]]
        .find((item) => item.value === value)
        ?.label.trim() || fallbackLabel(value),
    [items],
  );
  const templateOf = useCallback(
    (value: string): Template => dictionaryTemplate(items.types, value),
    [items.types],
  );
  return (
    <DictionaryContext.Provider
      value={{ items, label, templateOf, reload, loading, error }}
    >
      {children}
    </DictionaryContext.Provider>
  );
}

export const useDictionary = () => useContext(DictionaryContext);

export function DictionaryLabel({
  kind,
  value,
  markArchived = false,
}: {
  kind: DictionaryKind;
  value: string;
  markArchived?: boolean;
}) {
  const { items, label } = useDictionary();
  return (
    <>
      {label(kind, value)}
      {markArchived &&
      items[dictionaryGroup[kind]].some(
        (item) => item.value === value && item.archived,
      )
        ? "（已归档）"
        : ""}
    </>
  );
}
