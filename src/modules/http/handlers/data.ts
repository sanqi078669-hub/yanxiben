import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { one } from "../../../lib/db";
import { assert } from "../../entries/service";
import {
  backupStatus,
  recordBackup,
  previewRestore,
  launchRestore,
  stopRestore,
  restoreWorkspaces,
  deleteRestore,
} from "../../data-management/restore-workspace";
import { backup, markdownExport } from "../../data-management/backup";
import { readRestoreUpload } from "../body";
import type { ApiContext } from "../context";
export async function dataHandler(context: ApiContext) {
  const { req, p, method, owner, json, ok } = context;
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
    const { password, upload } = await readRestoreUpload(req);
    try {
      assert(
        await bcrypt.compare(
          password,
          one("SELECT password FROM users WHERE id=?", owner)!.password,
        ),
        403,
        "INVALID_PASSWORD",
        "密码不正确",
      );
      return ok(await previewRestore(owner, upload, { signal: req.signal }));
    } finally {
      await upload.dispose();
    }
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
    const archive = b.type === "BACKUP" ? backup(owner) : markdownExport(owner);
    if (b.type === "BACKUP") recordBackup(owner);
    return new NextResponse(Buffer.from(archive), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="yanxiben-${b.type.toLowerCase()}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  }
}
