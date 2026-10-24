import { assert } from "../entries/service";

let processing = 0;
const uploading = new Set<string>();
const recent = new Map<string, number[]>();
/** Fail fast instead of retaining an unbounded queue of decoded image buffers. */
export async function withImageProcessing<T>(work: () => Promise<T>) {
  assert(processing < 2, 429, "IMAGE_BUSY", "图片处理繁忙，请稍后重试");
  processing++;
  try {
    return await work();
  } finally {
    processing--;
  }
}
export async function withUpload<T>(
  owner: string,
  work: () => Promise<T>,
  now = Date.now(),
) {
  assert(
    !uploading.has(owner),
    429,
    "UPLOAD_BUSY",
    "当前账号已有图片上传，请等待完成",
  );
  for (const [key, times] of recent)
    if (!times.some((time) => now - time < 60000)) recent.delete(key);
  const times = (recent.get(owner) || []).filter((time) => now - time < 60000);
  assert(
    times.length < 30,
    429,
    "UPLOAD_RATE_LIMITED",
    "图片上传每分钟最多 30 次，请稍后重试",
  );
  recent.set(owner, [...times, now]);
  uploading.add(owner);
  try {
    return await work();
  } finally {
    uploading.delete(owner);
  }
}
