import { randomUUID, createHash } from "node:crypto";
import { all, one, run, transaction } from "../../lib/db";
import {
  entrySchema,
  fields,
  defaults,
  errors,
  type Entry,
  type Review,
} from "../../lib/model";
import { localDate, schedule } from "../review/schedule";
import { z } from "zod";
import { reviewAttemptSchema } from "../../lib/review-contract";
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: unknown = null,
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
  return { ...rest, ...JSON.parse(payload) } as Entry;
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
export function entries(owner: string, q: URLSearchParams) {
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
  let rows = all(
    "SELECT * FROM entries WHERE owner=? AND deleted_at IS " +
      (q.get("trash") === "1" ? "NOT NULL" : "NULL") +
      " ORDER BY updated_at DESC,id",
    owner,
  ).map(unpack);
  for (const key of ["type", "subject", "status"] as const) {
    if (q.get(key)) rows = rows.filter((e) => e[key] === q.get(key));
  }
  if (q.get("q")) {
    const query = q.get("q")!.toLowerCase();
    rows = rows.filter((e) =>
      [
        e.title,
        e.body,
        e.summary,
        e.source,
        JSON.stringify(e.details),
        JSON.stringify(e.contexts),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }
  if (q.get("knowledge"))
    rows = rows.filter((e) => e.knowledgeIds.includes(q.get("knowledge")!));
  if (q.get("error"))
    rows = rows.filter((e) => e.errors.includes(q.get("error")!));
  if (q.get("tag"))
    rows = rows.filter((e) =>
      e.tags.includes(q.get("tag")!.trim().toLowerCase()),
    );
  return {
    items: rows.slice((page - 1) * limit, page * limit),
    total: rows.length,
    page,
    limit,
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
  assert(
    e.type === "MATH"
      ? e.subject === "高等数学"
      : e.type === "CS"
        ? ["数据结构", "计算机组成原理", "操作系统", "计算机网络"].includes(
            e.subject,
          )
        : e.subject === "英语",
  );
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
  const e = validate(owner, input);
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
}
export function updateEntry(owner: string, id: string, input: unknown) {
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
      version,
      created_at,
      updated_at,
      deleted_at,
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
    return getEntry(owner, id);
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
  const s = settings(owner);
  const rows = all(
    "SELECT r.* FROM reviews r JOIN entries e ON e.id=r.entry_id WHERE r.owner=? AND e.deleted_at IS NULL AND r.stage<>'PAUSED' AND r.due_on<=? ORDER BY r.due_on,CASE WHEN (SELECT l.rating FROM logs l WHERE l.review_id=r.id ORDER BY l.created_at DESC LIMIT 1) IN ('AGAIN','HARD') THEN 0 ELSE 1 END,r.id",
    owner,
    localDate(s.timezone),
  );
  return {
    items: rows
      .slice(0, s.dailyLimit)
      .map((r) => ({ ...r, entry: getEntry(owner, r.entry_id) })),
    total: rows.length,
    date: localDate(s.timezone),
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
