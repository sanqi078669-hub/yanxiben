import { randomUUID } from "node:crypto";
import { z } from "zod";
import { all, one, run, transaction } from "../../lib/db";
import { assert } from "../entries/service";
import { normalize } from "./normalize";

export type DictionaryKind = "TYPE" | "SUBJECT" | "ERROR";
export type DictionaryItem = {
  value: string;
  label: string;
  template: "GENERIC" | "MATH" | "CS" | "VOCABULARY" | "SENTENCE";
  sortOrder: number;
  archived: boolean;
  version: number;
};

const kindSchema = z.enum(["TYPE", "SUBJECT", "ERROR"]);
export const templateSchema = z.enum([
  "GENERIC",
  "MATH",
  "CS",
  "VOCABULARY",
  "SENTENCE",
]);
export const labelSchema = z.string().trim().min(1).max(100);
export const patchSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    label: labelSchema.optional(),
    archived: z.boolean().optional(),
    sortOrder: z.number().int().nonnegative().safe().optional(),
  })
  .strict()
  .refine(
    (p) =>
      p.label !== undefined ||
      p.archived !== undefined ||
      p.sortOrder !== undefined,
    "请提供要修改的字段",
  );
export const orderSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            value: z.string().min(1),
            expectedVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .refine(
    (p) => new Set(p.items.map((item) => item.value)).size === p.items.length,
    "排序项不能重复",
  );

function get(
  owner: string,
  kind: DictionaryKind,
  value: string,
): DictionaryItem {
  const row = one(
    "SELECT value,label,template,sort_order sortOrder,archived,version FROM dictionary_items WHERE owner=? AND kind=? AND value=?",
    owner,
    kind,
    value,
  );
  assert(row, 404, "RESOURCE_NOT_FOUND", "字典项不存在");
  return { ...row, archived: !!row.archived } as DictionaryItem;
}

function checkName(
  owner: string,
  kind: DictionaryKind,
  label: string,
  except = "",
  includeArchived = true,
) {
  const duplicate = one(
    `SELECT archived FROM dictionary_items WHERE owner=? AND kind=? AND normalized_name=? AND value<>?${includeArchived ? "" : " AND archived=0"} ORDER BY archived LIMIT 1`,
    owner,
    kind,
    normalize(label),
    except,
  );
  assert(
    !duplicate,
    409,
    "NAME_TAKEN",
    duplicate?.archived ? "已有归档同名项，可恢复" : "已有同名项",
  );
}

export function create(
  owner: string,
  kind: DictionaryKind,
  label: string,
  template?: z.infer<typeof templateSchema>,
): DictionaryItem {
  kindSchema.parse(kind);
  label = labelSchema.parse(label);
  assert(
    kind === "TYPE" || template === undefined,
    400,
    "VALIDATION_ERROR",
    "只有类型可指定模板",
  );
  const selectedTemplate = templateSchema.parse(template ?? "GENERIC");
  return transaction(() => {
    checkName(owner, kind, label);
    const value = randomUUID(),
      now = new Date().toISOString();
    run(
      `INSERT INTO dictionary_items(owner,kind,value,label,normalized_name,template,sort_order,archived,version,created_at,updated_at)
      SELECT ?,?,?,?,?,?,coalesce(max(sort_order),-1)+1,0,1,?,? FROM dictionary_items WHERE owner=? AND kind=?`,
      owner,
      kind,
      value,
      label,
      normalize(label),
      selectedTemplate,
      now,
      now,
      owner,
      kind,
    );
    return get(owner, kind, value);
  });
}

export function update(
  owner: string,
  kind: DictionaryKind,
  value: string,
  raw: unknown,
): DictionaryItem {
  kindSchema.parse(kind);
  const patch = patchSchema.parse(raw);
  return transaction(() => {
    const current = get(owner, kind, value);
    assert(
      current.version === patch.expectedVersion,
      409,
      "VERSION_CONFLICT",
      "字典项已修改，请刷新后重试",
    );
    const label = patch.label ?? current.label;
    if (patch.label !== undefined) checkName(owner, kind, label, value);
    else if (patch.archived === false)
      checkName(owner, kind, label, value, false);
    run(
      "UPDATE dictionary_items SET label=?,normalized_name=?,archived=?,sort_order=?,version=version+1,updated_at=? WHERE owner=? AND kind=? AND value=?",
      label,
      normalize(label),
      (patch.archived ?? current.archived) ? 1 : 0,
      patch.sortOrder ?? current.sortOrder,
      new Date().toISOString(),
      owner,
      kind,
      value,
    );
    return get(owner, kind, value);
  });
}

export function rename(
  owner: string,
  kind: DictionaryKind,
  value: string,
  label: string,
  expectedVersion: number,
) {
  return update(owner, kind, value, { label, expectedVersion });
}
export function archive(
  owner: string,
  kind: DictionaryKind,
  value: string,
  expectedVersion: number,
) {
  return update(owner, kind, value, { archived: true, expectedVersion });
}
export function unarchive(
  owner: string,
  kind: DictionaryKind,
  value: string,
  expectedVersion: number,
) {
  return update(owner, kind, value, { archived: false, expectedVersion });
}

export function reorder(
  owner: string,
  kind: DictionaryKind,
  raw: unknown,
): DictionaryItem[] {
  kindSchema.parse(kind);
  const { items } = orderSchema.parse(raw);
  return transaction(() => {
    for (const item of items) {
      const current = get(owner, kind, item.value);
      assert(
        current.version === item.expectedVersion,
        409,
        "VERSION_CONFLICT",
        "字典项已修改，请刷新后重试",
      );
    }
    const now = new Date().toISOString();
    for (const [position, item] of items.entries())
      run(
        "UPDATE dictionary_items SET sort_order=?,version=version+1,updated_at=? WHERE owner=? AND kind=? AND value=?",
        position,
        now,
        owner,
        kind,
        item.value,
      );
    return list(owner, kind, true);
  });
}

export function list(
  owner: string,
  kind: DictionaryKind,
  includeArchived = false,
): DictionaryItem[] {
  return all(
    `SELECT value,label,template,sort_order sortOrder,archived,version
     FROM dictionary_items WHERE owner=? AND kind=?${includeArchived ? "" : " AND archived=0"}
     ORDER BY sort_order,value COLLATE BINARY`,
    owner,
    kind,
  ).map((row) => ({ ...row, archived: !!row.archived })) as DictionaryItem[];
}

/** Historical/archived names remain readable; unknown keys retain their text. */
export function labelOf(
  owner: string,
  kind: DictionaryKind,
  value: string,
): string {
  return (
    one(
      "SELECT label FROM dictionary_items WHERE owner=? AND kind=? AND value=?",
      owner,
      kind,
      value,
    )?.label ?? value
  );
}
