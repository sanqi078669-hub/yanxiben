import { z } from "zod";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { entrySchema, settingsSchema, fields } from "../../lib/model";
import { AppError } from "../entries/service";
import { costSchema } from "../ai/pricing";
import { ATTACHMENT_MAX_BYTES } from "../../lib/capacity";
import { normalize } from "../dictionaries/normalize";

const id = z.string().uuid();
const integer = z.number().int().nonnegative();
const version = z.number().int().positive();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T12:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
const time = z.iso.datetime({ offset: true });
const text = z.string().max(50000);
const json = <T extends z.ZodType>(schema: T) =>
  z.string().transform((raw, ctx) => {
    try {
      const result = schema.safeParse(JSON.parse(raw));
      if (result.success) return result.data;
    } catch {
      /* Return a safe error without including backup contents. */
    }
    ctx.addIssue({ code: "custom", message: "JSON 内容结构无效" });
    return z.NEVER;
  });
const entry = entrySchema.superRefine((v, ctx) => {
  const allowed = [
    ...fields[v.type].map(([key]) => key),
    ...(v.type === "CS" ? ["subtype", "options_json"] : []),
  ];
  if (
    Object.keys(v.details).some((key) => !allowed.includes(key)) ||
    (v.type !== "VOCABULARY" && v.contexts.length)
  )
    ctx.addIssue({ code: "custom", message: "记录模板不匹配" });
  if (v.details.subtype && !["QUESTION", "CONCEPT"].includes(v.details.subtype))
    ctx.addIssue({ code: "custom", message: "题型无效" });
  if (
    v.details.options_json &&
    !json(z.array(z.string().max(2000)).max(20)).safeParse(
      v.details.options_json,
    ).success
  )
    ctx.addIssue({ code: "custom", message: "选项无效" });
});
const entryMeta = {
  id,
  owner: id,
  version,
  created_at: time,
  updated_at: time,
  deleted_at: time.nullable(),
};
const entryRow = z
  .object({
    ...entryMeta,
    type: entrySchema.shape.type,
    title: entrySchema.shape.title,
    subject: entrySchema.shape.subject,
    status: entrySchema.shape.status,
    body: text,
    payload: json(entry),
  })
  .strict();
const snapshot = entrySchema
  .extend(entryMeta)
  .strict()
  .superRefine((v, ctx) => {
    const {
      id: _id,
      owner: _owner,
      version: _version,
      created_at: _created,
      updated_at: _updated,
      deleted_at: _deleted,
      ...payload
    } = v;
    if (!entry.safeParse(payload).success)
      ctx.addIssue({ code: "custom", message: "快照模板无效" });
  });
const review = z
  .object({
    id,
    owner: id,
    entry_id: id,
    stage: z.enum(["NEW", "LEARNING", "MAINTENANCE", "PAUSED"]),
    stage_index: z.number().int().min(-1).max(5),
    success_streak: integer,
    due_on: date,
    version,
  })
  .strict()
  .refine(
    (v) =>
      v.stage === "PAUSED" ||
      (v.stage === "NEW"
        ? v.stage_index === -1 && v.success_streak === 0
        : v.stage_index >= 0 &&
          (v.stage === "MAINTENANCE"
            ? v.stage_index >= 3 && v.success_streak >= 3
            : v.stage_index < 3 || v.success_streak < 3)),
    "复习阶段不一致",
  );
const rating = z.enum(["AGAIN", "HARD", "GOOD", "EASY"]);
const mode = z.enum(["SCHEDULED", "PRACTICE"]);
const causes = z.array(z.string().trim().min(1).max(50)).max(30);
const logPayload = z
  .object({
    expectedVersion: version,
    mode,
    rating,
    hintUsed: z.boolean(),
    answerMd: text,
    errorCauses: causes.optional(),
    errorSnapshot: causes.optional(),
    before: review,
    after: review,
    algorithmVersion: z.literal("calendar-v1"),
  })
  .strict();
const knowledge = z
  .object({
    id,
    owner: id,
    subject: entrySchema.shape.subject,
    parent_id: id.nullable(),
    name: z.string().min(1).max(100),
    description: text,
    archived: z.union([z.literal(0), z.literal(1)]),
  })
  .strict();
const alias = z
  .object({ id, owner: id, node_id: id, name: z.string().min(1).max(100) })
  .strict();
const merge = z
  .object({
    before: z
      .object({
        source: knowledge,
        target: knowledge,
        records: z.array(entryRow),
        aliases: z.array(alias),
        children: z.array(knowledge),
      })
      .strict(),
    after: z
      .object({
        nodes: z.array(knowledge),
        records: z.array(entryRow),
        aliases: z.array(alias),
      })
      .strict(),
    aliasId: id,
  })
  .strict();
const result = z
  .object({
    attemptId: id,
    reviewLocalDate: date,
    nextDueOn: date,
    newVersion: version,
    algorithmVersion: z.literal("calendar-v1"),
  })
  .strict();
export const backupRowSchemas = {
  dictionary_items: z
    .object({
      owner: id,
      kind: z.enum(["TYPE", "SUBJECT", "ERROR"]),
      value: z.string().min(1).max(200),
      label: z.string().min(1).max(200),
      normalized_name: z.string().min(1).max(200),
      template: z.enum(["GENERIC", "MATH", "CS", "VOCABULARY", "SENTENCE"]),
      sort_order: z.number().int(),
      archived: z.union([z.literal(0), z.literal(1)]),
      version,
      created_at: z.string(),
      updated_at: z.string(),
    })
    .strict()
    .refine(
      (row) => row.normalized_name === normalize(row.label),
      "字典名称规范化不匹配",
    )
    .refine(
      (row) => row.template === "GENERIC" || row.kind === "TYPE",
      "只有类型可使用专用模板",
    ),
  entry_hint_usage: z
    .object({ owner: id, entry_id: id, review_version: integer, used_at: time })
    .strict(),
  entries: entryRow,
  attachments: z
    .object({
      id,
      owner: id,
      name: z.string().max(1000),
      mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
      size: z.number().int().positive().max(ATTACHMENT_MAX_BYTES),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      created_at: time,
    })
    .strict(),
  knowledge,
  relations: z
    .object({
      id,
      owner: id,
      from_id: id,
      to_id: id,
      type: z.enum(["SIMILAR", "SUPPORTS", "CONTRASTS", "CONTAINS_VOCABULARY"]),
    })
    .strict()
    .refine((v) => v.from_id !== v.to_id),
  reviews: review,
  logs: z
    .object({
      id,
      owner: id,
      review_id: id,
      mode,
      rating,
      local_date: date,
      payload: json(logPayload),
      created_at: time,
    })
    .strict(),
  revisions: z
    .object({
      id,
      owner: id,
      entry_id: id,
      version,
      snapshot: json(snapshot),
      reason: z.string().max(1000),
      created_at: time,
    })
    .strict(),
  idempotency: z
    .object({
      owner: id,
      scope: id,
      key: z.string().min(1).max(200),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      response: json(result),
      created_at: time,
    })
    .strict(),
  knowledge_aliases: alias,
  knowledge_merges: z
    .object({
      id,
      owner: id,
      payload: json(merge),
      undone: z.union([z.literal(0), z.literal(1)]),
    })
    .strict(),
  ai_audit: z
    .object({
      id,
      owner: id,
      action: z.string().min(1).max(200),
      model: z.string().max(200),
      host: z.string().max(300),
      created_at: time,
      duration: integer,
      status: z.enum(["success", "failed"]),
      tokens: integer.nullable(),
      result: json(z.record(z.string(), z.unknown())).nullable(),
      feedback: z.string().max(2000),
    })
    .strict(),
  ai_audit_extras: z
    .object({
      id,
      owner: id,
      payload: json(z.object({ cost: costSchema.nullable() }).strict()),
    })
    .strict(),
};
type Table = keyof typeof backupRowSchemas;
const invalid = (where: string): never => {
  throw new AppError(400, "INVALID_BACKUP", `备份内容无效：${where}`);
};

/** Validate before touching the destination. Parsed JSON is used only for checks;
 * original strings remain intact for lossless import and merge undo digests. */
export async function validateBackupData(
  data: Record<string, any>,
  files: Record<string, Uint8Array>,
) {
  const profile = z
    .object({ id, settings: settingsSchema })
    .strict()
    .safeParse(data.profile);
  if (!profile.success) invalid("profile");
  const owner = profile.success ? profile.data.id : invalid("profile");
  const parsed: Record<string, any[]> = {};
  for (const [table, schema] of Object.entries(backupRowSchemas)) {
    if (!Array.isArray(data[table])) invalid(table);
    const seen = new Set<string>();
    parsed[table] = data[table].map((raw: unknown, index: number) => {
      const row = schema.safeParse(raw);
      if (!row.success)
        invalid(
          `${table}[${index}] ${row.error.issues[0]?.path.join(".") || "row"}`,
        );
      const v = row.data as any;
      const key =
        table === "dictionary_items"
          ? JSON.stringify([v.kind, v.value])
          : table === "entry_hint_usage"
            ? JSON.stringify([v.entry_id, v.review_version])
            : table === "idempotency"
              ? JSON.stringify([v.scope, v.key])
              : v.id;
      if (v.owner !== owner || seen.has(key))
        invalid(`${table}[${index}] owner/id`);
      seen.add(key);
      return v;
    });
  }
  const maps = Object.fromEntries(
    Object.entries(parsed).map(([t, rows]) => [
      t,
      new Map(rows.map((r) => [r.id, r])),
    ]),
  );
  const unique = (rows: any[], key: (row: any) => string, where: string) => {
    const seen = new Set<string>();
    for (const row of rows) {
      const value = key(row);
      if (seen.has(value)) invalid(where);
      seen.add(value);
    }
  };
  unique(parsed.reviews, (row) => row.entry_id, "reviews unique entry");
  unique(
    parsed.dictionary_items.filter((row) => row.archived === 0),
    (row) => JSON.stringify([row.kind, row.normalized_name]),
    "dictionary_items active name",
  );
  unique(
    parsed.relations,
    (row) => JSON.stringify([row.from_id, row.to_id, row.type]),
    "relations unique tuple",
  );
  unique(
    parsed.logs.filter((row) => row.mode === "SCHEDULED"),
    (row) => JSON.stringify([row.review_id, row.local_date]),
    "logs unique scheduled day",
  );
  const has = (t: Table, key: string) => maps[t].has(key);
  const checkPayload = (p: z.infer<typeof entrySchema>, where: string) => {
    if (
      p.attachments.some((a) => !has("attachments", a.id)) ||
      p.knowledgeIds.some(
        (k) => maps.knowledge.get(k)?.subject !== p.subject,
      ) ||
      p.contexts.some(
        (c) =>
          c.sentence_entry_id &&
          maps.entries.get(c.sentence_entry_id)?.type !== "SENTENCE",
      )
    )
      invalid(where);
  };
  for (const e of parsed.entries) {
    if (
      ["type", "title", "subject", "status", "body"].some(
        (key) => e[key] !== e.payload[key],
      )
    )
      invalid("entries payload");
    checkPayload(e.payload, "entries references");
  }
  for (const k of parsed.knowledge) {
    const visited = new Set<string>([k.id]);
    let parent = k.parent_id;
    while (parent) {
      const node = maps.knowledge.get(parent);
      if (!node || node.subject !== k.subject || visited.has(parent))
        invalid("knowledge parent");
      visited.add(parent);
      parent = node.parent_id;
    }
  }
  for (const r of parsed.relations)
    if (!has("entries", r.from_id) || !has("entries", r.to_id))
      invalid("relations references");
  for (const r of parsed.reviews)
    if (!has("entries", r.entry_id)) invalid("reviews entry");
  for (const h of parsed.entry_hint_usage)
    if (!has("entries", h.entry_id)) invalid("entry_hint_usage references");
  for (const r of parsed.logs) {
    const p = r.payload;
    if (
      !has("reviews", r.review_id) ||
      p.mode !== r.mode ||
      p.rating !== r.rating ||
      p.before.id !== r.review_id ||
      p.after.id !== r.review_id ||
      p.before.owner !== owner ||
      p.after.owner !== owner ||
      p.before.entry_id !== maps.reviews.get(r.review_id).entry_id ||
      p.after.entry_id !== p.before.entry_id ||
      p.expectedVersion !== p.before.version
    )
      invalid("logs references");
  }
  for (const r of parsed.revisions) {
    if (
      !has("entries", r.entry_id) ||
      r.snapshot.owner !== owner ||
      r.snapshot.id !== r.entry_id ||
      r.snapshot.version !== r.version
    )
      invalid("revisions references");
    checkPayload(r.snapshot, "revisions snapshot references");
  }
  for (const r of parsed.idempotency)
    if (
      !has("reviews", r.scope) ||
      !has("logs", r.response.attemptId) ||
      maps.logs.get(r.response.attemptId).review_id !== r.scope
    )
      invalid("idempotency references");
  for (const a of parsed.knowledge_aliases)
    if (!has("knowledge", a.node_id)) invalid("knowledge_aliases references");
  for (const a of parsed.ai_audit_extras)
    if (!has("ai_audit", a.id)) invalid("ai_audit_extras references");
  for (const m of parsed.knowledge_merges) {
    const { before, after } = m.payload;
    for (const k of [
      before.source,
      before.target,
      ...before.children,
      ...after.nodes,
    ])
      if (k.owner !== owner || !has("knowledge", k.id))
        invalid("knowledge_merges nodes");
    for (const a of [...before.aliases, ...after.aliases])
      if (a.owner !== owner || !has("knowledge", a.node_id))
        invalid("knowledge_merges aliases");
    for (const e of [...before.records, ...after.records]) {
      if (e.owner !== owner || !has("entries", e.id))
        invalid("knowledge_merges entries");
      checkPayload(e.payload, "knowledge_merges payload");
    }
  }
  for (const a of parsed.attachments) {
    const bytes = files[`attachments/${a.id}`];
    if (
      !bytes ||
      bytes.length !== a.size ||
      createHash("sha256").update(bytes).digest("hex") !== a.sha256
    )
      invalid("attachments digest");
    try {
      const image = sharp(bytes, {
        limitInputPixels: 40000000,
        failOn: "warning",
        animated: true,
      });
      const meta = await image.metadata();
      const expected = {
        "image/png": "png",
        "image/jpeg": "jpeg",
        "image/webp": "webp",
      }[a.mime as "image/png"];
      if (meta.format !== expected || (meta.pages || 1) !== 1)
        invalid("attachments format");
      await image.stats(); // Decode pixels as well as headers, catching truncated files.
    } catch {
      invalid("attachments image");
    }
  }
  for (const name of Object.keys(files))
    if (name.startsWith("attachments/") && !has("attachments", name.slice(12)))
      invalid("attachments unreferenced file");
}
