import { randomUUID, createHash } from "node:crypto";
import { all, one, run, transaction } from "../../lib/db";
import {
  entrySchema,
  fields,
  defaults,
  type Entry,
  type Review,
} from "../../lib/model";
import { localDate, schedule } from "../review/schedule";
import { z } from "zod";
import type { EntryList, EntryListItem } from "../../lib/api-types";
import { reviewAttemptSchema } from "../../lib/review-contract";
import { ensureEntry } from "../dictionaries/ensure";
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  ok: unknown,
  status = 400,
  code = "VALIDATION_ERROR",
  message = "输入不符合要求",
): asserts ok {
  if (!ok) throw new AppError(status, code, message);
}
export function settings(owner: string) {
  return JSON.parse(
    one("SELECT settings FROM users WHERE id=?", owner)!.settings,
  ) as typeof defaults;
}
export function unpack(row: Record<string, any>): Entry {
  const { payload, ...rest } = row;
  return { ...rest, ...entrySchema.parse(JSON.parse(payload)) } as Entry;
}
export function getEntry(owner: string, id: string, deleted = false) {
  const row = one(
    "SELECT * FROM entries WHERE id=? AND owner=?" +
      (deleted ? "" : " AND deleted_at IS NULL"),
    id,
    owner,
  );
  assert(row, 404, "RESOURCE_NOT_FOUND", "记录不存在");
  return unpack(row);
}
const listColumns = `id,owner,type,title,subject,status,substr(body,1,200) body,
  coalesce(json_extract(payload,'$.source'),'') source,version,created_at,updated_at,deleted_at,
  json_extract(payload,'$.details.lemma') lemma,json_extract(payload,'$.details.part_of_speech') partOfSpeech`;
export function entries(owner: string, q: URLSearchParams): EntryList {
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(q.get("limit") ?? 20);
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(1000000)
    .parse(q.get("page") ?? 1);
  const where = [
    "owner=?",
    "deleted_at IS " + (q.get("trash") === "1" ? "NOT NULL" : "NULL"),
  ];
  const args: (string | number)[] = [owner];
  for (const key of ["type", "subject", "status"])
    if (q.get(key)) {
      where.push(key + "=?");
      args.push(q.get(key)!);
    }
  if (q.get("q")) {
    where.push(
      "id IN (SELECT entry_id FROM entry_search WHERE owner=? AND instr(document,?)>0)",
    );
    args.push(owner, q.get("q")!.toLowerCase());
  }
  for (const filter of ["knowledge", "error", "tag"])
    if (q.get(filter)) {
      where.push(
        "id IN (SELECT entry_id FROM entry_filter_values WHERE owner=? AND kind=? AND value=?)",
      );
      args.push(
        owner,
        filter,
        filter === "tag" ? q.get(filter)!.trim().toLowerCase() : q.get(filter)!,
      );
    }
  const predicate = where.join(" AND ");
  const total = one(
    "SELECT count(*) n FROM entries WHERE " + predicate,
    ...args,
  )!.n as number;
  const items = all(
    `SELECT ${listColumns} FROM entries WHERE ${predicate} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`,
    ...args,
    limit,
    (page - 1) * limit,
  ) as EntryListItem[];
  return { items, total, page, limit };
}
export function dashboard(owner: string) {
  const queue = reviewQueue(owner);
  const counts = one(
    "SELECT count(*) total,coalesce(sum(status='INBOX'),0) inbox FROM entries WHERE owner=? AND deleted_at IS NULL",
    owner,
  ) as { total: number; inbox: number };
  return {
    ...counts,
    queue,
    recent: all(
      `SELECT ${listColumns} FROM entries WHERE owner=? AND deleted_at IS NULL ORDER BY updated_at DESC,id LIMIT 5`,
      owner,
    ),
    studied: one(
      "SELECT count(*) n FROM logs WHERE owner=? AND local_date=?",
      owner,
      queue.date,
    )!.n,
    byType: all(
      "SELECT type,count(*) n FROM entries WHERE owner=? AND deleted_at IS NULL GROUP BY type",
      owner,
    ),
  };
}
function validate(owner: string, input: unknown, previous?: Entry) {
  const e = entrySchema.parse(input);
  assert(
    e.type === "VOCABULARY" || e.contexts.length === 0,
    400,
    "VALIDATION_ERROR",
    "只有生词记录可以添加语境",
  );
  const allowed = [
    ...fields[e.type].map((f) => f[0]),
    ...(e.type === "CS" ? ["subtype", "options_json"] : []),
  ];
  assert(Object.keys(e.details).every((k) => allowed.includes(k)));
  if (e.type === "CS" && e.details.subtype)
    assert(["QUESTION", "CONCEPT"].includes(e.details.subtype));
  if (e.details.options_json) {
    try {
      assert(
        z
          .array(z.string().max(2000))
          .max(20)
          .safeParse(JSON.parse(e.details.options_json)).success,
      );
    } catch {
      throw new AppError(400, "VALIDATION_ERROR", "选项应为 JSON 字符串数组");
    }
  }
  for (const a of e.attachments)
    assert(
      one("SELECT id FROM attachments WHERE id=? AND owner=?", a.id, owner),
      400,
      "VALIDATION_ERROR",
      "附件不存在或不属于当前账号",
    );
  assert(
    e.body.trim() || e.attachments.some((a) => a.role === "PROMPT"),
    400,
    "VALIDATION_ERROR",
    "请填写原文或上传题面图片",
  );
  if (e.type === "SENTENCE" && e.status === "ORGANIZED")
    assert(
      e.body.trim(),
      400,
      "VALIDATION_ERROR",
      "长难句整理完成前需要填写原句",
    );
  for (const id of e.knowledgeIds)
    assert(
      one(
        "SELECT id FROM knowledge WHERE id=? AND owner=? AND subject=?",
        id,
        owner,
        e.subject,
      ),
      400,
      "VALIDATION_ERROR",
      "知识点与科目不匹配",
    );
  for (const c of e.contexts) {
    if (!c.sentence_entry_id) continue;
    const target = getEntry(owner, c.sentence_entry_id, true);
    assert(target.type === "SENTENCE");
    assert(
      !target.deleted_at ||
        previous?.contexts.some((old) => old.sentence_entry_id === target.id),
      400,
      "VALIDATION_ERROR",
      "不能新增指向已删除长难句的关联",
    );
  }
  e.tags = [...new Set(e.tags.map((t) => t.toLowerCase()))];
  return e;
}
function snapshot(e: Entry, reason: string) {
  run(
    "INSERT INTO revisions VALUES(?,?,?,?,?,?,?)",
    randomUUID(),
    e.owner,
    e.id,
    e.version,
    JSON.stringify(e),
    reason,
    new Date().toISOString(),
  );
}
export function createEntry(owner: string, input: unknown) {
  return transaction(() => {
    const e = validate(owner, input);
    ensureEntry(owner, e);
    const id = randomUUID(),
      now = new Date().toISOString();
    run(
      "INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)",
      id,
      owner,
      e.type,
      e.title,
      e.subject,
      e.status,
      e.body,
      JSON.stringify(e),
      1,
      now,
      now,
    );
    return getEntry(owner, id);
  });
}
export function updateEntry(
  owner: string,
  id: string,
  input: unknown,
  beforeCommit?: (entry: Entry) => void,
) {
  const { expectedVersion, manual, ...patch } = z
    .object({
      expectedVersion: z.number().int(),
      manual: z.boolean().optional(),
    })
    .passthrough()
    .parse(input);
  return transaction(() => {
    const current = getEntry(owner, id);
    assert(
      current.version === expectedVersion,
      409,
      "VERSION_CONFLICT",
      "其他页面已修改此记录；你的输入仍保留，请比较版本后重试。",
    );
    const {
      id: _id,
      owner: _owner,
      version: _version,
      created_at: _created_at,
      updated_at: _updated_at,
      deleted_at: _deleted_at,
      ...old
    } = current;
    assert(
      !("type" in patch) || patch.type === old.type,
      400,
      "VALIDATION_ERROR",
      "类型不可直接修改，请新建记录",
    );
    const e = validate(
      owner,
      {
        ...old,
        ...patch,
        details: { ...old.details, ...((patch.details as object) || {}) },
      },
      current,
    );
    ensureEntry(owner, e);
    const last = one(
      "SELECT created_at FROM revisions WHERE entry_id=? ORDER BY created_at DESC LIMIT 1",
      id,
    );
    if (
      manual ||
      e.status !== current.status ||
      !last ||
      Date.now() - Date.parse(last.created_at) > 300000
    )
      snapshot(current, manual ? "MANUAL" : "AUTO");
    run(
      "UPDATE entries SET title=?,subject=?,status=?,body=?,payload=?,version=version+1,updated_at=? WHERE id=? AND owner=?",
      e.title,
      e.subject,
      e.status,
      e.body,
      JSON.stringify(e),
      new Date().toISOString(),
      id,
      owner,
    );
    const saved = getEntry(owner, id);
    beforeCommit?.(saved);
    return saved;
  });
}
export function trashEntry(owner: string, id: string, restore = false) {
  return transaction(() => {
    const e = getEntry(owner, id, true);
    if (!restore && e.deleted_at) return e;
    assert(
      !restore || e.deleted_at,
      409,
      "NOT_DELETED",
      "这条记录未被删除，无需恢复",
    );
    snapshot(e, restore ? "RESTORE" : "DELETE");
    run(
      "UPDATE entries SET deleted_at=?,updated_at=?,version=version+1 WHERE id=?",
      restore ? null : new Date().toISOString(),
      new Date().toISOString(),
      id,
    );
    run(
      "UPDATE reviews SET stage='PAUSED',version=version+1 WHERE entry_id=?",
      id,
    );
    return getEntry(owner, id, true);
  });
}
export function addReview(owner: string, entryId: string, practice = false) {
  getEntry(owner, entryId);
  const old = one(
    "SELECT * FROM reviews WHERE entry_id=? AND owner=?",
    entryId,
    owner,
  );
  if (old) return old;
  const id = randomUUID();
  run(
    "INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?)",
    id,
    owner,
    entryId,
    practice ? "PAUSED" : "NEW",
    -1,
    0,
    localDate(settings(owner).timezone),
    1,
  );
  return one("SELECT * FROM reviews WHERE id=?", id)!;
}
export function reviewQueue(owner: string) {
  const s = settings(owner),
    date = localDate(s.timezone);
  const predicate =
    "r.owner=? AND e.owner=? AND e.deleted_at IS NULL AND r.stage<>'PAUSED' AND r.due_on<=?";
  const rows = all(
    `WITH eligible AS MATERIALIZED (
      SELECT r.*,CASE WHEN (SELECT l.rating FROM logs l WHERE l.review_id=r.id ORDER BY l.created_at DESC LIMIT 1) IN ('AGAIN','HARD') THEN 0 ELSE 1 END priority
      FROM reviews r JOIN entries e ON e.id=r.entry_id WHERE ${predicate}
    ), due AS (SELECT * FROM eligible ORDER BY due_on,priority,id LIMIT ?)
    SELECT due.*,(SELECT count(*) FROM eligible) queue_total,e.payload entry_payload,e.version entry_version,e.created_at entry_created,e.updated_at entry_updated
    FROM due JOIN entries e ON e.id=due.entry_id ORDER BY due.due_on,due.priority,due.id`,
    owner,
    owner,
    date,
    s.dailyLimit,
  );
  const total = rows[0]?.queue_total ?? 0;
  return {
    items: rows.map((row) => {
      const {
        entry_payload,
        entry_version,
        entry_created,
        entry_updated,
        priority: _priority,
        queue_total: _total,
        ...r
      } = row;
      return {
        ...r,
        entry: {
          ...entrySchema.parse(JSON.parse(entry_payload)),
          id: r.entry_id,
          owner: r.owner,
          version: entry_version,
          created_at: entry_created,
          updated_at: entry_updated,
          deleted_at: null,
        } as Entry,
      };
    }),
    total,
    date,
  };
}
export function hintReviewVersion(owner: string, entryId: string) {
  getEntry(owner, entryId);
  return (
    (one(
      "SELECT version FROM reviews WHERE owner=? AND entry_id=?",
      owner,
      entryId,
    )?.version as number | undefined) ?? 0
  );
}
export function recordEntryHint(
  owner: string,
  entryId: string,
  expectedVersion: number,
) {
  return transaction(() => {
    assert(
      hintReviewVersion(owner, entryId) === expectedVersion,
      409,
      "VERSION_CONFLICT",
      "复习计划已变化，请刷新后重新请求提示",
    );
    run(
      "INSERT OR REPLACE INTO entry_hint_usage VALUES(?,?,?,?)",
      owner,
      entryId,
      expectedVersion,
      new Date().toISOString(),
    );
    return true;
  });
}
export function serverHintUsed(
  owner: string,
  entryId: string,
  reviewVersion: number,
) {
  return !!one(
    "SELECT entry_id FROM entry_hint_usage WHERE owner=? AND entry_id=? AND review_version IN (0,?)",
    owner,
    entryId,
    reviewVersion,
  );
}
export function attempt(
  owner: string,
  id: string,
  input: unknown,
  key: string,
) {
  const body = reviewAttemptSchema.parse(input);
  assert(key && key.length <= 200, 400, "VALIDATION_ERROR", "缺少幂等请求标识");
  assert(
    !(body.hintUsed && body.rating === "EASY"),
    400,
    "VALIDATION_ERROR",
    "使用提示后不能选择熟练",
  );
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return transaction(() => {
    const existing = one(
      "SELECT * FROM idempotency WHERE owner=? AND scope=? AND key=?",
      owner,
      id,
      key,
    );
    if (existing) {
      assert(
        existing.hash === hash,
        409,
        "IDEMPOTENCY_CONFLICT",
        "请求标识已用于其他内容",
      );
      return JSON.parse(existing.response);
    }
    const r = one("SELECT * FROM reviews WHERE id=? AND owner=?", id, owner) as
      | Review
      | undefined;
    assert(r, 404, "RESOURCE_NOT_FOUND", "复习项不存在");
    const reviewedEntry = getEntry(owner, r.entry_id);
    const hintUsed =
      body.hintUsed || serverHintUsed(owner, r.entry_id, r.version);
    assert(
      !(hintUsed && body.rating === "EASY"),
      400,
      "VALIDATION_ERROR",
      "本轮已使用提示，不能选择熟练",
    );
    assert(
      r.version === body.expectedVersion,
      409,
      "VERSION_CONFLICT",
      "复习计划已更新，请刷新",
    );
    const s = settings(owner),
      day = localDate(s.timezone);
    let after = { ...r };
    if (body.mode === "SCHEDULED") {
      assert(r.stage !== "PAUSED", 409, "PAUSED", "此计划已暂停");
      assert(r.due_on <= day, 400, "NOT_DUE", "尚未到期");
      assert(
        !one(
          "SELECT id FROM logs WHERE review_id=? AND local_date=? AND mode='SCHEDULED'",
          id,
          day,
        ),
        409,
        "ALREADY_REVIEWED_TODAY",
        "今天已完成计划复习，请使用主动练习",
      );
      after = {
        ...r,
        ...schedule(r, body.rating, day, s.intervals),
        version: r.version + 1,
      };
      run(
        "UPDATE reviews SET stage=?,stage_index=?,success_streak=?,due_on=?,version=? WHERE id=?",
        after.stage,
        after.stage_index,
        after.success_streak,
        after.due_on,
        after.version,
        id,
      );
    }
    const result = {
      attemptId: randomUUID(),
      reviewLocalDate: day,
      nextDueOn: after.due_on,
      newVersion: after.version,
      algorithmVersion: "calendar-v1",
    };
    run(
      "INSERT INTO logs VALUES(?,?,?,?,?,?,?,?)",
      result.attemptId,
      owner,
      id,
      body.mode,
      body.rating,
      day,
      JSON.stringify({
        ...body,
        hintUsed,
        errorSnapshot: reviewedEntry.errors,
        before: r,
        after,
        algorithmVersion: "calendar-v1",
      }),
      new Date().toISOString(),
    );
    run(
      "INSERT INTO idempotency VALUES(?,?,?,?,?,?)",
      owner,
      id,
      key,
      hash,
      JSON.stringify(result),
      new Date().toISOString(),
    );
    run(
      "DELETE FROM entry_hint_usage WHERE owner=? AND entry_id=? AND review_version<=?",
      owner,
      r.entry_id,
      r.version,
    );
    return result;
  });
}
