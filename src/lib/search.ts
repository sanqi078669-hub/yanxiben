export function searchTokens(text: string) {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]{2}/g) || []).filter(
      (t) => t.length > 1,
    ),
  );
}
export function lexicalScore(candidate: string, source: string) {
  const words = new Set<string>(JSON.parse(source));
  return [...searchTokens(candidate)].filter((word) => words.has(word)).length;
}
import type { DatabaseSync } from "node:sqlite";
export function installSearchFunctions(db: DatabaseSync) {
  db.function("lexical_score", { deterministic: true }, (candidate, source) =>
    lexicalScore(String(candidate || ""), String(source || "[]")),
  );
  db.function(
    "search_document",
    { deterministic: true },
    (title, body, raw) => {
      const payload = JSON.parse(String(raw));
      return [
        title,
        body,
        payload.summary || "",
        payload.source || "",
        JSON.stringify(payload.details ?? {}),
        JSON.stringify(payload.contexts ?? []),
      ]
        .join(" ")
        .toLowerCase();
    },
  );
}
