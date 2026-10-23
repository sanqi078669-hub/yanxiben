import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { authenticated } from "../auth/session";
import { AppError } from "../entries/service";
import { restoreControl } from "../data-management/restore-workspace";
import { readJson } from "./body";
import { guardRequest, jsonOk, errorResponse } from "./middleware";
import { resourceHandlers } from "./router";
import { loginHandler } from "./handlers/login";
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
    const { owner, session: s } = await authenticated();
    const handler = Object.hasOwn(resourceHandlers, parts[0])
      ? resourceHandlers[parts[0]]
      : undefined;
    const response = handler && (await handler({ ...context, owner, s }));
    if (response) return response;
    throw new AppError(404, "RESOURCE_NOT_FOUND", "接口不存在");
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
