import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import busboy from "busboy";
import { dataDir } from "../../lib/db";
import { AppError, assert } from "../entries/service";
import { BACKUP_ZIP_MAX_BYTES, ATTACHMENT_MAX_BYTES } from "../../lib/capacity";

export const JSON_BODY_LIMIT = 1024 * 1024;
export const IMAGE_BODY_LIMIT = ATTACHMENT_MAX_BYTES + 2 * 1024 * 1024;
export const RESTORE_FILE_LIMIT = BACKUP_ZIP_MAX_BYTES;
export const RESTORE_BODY_LIMIT = RESTORE_FILE_LIMIT + 1024 * 1024;
const tooLarge = () =>
  new AppError(413, "FILE_TOO_LARGE", "请求内容超过允许大小");
const cancelled = () => new AppError(499, "UPLOAD_CANCELLED", "上传已取消");
export function checkBodyLength(request: Request, limit: number) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    assert(
      Number.isSafeInteger(size) && size >= 0,
      400,
      "INVALID_BODY",
      "请求长度无效",
    );
    if (size > limit) throw tooLarge();
  }
}
/** Enforce bytes while reading, including when the length header is missing or false. */
export async function* limitedBody(
  request: Request,
  limit: number,
): AsyncGenerator<Uint8Array> {
  checkBodyLength(request, limit);
  if (request.signal.aborted) throw cancelled();
  const reader = request.body?.getReader();
  if (!reader) return;
  let size = 0,
    ended = false;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const part = await reader.read();
      if (request.signal.aborted) throw cancelled();
      if (part.done) {
        ended = true;
        return;
      }
      size += part.value.byteLength;
      if (size > limit) throw tooLarge();
      yield part.value;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw request.signal.aborted
      ? cancelled()
      : new AppError(400, "INVALID_BODY", "上传请求不完整，请重试");
  } finally {
    request.signal.removeEventListener("abort", abort);
    if (!ended) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function readBody(request: Request, limit: number) {
  const chunks: Uint8Array[] = [];
  for await (const bytes of limitedBody(request, limit)) chunks.push(bytes);
  return Buffer.concat(chunks);
}
export async function readJson(request: Request) {
  const bytes = await readBody(request, JSON_BODY_LIMIT);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "无效 JSON");
  }
}
export async function readImageForm(request: Request) {
  const bytes = await readBody(request, IMAGE_BODY_LIMIT);
  try {
    return await new Response(bytes, {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "图片上传表单无效");
  }
}

export class DiskUpload {
  constructor(
    private folder: string,
    public readonly size: number,
  ) {}
  async moveTo(destination: string) {
    await rename(path.join(this.folder, "upload.zip"), destination);
  }
  async dispose() {
    const root = path.resolve(dataDir, "upload-tmp"),
      folder = path.resolve(this.folder);
    assert(
      path.dirname(folder) === root &&
        /^[a-f0-9-]{36}$/.test(path.basename(folder)),
      400,
      "INVALID_UPLOAD",
      "拒绝清理未知上传目录",
    );
    await rm(folder, { recursive: true, force: true });
  }
}
/** Busboy streams the only accepted file directly to an exclusively-created file.
 * Client filenames never become paths. Part fields are small and bounded. */
export async function readRestoreUpload(
  request: Request,
  limits: { body?: number; file?: number } = {},
) {
  const maxBody = limits.body ?? RESTORE_BODY_LIMIT,
    maxFile = limits.file ?? RESTORE_FILE_LIMIT;
  checkBodyLength(request, maxBody);
  let parser;
  try {
    parser = busboy({
      headers: Object.fromEntries(request.headers),
      limits: {
        fileSize: maxFile + 1,
        files: 1,
        fields: 1,
        parts: 3,
        fieldSize: 1024,
        fieldNameSize: 100,
        headerPairs: 100,
      },
    });
  } catch {
    throw new AppError(400, "INVALID_BACKUP", "恢复上传表单无效");
  }
  const folder = path.resolve(dataDir, "upload-tmp", randomUUID());
  await mkdir(folder, { recursive: true, mode: 0o700 });
  let fileBytes = 0,
    fileCount = 0,
    password: string | undefined,
    failure: Error | undefined;
  const writes: Promise<void>[] = [];
  const upload = new DiskUpload(folder, 0);
  parser.on("file", (name, stream) => {
    fileCount++;
    if (name !== "file") {
      failure ??= new AppError(400, "INVALID_BACKUP", "上传字段无效");
      stream.resume();
      return;
    }
    stream.on("limit", () => {
      failure ??= tooLarge();
    });
    stream.on("data", (bytes: Buffer) => {
      fileBytes += bytes.length;
      if (fileBytes > maxFile) failure ??= tooLarge();
    });
    writes.push(
      pipeline(
        stream,
        createWriteStream(path.join(folder, "upload.zip"), {
          flags: "wx",
          mode: 0o600,
        }),
      ).catch((error) => {
        failure ??= error;
      }),
    );
  });
  parser.on("field", (name, value, info) => {
    if (
      name !== "password" ||
      info.valueTruncated ||
      info.nameTruncated ||
      value.length > 200
    )
      failure ??= new AppError(400, "INVALID_BACKUP", "密码字段无效");
    else password = value;
  });
  for (const event of ["filesLimit", "fieldsLimit", "partsLimit"] as const)
    parser.on(event, () => {
      failure ??= new AppError(400, "INVALID_BACKUP", "上传字段过多");
    });
  try {
    try {
      await pipeline(Readable.from(limitedBody(request, maxBody)), parser);
    } catch (error) {
      failure ??=
        error instanceof AppError
          ? error
          : new AppError(400, "INVALID_BACKUP", "恢复上传不完整");
    }
    await Promise.all(writes);
    if (failure) throw failure;
    assert(
      fileCount === 1 && fileBytes > 0,
      400,
      "INVALID_BACKUP",
      "请选择完整备份 ZIP",
    );
    return { password, upload: new DiskUpload(folder, fileBytes) };
  } catch (error) {
    await upload.dispose();
    throw error;
  }
}
