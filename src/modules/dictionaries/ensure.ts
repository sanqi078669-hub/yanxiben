import { run } from "../../lib/db";
import { normalize } from "./normalize";
import type { DictionaryKind } from "./service";

const typeLabels: Record<string, string> = {
  MATH: "数学错题",
  CS: "408 专业课",
  VOCABULARY: "英语生词",
  SENTENCE: "英语长难句",
};
export function defaultLabel(kind: DictionaryKind, value: string) {
  return kind === "TYPE" ? (typeLabels[value] ?? value) : value;
}

/** Caller owns the business transaction. Existing rows are never modified. */
export function ensure(
  owner: string,
  kind: DictionaryKind,
  value: string,
  active = true,
) {
  const label = defaultLabel(kind, value);
  const normalized = normalize(label);
  const template =
    kind === "TYPE" && Object.hasOwn(typeLabels, value) ? value : "GENERIC";
  const now = new Date().toISOString();
  // Keep a distinct legacy key even if its name is already used by a custom item.
  run(
    `INSERT OR IGNORE INTO dictionary_items(owner,kind,value,label,normalized_name,template,sort_order,archived,version,created_at,updated_at)
     SELECT ?,?,?,?,?,?,coalesce(max(sort_order),-1)+1,
       CASE WHEN ?=0 OR EXISTS(SELECT 1 FROM dictionary_items WHERE owner=? AND kind=? AND normalized_name=? AND archived=0) THEN 1 ELSE 0 END,
       1,?,? FROM dictionary_items WHERE owner=? AND kind=?`,
    owner,
    kind,
    value,
    label,
    normalized,
    template,
    active ? 1 : 0,
    owner,
    kind,
    normalized,
    now,
    now,
    owner,
    kind,
  );
}

export function ensureEntry(
  owner: string,
  entry: { type: string; subject: string; errors: string[] },
  active = true,
) {
  ensure(owner, "TYPE", entry.type, active);
  ensure(owner, "SUBJECT", entry.subject, active);
  for (const error of new Set(entry.errors))
    ensure(owner, "ERROR", error, active);
}
