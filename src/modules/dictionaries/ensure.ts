import { all, run } from "../../lib/db";
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

/** Restore-time catch-up. Caller owns the transaction; imported rows win.
 * Active references precede history so normalization collisions keep an active
 * reference first, then the binary-smallest key, matching the v13 policy. */
export function ensureReferenced(owner: string) {
  const references = all(
    `WITH
    entry_sources(payload,active) AS (
      SELECT payload,deleted_at IS NULL FROM entries WHERE owner=?
      UNION ALL SELECT snapshot,0 FROM revisions WHERE owner=?
      UNION ALL SELECT json_extract(r.value,'$.payload'),0
        FROM knowledge_merges m,json_each(m.payload,'$.before.records') r WHERE m.owner=?
      UNION ALL SELECT json_extract(r.value,'$.payload'),0
        FROM knowledge_merges m,json_each(m.payload,'$.after.records') r WHERE m.owner=?
    ),
    knowledge_sources(node) AS (
      SELECT json_extract(payload,'$.before.source') FROM knowledge_merges WHERE owner=?
      UNION ALL SELECT json_extract(payload,'$.before.target') FROM knowledge_merges WHERE owner=?
      UNION ALL SELECT n.value FROM knowledge_merges m,json_each(m.payload,'$.before.children') n WHERE m.owner=?
      UNION ALL SELECT n.value FROM knowledge_merges m,json_each(m.payload,'$.after.nodes') n WHERE m.owner=?
    ),
    refs(kind,value,active) AS (
      SELECT 'TYPE',json_extract(payload,'$.type'),active FROM entry_sources WHERE json_type(payload,'$.type')='text'
      UNION ALL SELECT 'SUBJECT',json_extract(payload,'$.subject'),active FROM entry_sources WHERE json_type(payload,'$.subject')='text'
      UNION ALL SELECT 'ERROR',j.value,e.active FROM entry_sources e,json_each(e.payload,'$.errors') j WHERE j.type='text'
      UNION ALL SELECT 'SUBJECT',subject,archived=0 FROM knowledge WHERE owner=?
      UNION ALL SELECT 'SUBJECT',json_extract(node,'$.subject'),0 FROM knowledge_sources WHERE json_type(node,'$.subject')='text'
      UNION ALL SELECT 'ERROR',j.value,0 FROM logs l,json_each(l.payload,'$.errorCauses') j WHERE l.owner=? AND j.type='text'
      UNION ALL SELECT 'ERROR',j.value,0 FROM logs l,json_each(l.payload,'$.errorSnapshot') j WHERE l.owner=? AND j.type='text'
    )
    SELECT kind,value,max(active) active FROM refs GROUP BY kind,value
    ORDER BY kind,active DESC,value COLLATE BINARY`,
    owner,
    owner,
    owner,
    owner,
    owner,
    owner,
    owner,
    owner,
    owner,
    owner,
    owner,
  );
  for (const reference of references)
    ensure(
      owner,
      reference.kind as DictionaryKind,
      reference.value,
      !!reference.active,
    );
}
