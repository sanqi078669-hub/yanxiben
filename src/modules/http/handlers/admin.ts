import { z } from "zod";
import { one, run, transaction, db } from "../../../lib/db";
import { AppError, assert } from "../../entries/service";
import { requireAdmin } from "../../auth/admin-guard";
import type { ApiContext } from "../context";

const uuidSchema = z.string().uuid();

export async function adminHandler(context: ApiContext) {
  const { parts, method, owner, ok } = context;
  requireAdmin(owner);

  if (
    parts.length === 2 &&
    parts[0] === "admin" &&
    parts[1] === "users" &&
    method === "GET"
  ) {
    const rows = db
      .prepare(
        `
      SELECT u.id, u.username, u.role,
        COALESCE(s.disabled, 0) AS disabled,
        (SELECT COUNT(*) FROM entries WHERE owner = u.id) AS entries_count,
        (SELECT COUNT(*) FROM sessions WHERE owner = u.id) AS sessions_count
      FROM users u LEFT JOIN account_status s ON s.owner = u.id
      ORDER BY u.username COLLATE NOCASE
    `,
      )
      .all() as Array<{
      id: string;
      username: string;
      role: string;
      disabled: number;
      entries_count: number;
      sessions_count: number;
    }>;
    return ok({
      users: rows.map((row) => ({
        id: row.id,
        username: row.username,
        role: row.role,
        disabled: row.disabled === 1,
        entriesCount: row.entries_count,
        sessionsCount: row.sessions_count,
      })),
    });
  }

  if (
    parts.length === 4 &&
    parts[0] === "admin" &&
    parts[1] === "users" &&
    parts[3] === "disable" &&
    method === "POST"
  ) {
    const targetId = uuidSchema.parse(parts[2]);
    assert(targetId !== owner, 400, "CANNOT_TARGET_SELF", "不能禁用自己");
    const target = one(
      "SELECT username, role FROM users WHERE id = ?",
      targetId,
    );
    assert(target, 404, "RESOURCE_NOT_FOUND", "用户不存在");
    if (target.role === "admin") {
      const count = one(
        "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND id != ?",
        targetId,
      )!;
      assert(count.c >= 1, 400, "LAST_ADMIN", "不能禁用唯一的管理员");
    }
    transaction(() => {
      run(
        "INSERT INTO account_status VALUES(?, ?) ON CONFLICT(owner) DO UPDATE SET disabled=excluded.disabled",
        targetId,
        1,
      );
      run("DELETE FROM sessions WHERE owner = ?", targetId);
      run("DELETE FROM reauth_grants WHERE owner = ?", targetId);
    });
    return ok({ ok: true });
  }

  if (
    parts.length === 4 &&
    parts[0] === "admin" &&
    parts[1] === "users" &&
    parts[3] === "enable" &&
    method === "POST"
  ) {
    const targetId = uuidSchema.parse(parts[2]);
    assert(
      one("SELECT username FROM users WHERE id = ?", targetId),
      404,
      "RESOURCE_NOT_FOUND",
      "用户不存在",
    );
    transaction(() => {
      run(
        "INSERT INTO account_status VALUES(?, ?) ON CONFLICT(owner) DO UPDATE SET disabled=excluded.disabled",
        targetId,
        0,
      );
    });
    return ok({ ok: true });
  }

  if (
    parts.length === 3 &&
    parts[0] === "admin" &&
    parts[1] === "users" &&
    method === "DELETE"
  ) {
    const targetId = uuidSchema.parse(parts[2]);
    assert(targetId !== owner, 400, "CANNOT_TARGET_SELF", "不能删除自己");
    const target = one(
      "SELECT username, role FROM users WHERE id = ?",
      targetId,
    );
    assert(target, 404, "RESOURCE_NOT_FOUND", "用户不存在");
    if (target.role === "admin") {
      const count = one(
        "SELECT COUNT(*) AS c FROM users WHERE role = 'admin'",
      )!;
      assert(count.c > 1, 400, "LAST_ADMIN", "不能删除最后一个管理员");
    }
    transaction(() => {
      // 子表先于父表；用户级 CASCADE 表由最后的 users 删除处理。
      run("DELETE FROM logs WHERE owner = ?", targetId);
      run("DELETE FROM relations WHERE owner = ?", targetId);
      run("DELETE FROM revisions WHERE owner = ?", targetId);
      run("DELETE FROM reviews WHERE owner = ?", targetId);
      run("DELETE FROM entry_filter_values WHERE owner = ?", targetId);
      run("DELETE FROM entry_search WHERE owner = ?", targetId);
      run("DELETE FROM knowledge_aliases WHERE owner = ?", targetId);
      run("DELETE FROM knowledge_merges WHERE owner = ?", targetId);
      run("DELETE FROM knowledge WHERE owner = ?", targetId);
      run("DELETE FROM entries WHERE owner = ?", targetId);
      run("DELETE FROM attachments WHERE owner = ?", targetId);
      run("DELETE FROM idempotency WHERE owner = ?", targetId);
      run("DELETE FROM sessions WHERE owner = ?", targetId);
      run("DELETE FROM ai_audit WHERE owner = ?", targetId);
      run("DELETE FROM ai_audit_extras WHERE owner = ?", targetId);
      run("DELETE FROM batch_edits WHERE owner = ?", targetId);
      run("DELETE FROM ai_prices WHERE owner = ?", targetId);
      run("DELETE FROM restore_workspaces WHERE owner = ?", targetId);
      run("DELETE FROM backup_status WHERE owner = ?", targetId);
      run("DELETE FROM users WHERE id = ?", targetId);
    });
    return ok({ ok: true, deleted: { username: target.username } });
  }
  throw new AppError(404, "RESOURCE_NOT_FOUND", "接口不存在");
}
