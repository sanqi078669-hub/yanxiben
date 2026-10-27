"use client";
import { dictionaryGroup, useDictionary } from "./DictionaryContext";

/** Keep URL/form values intact, including archived and missing historical keys. */
export function DictionaryOptions({
  kind,
  value,
}: {
  kind: "SUBJECT" | "ERROR";
  value: string;
}) {
  const { items, label } = useDictionary();
  const options = [...items[dictionaryGroup[kind]]].sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) ||
      a.sortOrder - b.sortOrder ||
      a.value.localeCompare(b.value),
  );
  return (
    <>
      {options.map((item) => (
        <option key={item.value} value={item.value}>
          {label(kind, item.value)}
          {item.archived ? "（已归档）" : ""}
        </option>
      ))}
      {value && !options.some((item) => item.value === value) && (
        <option value={value}>{label(kind, value)}（不在字典中）</option>
      )}
    </>
  );
}
