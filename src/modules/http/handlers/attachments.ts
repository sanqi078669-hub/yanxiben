import { NextResponse } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { one, run, dataDir } from "../../../lib/db";
import { AppError, assert } from "../../entries/service";
import { readImageForm } from "../body";
import type { ApiContext } from "../context";
import { ATTACHMENT_MAX_BYTES } from "../../../lib/capacity";
import { checkAttachmentCapacity } from "../../data-management/capacity";
export async function attachmentsHandler(context: ApiContext) {
  const { req, p, parts, method, owner, ok } = context;
  if (p === "attachments" && method === "POST") {
    const form = await readImageForm(req);
    const f = form.get("file");
    assert(f instanceof File, 400, "VALIDATION_ERROR", "请选择图片");
    assert(
      f.size > 0 && f.size <= ATTACHMENT_MAX_BYTES,
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
    checkAttachmentCapacity(cleaned.length);
    const id = randomUUID(),
      mime = "image/" + (meta.format === "jpeg" ? "jpeg" : meta.format);
    writeFileSync(path.join(dataDir, "attachments", id), cleaned, {
      flag: "wx",
      mode: 0o600,
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
    const bytes = readFileSync(path.join(dataDir, "attachments", id));
    const etag = '"' + createHash("sha256").update(bytes).digest("hex") + '"';
    const headers = {
      "Content-Type": a.mime,
      "Cache-Control": "private, no-cache",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition":
        req.nextUrl.searchParams.get("download") === "1"
          ? `attachment; filename="${id}"`
          : `inline; filename="${id}"`,
    };
    const matches = req.headers
      .get("if-none-match")
      ?.split(",")
      .some((value) => {
        const candidate = value.trim().replace(/^W\//, "");
        return candidate === etag || candidate === "*";
      });
    return new NextResponse(matches ? null : bytes, {
      status: matches ? 304 : 200,
      headers,
    });
  }
}
