import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { authenticated } from "../auth/session";
import { AppError } from "../entries/service";
import { restoreControl } from "../data-management/restore-workspace";
import { readJson } from "./body";
import { guardRequest, jsonOk, errorResponse } from "./middleware";
import { resourceHandlers } from "./router";
import { loginHandler } from "./handlers/login";
import { registerHandler } from "./handlers/register";
import { adminHandler } from "./handlers/admin";
import { enforceQuota, accountUsage } from "../data-management/quota";
export async function handleRequest(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const requestId = randomUUID();
  try {
    const parts = (await ctx.params).path,
      p = parts.join("/"),
      method = req.method;
    guardRequest(req, p);
    if (p === "health" && method === "GET") {
      const { one } = await import("../../lib/db");
      one("SELECT 1");
      return jsonOk(requestId, { status: "ok" });
    }
    const context = {
      req,
      parts,
      p,
      method,
      json: () => readJson(req),
      ok: (data: unknown) => jsonOk(requestId, data),
    };
    if (p === "internal/restore-control")
      return context.ok(
        restoreControl(method, req.headers.get("x-restore-control")),
      );
    if (p === "auth/login" && method === "POST")
      return await loginHandler(context);
    if (p === "auth/register" && method === "POST")
      return await registerHandler(context);
    const { owner, session: s } = await authenticated();
    if (p === "data/capacity" && method === "GET")
      return context.ok({
        ...accountUsage(owner),
        restoreMode: process.env.RESTORE_MODE === "admin" ? "admin" : "local",
      });
    if (
      !["GET", "HEAD"].includes(method) &&
      !["auth", "exports", "data", "admin"].includes(parts[0])
    )
      enforceQuota(owner);
    if (parts[0] === "ai" && process.env.AI_ENABLED === "0" && method !== "GET")
      throw new AppError(403, "AI_DISABLED", "本实例尚未启用 AI，请联系维护人");
    const handlers: typeof resourceHandlers = { ...resourceHandlers, admin: adminHandler };
    const handler = Object.hasOwn(handlers, parts[0])
      ? handlers[parts[0]]
      : undefined;
    const response = handler && (await handler({ ...context, owner, s }));
    if (response) return response;
    throw new AppError(404, "RESOURCE_NOT_FOUND", "接口不存在");
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
