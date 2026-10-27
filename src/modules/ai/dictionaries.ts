import { all } from "../../lib/db";
import { legacyTemplate, names, type Template } from "../../lib/model";
import { normalize } from "../dictionaries/normalize";
import type { DictionaryKind } from "../dictionaries/service";

/** One owner-scoped snapshot: active names for suggestions, archived names for history. */
export function aiDictionary(owner: string) {
  const rows = all(
    "SELECT kind,value,label,template,archived FROM dictionary_items WHERE owner=? ORDER BY sort_order,value",
    owner,
  );
  const active = (kind: DictionaryKind) =>
    rows.filter((row) => row.kind === kind && !row.archived);
  const label = (kind: DictionaryKind, value: string): string => {
    const name = rows
      .find((row) => row.kind === kind && row.value === value)
      ?.label?.trim();
    if (name) return name;
    if (kind === "TYPE" && legacyTemplate(value)) return names[value];
    // A missing transitional dictionary row must not disclose its opaque key.
    return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)
      ? { TYPE: "未配置类型", SUBJECT: "未配置科目", ERROR: "未配置错因" }[kind]
      : value;
  };
  const valueOf = (kind: DictionaryKind, name: string): string | undefined =>
    active(kind).find((row) => normalize(row.label) === normalize(name))?.value;
  const templateOf = (value: string): Template =>
    rows.find((row) => row.kind === "TYPE" && row.value === value)?.template ??
    legacyTemplate(value) ??
    "GENERIC";
  const material = <T>(input: T): T => {
    if (Array.isArray(input)) return input.map((item) => material(item)) as T;
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => {
        if ((key === "type" || key === "subject") && typeof value === "string")
          return [key, label(key === "type" ? "TYPE" : "SUBJECT", value)];
        if (
          ["errors", "errorTags", "errorCauses", "errorSnapshot"].includes(
            key,
          ) &&
          Array.isArray(value)
        )
          return [
            key,
            value.map((item) =>
              typeof item === "string" ? label("ERROR", item) : item,
            ),
          ];
        return [key, material(value)];
      }),
    ) as T;
  };
  return { active, label, valueOf, templateOf, material };
}
