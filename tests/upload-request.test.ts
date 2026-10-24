import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { uploadAttachment, requestTimeoutMs } from "../src/lib/request";

class UploadXHR {
  static last: UploadXHR;
  timeout = 0;
  status = 200;
  responseText = JSON.stringify({ data: { id: "synthetic-attachment" } });
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = 0;
  sent = 0;
  headers = new Headers();
  constructor() {
    UploadXHR.last = this;
  }
  open(method: string, url: string) {
    assert.equal(method, "POST");
    assert.equal(url, "/api/v1/attachments");
  }
  setRequestHeader(key: string, value: string) {
    this.headers.set(key, value);
  }
  getResponseHeader(key: string) {
    return key === "Content-Type" ? "application/json" : "synthetic-request";
  }
  send(form: FormData) {
    assert(form.get("file") instanceof File);
    this.sent++;
  }
  abort() {
    this.aborted++;
    this.onabort?.();
  }
}
const file = () => new File(["synthetic"], "image.png", { type: "image/png" });
function install(t: TestContext) {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "XMLHttpRequest",
  );
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    value: UploadXHR,
    configurable: true,
  });
  t.after(() => {
    if (descriptor)
      Object.defineProperty(globalThis, "XMLHttpRequest", descriptor);
    else delete (globalThis as any).XMLHttpRequest;
  });
}
test("上传复用共享附件 180 秒总时长和响应契约，成功后清理回调", async (t) => {
  install(t);
  const progress: number[] = [];
  const pending = uploadAttachment(file(), {
    onProgress: (value) => progress.push(value),
  });
  const xhr = UploadXHR.last;
  assert.equal(xhr.timeout, requestTimeoutMs("attachments"));
  assert.equal(xhr.timeout, 180000);
  assert.equal(requestTimeoutMs("settings"), 30000);
  assert.equal(xhr.headers.get("X-Requested-With"), "yanxiben");
  xhr.upload.onprogress!({
    lengthComputable: true,
    loaded: 1,
    total: 2,
  } as ProgressEvent);
  assert.deepEqual(progress, [50]);
  xhr.onload!();
  assert.deepEqual(await pending, { id: "synthetic-attachment" });
  assert.equal(xhr.onload, null);
  assert.equal(xhr.upload.onprogress, null);
});
test("上传超时、中断、原生取消均拒绝并只结算一次，迟到 load/progress 无效", async (t) => {
  install(t);
  for (const [event, code] of [
    ["ontimeout", "REQUEST_TIMEOUT"],
    ["onerror", "NETWORK_ERROR"],
    ["onabort", "AbortError"],
  ] as const) {
    let outcomes = 0,
      progress = 0;
    const pending = uploadAttachment(file(), { onProgress: () => progress++ });
    const observed = pending.then(
      () => outcomes++,
      () => outcomes++,
    );
    const xhr = UploadXHR.last,
      lateLoad = xhr.onload!,
      lateProgress = xhr.upload.onprogress!;
    const rejected = assert.rejects(
      pending,
      (error: any) => error.code === code || error.name === code,
    );
    xhr[event]!();
    lateLoad();
    lateProgress({ lengthComputable: false } as ProgressEvent);
    await rejected;
    await observed;
    assert.equal(outcomes, 1);
    assert.equal(progress, 0);
    assert.equal(xhr.ontimeout, null);
  }
});
test("主动取消和卸载信号在 load/解析竞态中优先取消，只 abort 一次", async (t) => {
  install(t);
  const controller = new AbortController();
  const pending = uploadAttachment(file(), { signal: controller.signal });
  const xhr = UploadXHR.last;
  const rejected = assert.rejects(pending, { name: "AbortError" });
  xhr.onload!();
  controller.abort();
  controller.abort();
  await rejected;
  assert.equal(xhr.aborted, 1);
  const preAborted = uploadAttachment(file(), { signal: controller.signal });
  await assert.rejects(preAborted, { name: "AbortError" });
  assert.equal(UploadXHR.last.sent, 0);
});
