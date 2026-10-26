import { z } from "zod";
import {
  list,
  create,
  update,
  reorder,
  labelSchema,
  templateSchema,
  type DictionaryKind,
} from "../../dictionaries/service";
import type { ApiContext } from "../context";

export async function dictionariesHandler(context: ApiContext) {
  const { req, p, parts, method, owner, ok, json } = context;
  if (p === "dictionaries" && method === "GET") {
    const includeArchived = z
      .enum(["0", "1"])
      .parse(req.nextUrl.searchParams.get("includeArchived") ?? "0");
    return ok({
      types: list(owner, "TYPE", includeArchived === "1"),
      subjects: list(owner, "SUBJECT", includeArchived === "1"),
      errors: list(owner, "ERROR", includeArchived === "1"),
    });
  }
  const kinds: Record<string, DictionaryKind> = {
    types: "TYPE",
    subjects: "SUBJECT",
    errors: "ERROR",
  };
  const kind = Object.hasOwn(kinds, parts[1]) ? kinds[parts[1]] : undefined;
  if (parts[0] !== "dictionaries" || !kind) return;
  if (parts.length === 2 && method === "POST") {
    const body = z
      .object({ label: labelSchema, template: templateSchema.optional() })
      .strict()
      .parse(await json());
    return ok(create(owner, kind, body.label, body.template));
  }
  if (parts.length === 3 && parts[2] === "order" && method === "PATCH")
    return ok(reorder(owner, kind, await json()));
  if (parts.length === 3 && method === "PATCH")
    return ok(update(owner, kind, parts[2], await json()));
}
