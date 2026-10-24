import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { z } from "zod";
import { consumeRestoreGrant, verifyCurrentPassword } from "../../auth/reauth";
import {
  backupStatus,
  previewRestore,
  launchRestore,
  stopRestore,
  restoreWorkspaces,
  deleteRestore,
} from "../../data-management/restore-workspace";
import { prepareExport } from "../../data-management/export-worker";
import { idempotencyKey } from "../middleware";
import { readRestoreUpload } from "../body";
import type { ApiContext } from "../context";
import { assert } from "../../entries/service";
export async function dataHandler(context: ApiContext) {
  const { req, p, method, owner, json, ok } = context;
  assert(
    process.env.RESTORE_MODE !== "admin" || !p.startsWith("data/restore-"),
    403,
    "ADMIN_RESTORE_REQUIRED",
    "正式实例由管理员在隔离环境恢复，请联系维护人",
  );
  if (p === "data/backup-status" && method === "GET")
    return ok(backupStatus(owner));
  if (p === "data/restore-launch" && method === "POST")
    return ok(await launchRestore(owner, await json()));
  if (p === "data/restore-stop" && method === "POST")
    return ok(await stopRestore(owner, await json()));
  if (p === "data/restore-workspaces" && method === "GET")
    return ok(restoreWorkspaces(owner));
  if (p === "data/restore-delete" && method === "POST") {
    const b = z
      .object({ id: z.string().uuid(), confirm: z.literal(true) })
      .strict()
      .parse(await json());
    return ok(deleteRestore(owner, { id: b.id }));
  }
  if (p === "data/restore-preview" && method === "POST") {
    consumeRestoreGrant(owner, req.headers.get("x-restore-authorization"));
    const { upload } = await readRestoreUpload(req);
    try {
      return ok(await previewRestore(owner, upload, { signal: req.signal }));
    } finally {
      await upload.dispose();
    }
  }
  if (p === "exports" && method === "POST") {
    const b = z
      .object({
        type: z.enum(["BACKUP", "MARKDOWN"]),
        password: z.string(),
      })
      .strict()
      .parse(await json());
    await verifyCurrentPassword(owner, b.password, {
      sid: context.s.sid!,
      status: 401,
      code: "UNAUTHENTICATED",
      message: "请验证当前密码",
    });
    const artifact = await prepareExport(owner, b.type, idempotencyKey(req), {
      signal: req.signal,
    });
    return new NextResponse(
      Readable.toWeb(
        createReadStream(artifact.filename),
      ) as ReadableStream<Uint8Array>,
      {
        headers: {
          "Content-Type": "application/zip",
          "Content-Length": String(artifact.size),
          "Content-Disposition": `attachment; filename="yanxiben-${b.type.toLowerCase()}.zip"`,
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
