import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AppError, assert } from "../entries/service";
import {
  checkBodyLength,
  RESTORE_BODY_LIMIT,
  IMAGE_BODY_LIMIT,
  JSON_BODY_LIMIT,
} from "./body";

export function guardRequest(req: NextRequest, resource: string) {
  if (req.method === "GET") return;
  const origin = req.headers.get("origin");
  assert(
    !origin ||
      origin ===
        (process.env.PUBLIC_ORIGIN ||
          new URL(req.nextUrl.protocol + "//" + req.headers.get("host"))
            .origin),
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
  checkBodyLength(
    req,
    resource === "data/restore-preview"
      ? RESTORE_BODY_LIMIT
      : resource === "attachments"
        ? IMAGE_BODY_LIMIT
        : JSON_BODY_LIMIT,
  );
}
export function jsonOk(requestId: string, data: unknown) {
  return NextResponse.json(
    { data, meta: { requestId } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export function errorResponse(error: unknown, requestId: string) {
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: error.issues
            .map((issue) => issue.path.join(".") + ": " + issue.message)
            .join("；"),
        },
        meta: { requestId },
      },
      { status: 400 },
    );
  if (error instanceof AppError)
    return NextResponse.json(
      {
        error: { code: error.code, message: error.message },
        meta: { requestId },
      },
      { status: error.status },
    );
  console.error(
    "Request failed",
    requestId,
    error instanceof Error ? error.message : "unknown",
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
export function idempotencyKey(req: NextRequest) {
  return req.headers.get("idempotency-key") || "";
}
