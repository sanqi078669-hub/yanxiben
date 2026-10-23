import { NextRequest, NextResponse } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { z, ZodError } from "zod";
import { all, one, run, transaction, dataDir } from "../../../../lib/db";
import { authenticated, session } from "../../../../modules/auth/session";
import {
  AppError,
  assert,
  settings,
  entries,
  getEntry,
  createEntry,
  updateEntry,
  trashEntry,
  addReview,
  reviewQueue,
  attempt,
  recordEntryHint,
} from "../../../../modules/entries/service";
import { activeStage } from "../../../../modules/review/schedule";
import { settingsSchema, subjects } from "../../../../lib/model";
import { publicConfig, saveConfig } from "../../../../modules/ai/config";
import { aiStatus, complete } from "../../../../modules/ai/provider";
import { extract, limited, study } from "../../../../modules/ai/service";
import { related, relatedPreview } from "../../../../modules/ai/related";
import { diagnose, diagnosisPreview } from "../../../../modules/ai/diagnosis";
import { learningStatistics } from "../../../../modules/review/statistics";
import {
  batchTags,
  batchPause,
  batchReviewPreview,
  undoBatch,
} from "../../../../modules/entries/batch";
import {
  backupStatus,
  recordBackup,
  previewRestore,
  launchRestore,
  stopRestore,
  restoreWorkspaces,
  deleteRestore,
  restoreControl,
} from "../../../../modules/data-management/restore-workspace";
import {
  audited,
  auditList,
  auditFeedback,
} from "../../../../modules/ai/audit";
import { priceList, savePrice } from "../../../../modules/ai/pricing";
import {
  knowledgeAliases,
  knowledgeMerges,
  addAlias,
  mergePreview,
  mergeKnowledge,
  undoKnowledgeMerge,
} from "../../../../modules/entries/knowledge";
import {
  backup,
  markdownExport,
} from "../../../../modules/data-management/backup";
export const runtime = "nodejs";
import { checkBodyLength, readJson, readImageForm, readRestoreUpload, JSON_BODY_LIMIT, IMAGE_BODY_LIMIT, RESTORE_BODY_LIMIT } from "../../../../modules/http/body";
export const dynamic = "force-dynamic";
async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const requestId = randomUUID();
  try {
    const parts = (await ctx.params).path,
      p = parts.join("/"),
      method = req.method;
    if (method !== "GET") {
      const origin = req.headers.get("origin");
      assert(
        !origin ||
          origin ===
            new URL(req.nextUrl.protocol + "//" + req.headers.get("host"))
              .origin,
        403,
        "INVALID_ORIGIN",
        "请求来源不匹配",
      );
      assert(
        req.headers.get("x-requested-with") === "yanxiben",
        403,
        "CSRF",
        "缺少同源请求校验",
      );
      checkBodyLength(req, p === "data/restore-preview" ? RESTORE_BODY_LIMIT : p === "attachments" ? IMAGE_BODY_LIMIT : JSON_BODY_LIMIT);
    }
    const json = () => readJson(req);
    const ok = (data: unknown) =>
      NextResponse.json(
        { data, meta: { requestId } },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (p === "internal/restore-control") return ok(restoreControl(method, req.headers.get("x-restore-control")));
    if (p === "auth/login" && method === "POST") {
      const b = z
        .object({
          username: z.string().min(1).max(100),
          password: z.string().max(200),
        })
        .strict()
        .parse(await json());
      const key = b.username.toLowerCase();
      const limit = one("SELECT * FROM login_limits WHERE key=?", key);
      assert(
        !limit || limit.reset_at < Date.now() || limit.count < 10,
        429,
        "RATE_LIMITED",
        "尝试次数过多，请 15 分钟后再试",
      );
      run(
        "INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END",
        key,
        Date.now() + 900000,
        Date.now(),
        Date.now(),
      );
      const user = one("SELECT * FROM users WHERE username=?", b.username);
      const valid = await bcrypt.compare(
        b.password,
        user?.password ||
          "$2b$12$xg19SQp9u2/2XLu7HSS.Bu6wXGZ0BPFj3P8kHpoU5vTQyHEQhBvgy",
      );
      assert(user && valid, 401, "UNAUTHENTICATED", "账号或密码错误");
      const s = await session();
      if (s.sid) run("DELETE FROM sessions WHERE id=?", s.sid);
      s.sid = randomUUID();
      run(
        "INSERT INTO sessions VALUES(?,?,?)",
        s.sid,
        user.id,
        Date.now() + 604800000,
      );
      await s.save();
      run("DELETE FROM login_limits WHERE key=?", key);
      return ok({ settings: JSON.parse(user.settings) });
    }
    const { owner, session: s } = await authenticated();
    if (p === "auth/identity" && method === "GET") return ok({ owner });
    if (p === "knowledge-tools/aliases" && method === "GET")
      return ok(knowledgeAliases(owner));
    if (p === "knowledge-tools/merges" && method === "GET")
      return ok(knowledgeMerges(owner));
    if (p === "knowledge-tools/aliases" && method === "POST")
      return ok(addAlias(owner, await json()));
    if (p === "knowledge-tools/preview" && method === "GET") {
      const { state, ...preview } = mergePreview(
        owner,
        req.nextUrl.searchParams.get("source") || "",
        req.nextUrl.searchParams.get("target") || "",
      );
      return ok(preview);
    }
    if (p === "knowledge-tools/merge" && method === "POST")
      return ok(mergeKnowledge(owner, await json()));
    if (p === "knowledge-tools/undo" && method === "POST")
      return ok(
        undoKnowledgeMerge(
          owner,
          z
            .object({ id: z.string().uuid() })
            .strict()
            .parse(await json()).id,
        ),
      );
    if (p === "ai/history" && method === "GET") return ok(auditList(owner));
    if (p === "data/backup-status" && method === "GET")
      return ok(backupStatus(owner));
    if (p === "data/restore-launch" && method === "POST")
      return ok(await launchRestore(owner, await json()));
    if (p === "data/restore-stop" && method === "POST")
      return ok(await stopRestore(owner, await json()));
    if (p === "data/restore-workspaces" && method === "GET") return ok(restoreWorkspaces(owner));
    if (p === "data/restore-delete" && method === "POST") {
      const b = z.object({ id: z.string().uuid(), confirm: z.literal(true) }).strict().parse(await json());
      return ok(deleteRestore(owner, { id: b.id }));
    }
    if (p === "data/restore-preview" && method === "POST") {
      const { password, upload } = await readRestoreUpload(req);
      try {
        assert(await bcrypt.compare(password, one("SELECT password FROM users WHERE id=?", owner)!.password), 403, "INVALID_PASSWORD", "密码不正确");
        return ok(await previewRestore(owner, upload, { signal: req.signal }));
      } finally { await upload.dispose(); }
    }
    if (p === "ai/prices" && method === "GET") return ok(priceList(owner));
    if (p === "ai/prices" && method === "POST")
      return ok(savePrice(owner, await json()));
    if (p === "ai/feedback" && method === "POST")
      return ok(auditFeedback(owner, await json()));
    if (p === "reviews/statistics" && method === "GET")
      return ok(
        learningStatistics(owner, Object.fromEntries(req.nextUrl.searchParams)),
      );
    if (
      method === "POST" &&
      ["ai/extract", "ai/study", "ai/related", "ai/diagnosis"].includes(p)
    ) {
      const target = req.headers.get("x-ai-target");
      assert(
        target === aiStatus(owner).target,
        409,
        "AI_TARGET_CHANGED",
        "模型配置已改变，请刷新页面并重新确认发送目标",
      );
    }
    if (p === "ai/config") {
      if (method === "GET") return ok(publicConfig(owner));
      if (method === "POST") return ok(saveConfig(owner, await json()));
    }
    if (p === "ai/status" && method === "GET") return ok(aiStatus(owner));
    if (p === "ai/test" && method === "POST") {
      const body = z
        .object({ vision: z.boolean().optional() })
        .strict()
        .parse(await json());
      if (body.vision) {
        const png = await sharp({
          create: {
            width: 48,
            height: 48,
            channels: 3,
            background: { r: 0, g: 0, b: 255 },
          },
        })
          .png()
          .toBuffer();
        return ok(
          await audited(owner, "图片能力测试", () =>
            limited(owner, () =>
              complete(
                '判断图片主色，只返回 {"color":"蓝色"}，若不是蓝色请返回实际颜色。',
                "固定测试色块，不含个人材料",
                z.object({ color: z.literal("蓝色") }),
                ["data:image/png;base64," + png.toString("base64")],
                fetch,
                owner,
              ),
            ),
          ),
        );
      }
      return ok(
        await audited(owner, "连接测试", () =>
          limited(owner, () =>
            complete(
              '返回 {"ok":true}。',
              "连接测试，不含学习资料",
              z.object({ ok: z.literal(true) }),
              [],
              fetch,
              owner,
            ),
          ),
        ),
      );
    }
    if (p === "ai/extract" && method === "POST") {
      const body = await json();
      return ok(await audited(owner, "图片识别", () => extract(owner, body)));
    }
    if (p === "ai/study" && method === "POST") {
      const body = await json();
      return ok(
        await audited(
          owner,
          "study:" +
            (typeof body.action === "string"
              ? body.action.slice(0, 40)
              : "unknown"),
          () => study(owner, body),
        ),
      );
    }
    if (p === "ai/related" && method === "GET")
      return ok(
        relatedPreview(
          owner,
          req.nextUrl.searchParams.get("entryId") || "",
          z
            .enum(["basic", "semantic"])
            .parse(req.nextUrl.searchParams.get("mode") || "basic"),
        ),
      );
    if (p === "ai/related" && method === "POST") {
      const body = await json();
      return ok(await audited(owner, "相似题比较", () => related(owner, body)));
    }
    if (p === "ai/diagnosis" && method === "GET")
      return ok(diagnosisPreview(owner));
    if (p === "ai/diagnosis" && method === "POST") {
      const body = await json();
      return ok(await audited(owner, "学习诊断", () => diagnose(owner, body)));
    }
    if (p === "auth/logout" && method === "POST") {
      run("DELETE FROM sessions WHERE id=?", s.sid!);
      s.destroy();
      return ok(true);
    }
    if (p === "auth/password" && method === "POST") {
      const b = z
        .object({ current: z.string(), password: z.string().min(12).max(200) })
        .strict()
        .parse(await json());
      assert(
        await bcrypt.compare(
          b.current,
          one("SELECT password FROM users WHERE id=?", owner)!.password,
        ),
        400,
        "INVALID_PASSWORD",
        "当前密码不正确",
      );
      run(
        "UPDATE users SET password=? WHERE id=?",
        await bcrypt.hash(b.password, 12),
        owner,
      );
      run("DELETE FROM sessions WHERE owner=? AND id<>?", owner, s.sid!);
      return ok(true);
    }
    if (p === "settings") {
      if (method === "GET") return ok(settings(owner));
      if (method === "PATCH") {
        const v = settingsSchema.parse(await json());
        run("UPDATE users SET settings=? WHERE id=?", JSON.stringify(v), owner);
        return ok(v);
      }
    }
    if (p === "dashboard" && method === "GET") {
      const active = entries(owner, new URLSearchParams("limit=100"));
      return ok({
        total: active.total,
        inbox: entries(owner, new URLSearchParams("status=INBOX")).total,
        queue: reviewQueue(owner),
        recent: active.items.slice(0, 5),
        studied: one(
          "SELECT count(*) n FROM logs WHERE owner=? AND local_date=?",
          owner,
          reviewQueue(owner).date,
        )!.n,
        byType: all(
          "SELECT type,count(*) n FROM entries WHERE owner=? AND deleted_at IS NULL GROUP BY type",
          owner,
        ),
      });
    }
    if (p === "entries/batch-tags" && method === "POST")
      return ok(batchTags(owner, await json()));
    if (p === "entries/batch-review-preview" && method === "POST")
      return ok(batchReviewPreview(owner, await json()));
    if (p === "entries/batch-pause" && method === "POST")
      return ok(batchPause(owner, await json()));
    if (p === "entries/batch-undo" && method === "POST")
      return ok(undoBatch(owner, await json()));
    if (p === "entries") {
      if (method === "GET") return ok(entries(owner, req.nextUrl.searchParams));
      if (method === "POST") return ok(createEntry(owner, await json()));
    }
    if (parts[0] === "entries" && parts[1]) {
      const id = z.string().uuid().parse(parts[1]);
      if (parts.length === 2) {
        if (method === "GET") {
          const e = getEntry(owner, id);
          return ok({
            ...e,
            review: one(
              "SELECT * FROM reviews WHERE entry_id=? AND owner=?",
              id,
              owner,
            ),
            relations: all(
              "SELECT r.*, e.title, e.type entry_type FROM relations r JOIN entries e ON e.id=CASE WHEN r.from_id=? THEN r.to_id ELSE r.from_id END WHERE r.owner=? AND (r.from_id=? OR r.to_id=?) AND e.deleted_at IS NULL",
              id,
              owner,
              id,
              id,
            ),
            history: all(
              "SELECT l.* FROM logs l JOIN reviews r ON r.id=l.review_id WHERE r.entry_id=? AND l.owner=? ORDER BY l.created_at DESC",
              id,
              owner,
            ),
          });
        }
        if (method === "PATCH") return ok(updateEntry(owner, id, await json()));
        if (method === "DELETE") return ok(trashEntry(owner, id));
      }
      if (parts[2] === "restore" && method === "POST")
        return ok(trashEntry(owner, id, true));
      if (parts[2] === "revisions" && method === "GET") {
        getEntry(owner, id);
        return ok(
          all(
            "SELECT * FROM revisions WHERE entry_id=? AND owner=? ORDER BY created_at DESC LIMIT 50",
            id,
            owner,
          ),
        );
      }
      if (parts[2] === "relations") {
        getEntry(owner, id);
        if (method === "POST") {
          const b = z
            .object({
              targetId: z.string().uuid(),
              type: z.enum([
                "SIMILAR",
                "SUPPORTS",
                "CONTRASTS",
                "CONTAINS_VOCABULARY",
              ]),
            })
            .strict()
            .parse(await json());
          getEntry(owner, b.targetId);
          assert(id !== b.targetId);
          run(
            "INSERT OR IGNORE INTO relations VALUES(?,?,?,?,?)",
            randomUUID(),
            owner,
            id,
            b.targetId,
            b.type,
          );
          return ok(true);
        }
        if (method === "DELETE") {
          const b = z
            .object({ id: z.string().uuid() })
            .strict()
            .parse(await json());
          run(
            "DELETE FROM relations WHERE id=? AND owner=? AND (from_id=? OR to_id=?)",
            b.id,
            owner,
            id,
            id,
          );
          return ok(true);
        }
      }
    }
    if (p === "knowledge-nodes") {
      if (method === "GET")
        return ok(
          all(
            "SELECT * FROM knowledge WHERE owner=? ORDER BY subject,name",
            owner,
          ),
        );
      if (method === "POST") {
        const b = z
          .object({
            name: z.string().trim().min(1).max(100),
            subject: z.enum(subjects as [string, ...string[]]),
            parentId: z.string().uuid().nullable(),
            description: z.string().max(10000),
          })
          .strict()
          .parse(await json());
        if (b.parentId)
          assert(
            one(
              "SELECT id FROM knowledge WHERE id=? AND owner=? AND subject=? AND archived=0",
              b.parentId,
              owner,
              b.subject,
            ),
          );
        const id = randomUUID();
        run(
          "INSERT INTO knowledge VALUES(?,?,?,?,?,?,0)",
          id,
          owner,
          b.subject,
          b.parentId,
          b.name,
          b.description,
        );
        return ok(one("SELECT * FROM knowledge WHERE id=?", id));
      }
    }
    if (parts[0] === "knowledge-nodes" && parts[1] && method === "PATCH") {
      const b = z
        .object({ archived: z.boolean() })
        .strict()
        .parse(await json());
      assert(
        one("SELECT id FROM knowledge WHERE id=? AND owner=?", parts[1], owner),
        404,
        "RESOURCE_NOT_FOUND",
        "知识点不存在",
      );
      run(
        "UPDATE knowledge SET archived=? WHERE id=? AND owner=?",
        b.archived ? 1 : 0,
        parts[1],
        owner,
      );
      return ok(true);
    }
    if (p === "reviews/queue" && method === "GET")
      return ok(reviewQueue(owner));
    if (p === "reviews/history" && method === "GET")
      return ok(
        all(
          "SELECT l.*,e.title FROM logs l JOIN reviews r ON r.id=l.review_id JOIN entries e ON e.id=r.entry_id WHERE l.owner=? AND e.deleted_at IS NULL ORDER BY l.created_at DESC LIMIT 200",
          owner,
        ),
      );
    if (p === "review-items" && method === "POST") {
      const b = z
        .object({
          entryId: z.string().uuid(),
          practice: z.boolean().optional(),
        })
        .strict()
        .parse(await json());
      return ok(addReview(owner, b.entryId, b.practice));
    }
    if (parts[0] === "review-items" && parts[1]) {
      if (parts[2] === "hint" && method === "POST") {
        const b = z.object({ expectedVersion: z.number().int() }).strict().parse(await json());
        const r = one("SELECT * FROM reviews WHERE owner=? AND id=?", owner, parts[1]);
        assert(r, 404, "RESOURCE_NOT_FOUND", "复习项不存在");
        return ok(recordEntryHint(owner, r.entry_id, b.expectedVersion));
      }
      if (parts[2] === "attempts" && method === "POST")
        return ok(
          attempt(
            owner,
            parts[1],
            await json(),
            req.headers.get("idempotency-key") || "",
          ),
        );
      if (method === "PATCH") {
        const b = z
          .object({ expectedVersion: z.number().int(), paused: z.boolean() })
          .strict()
          .parse(await json());
        return ok(
          transaction(() => {
            const r = one(
              "SELECT * FROM reviews WHERE id=? AND owner=?",
              parts[1],
              owner,
            );
            assert(r, 404, "RESOURCE_NOT_FOUND", "计划不存在");
            getEntry(owner, r.entry_id);
            assert(
              r.version === b.expectedVersion,
              409,
              "VERSION_CONFLICT",
              "计划已更新",
            );
            run(
              "UPDATE reviews SET stage=?,version=version+1 WHERE id=?",
              b.paused ? "PAUSED" : activeStage(r as { stage_index: number; success_streak: number }),
              r.id,
            );
            return true;
          }),
        );
      }
    }
    if (p === "attachments" && method === "POST") {
      const form = await readImageForm(req);
      const f = form.get("file");
      assert(f instanceof File, 400, "VALIDATION_ERROR", "请选择图片");
      assert(
        f.size > 0 && f.size <= 10 * 1024 * 1024,
        413,
        "FILE_TOO_LARGE",
        "图片最大 10 MB",
      );
      const bytes = Buffer.from(await f.arrayBuffer());
      let meta;
      try {
        meta = await sharp(bytes, { limitInputPixels: 40000000 }).metadata();
      } catch {
        throw new AppError(
          415,
          "UNSUPPORTED_MEDIA",
          "无法读取图片，仅支持 PNG、JPEG、WebP",
        );
      }
      assert(
        ["jpeg", "png", "webp"].includes(meta.format || ""),
        415,
        "UNSUPPORTED_MEDIA",
        "仅支持 PNG、JPEG、WebP",
      );
      const cleaned = await sharp(bytes, { limitInputPixels: 40000000 })
        .rotate()
        .toBuffer();
      const id = randomUUID(),
        mime = "image/" + (meta.format === "jpeg" ? "jpeg" : meta.format);
      writeFileSync(path.join(dataDir, "attachments", id), cleaned, {
        flag: "wx",
      });
      run(
        "INSERT INTO attachments VALUES(?,?,?,?,?,?,?)",
        id,
        owner,
        f.name.slice(0, 200),
        mime,
        cleaned.length,
        createHash("sha256").update(cleaned).digest("hex"),
        new Date().toISOString(),
      );
      return ok({ id, name: f.name, mime, status: "READY" });
    }
    if (
      parts[0] === "attachments" &&
      parts[2] === "content" &&
      method === "GET"
    ) {
      const id = z.string().uuid().parse(parts[1]);
      const a = one(
        "SELECT * FROM attachments WHERE id=? AND owner=?",
        id,
        owner,
      );
      assert(a, 404, "RESOURCE_NOT_FOUND", "附件不存在");
      assert(
        ["image/jpeg", "image/png", "image/webp"].includes(a.mime),
        415,
        "UNSUPPORTED_ATTACHMENT",
        "附件格式不受支持",
      );
      return new NextResponse(
        readFileSync(path.join(dataDir, "attachments", id)),
        {
          headers: {
            "Content-Type": a.mime,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Content-Disposition": req.nextUrl.searchParams.get("download") === "1"
              ? `attachment; filename="${id}"`
              : `inline; filename="${id}"`,
          },
        },
      );
    }
    if (p === "exports" && method === "POST") {
      const b = z
        .object({
          type: z.enum(["BACKUP", "MARKDOWN"]),
          password: z.string().max(200),
        })
        .strict()
        .parse(await json());
      assert(
        await bcrypt.compare(
          b.password,
          one("SELECT password FROM users WHERE id=?", owner)!.password,
        ),
        401,
        "UNAUTHENTICATED",
        "请验证当前密码",
      );
      const archive =
        b.type === "BACKUP" ? backup(owner) : markdownExport(owner);
      if (b.type === "BACKUP") recordBackup(owner);
      return new NextResponse(Buffer.from(archive), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="yanxiben-${b.type.toLowerCase()}.zip"`,
          "Cache-Control": "no-store",
        },
      });
    }
    throw new AppError(404, "RESOURCE_NOT_FOUND", "接口不存在");
  } catch (e) {
    if (e instanceof ZodError)
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: e.issues
              .map((x) => x.path.join(".") + ": " + x.message)
              .join("；"),
          },
          meta: { requestId },
        },
        { status: 400 },
      );
    if (e instanceof AppError)
      return NextResponse.json(
        { error: { code: e.code, message: e.message }, meta: { requestId } },
        { status: e.status },
      );
    console.error(
      "Request failed",
      requestId,
      e instanceof Error ? e.message : "unknown",
    );
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "操作失败，请重试。请求编号：" + requestId,
        },
        meta: { requestId },
      },
      { status: 500 },
    );
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
