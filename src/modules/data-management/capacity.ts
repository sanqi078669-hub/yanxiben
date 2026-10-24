import { AppError } from "../entries/service";
import { unzipSync } from "fflate";
import {
  ATTACHMENT_MAX_BYTES,
  BACKUP_ZIP_MAX_BYTES,
  BACKUP_UNPACKED_MAX_BYTES,
} from "../../lib/capacity";

export function checkAttachmentCapacity(size: number) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > ATTACHMENT_MAX_BYTES)
    throw new AppError(
      413,
      "ATTACHMENT_TOO_LARGE",
      "图片重新编码后最大 10 MiB，请缩小图片后重新上传",
    );
}
export function checkBackupCapacity(unpackedBytes: number, zippedBytes = 0) {
  if (
    !Number.isSafeInteger(unpackedBytes) ||
    unpackedBytes < 0 ||
    unpackedBytes > BACKUP_UNPACKED_MAX_BYTES ||
    !Number.isSafeInteger(zippedBytes) ||
    zippedBytes < 0 ||
    zippedBytes > BACKUP_ZIP_MAX_BYTES
  )
    throw new AppError(
      413,
      "BACKUP_TOO_LARGE",
      "备份超过可恢复容量（ZIP 200 MiB / 解压 500 MiB）；请先清理不再需要的附件或使用另行验证的离线备份方案",
    );
}

/** Metadata-only check for cached ZIPs created before the capacity contract. */
export function checkCachedArchiveCapacity(bytes: Uint8Array) {
  checkBackupCapacity(0, bytes.byteLength);
  let total = 0;
  unzipSync(bytes, {
    filter(file) {
      total += file.originalSize;
      checkBackupCapacity(total, bytes.byteLength);
      if (file.name.startsWith("attachments/"))
        checkAttachmentCapacity(file.originalSize);
      return false;
    },
  });
}
