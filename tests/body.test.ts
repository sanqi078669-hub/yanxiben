import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-body-limit-"));
const { dataDir } = await import("../src/lib/db");
const { readBody, readJson, readRestoreUpload } =
  await import("../src/modules/http/body");
const encode = (s: string) => new TextEncoder().encode(s);
function streamRequest(
  parts: Uint8Array[],
  headers: Record<string, string> = {},
  signal?: AbortSignal,
  beforeRead?: (index: number) => void,
) {
  let index = 0,
    cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      beforeRead?.(index);
      if (index < parts.length) controller.enqueue(parts[index++]);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://local.test/upload", {
    method: "POST",
    body,
    headers,
    signal,
    duplex: "half",
  } as RequestInit & { duplex: string });
  return { request, wasCancelled: () => cancelled };
}
test("读取按实际字节累计；缺失和伪造小 Content-Length 均不能绕过", async () => {
  for (const headers of [{}, { "Content-Length": "1" }] as Record<
    string,
    string
  >[]) {
    const source = streamRequest(
      [encode("12"), encode("34"), encode("56")],
      headers,
    );
    await assert.rejects(() => readBody(source.request, 3), { status: 413 });
    assert.ok(source.wasCancelled());
  }
  assert.equal(
    (
      await readBody(streamRequest([encode("12"), encode("3")]).request, 3)
    ).toString(),
    "123",
  );
  await assert.rejects(
    () => readBody(streamRequest([encode("汉")]).request, 2),
    { status: 413 },
  );
  await assert.rejects(
    () => readBody(streamRequest([], { "Content-Length": "999" }).request, 3),
    { status: 413 },
  );
});

test("JSON 非法编码、损坏内容及中断均返回明确错误", async () => {
  await assert.rejects(
    () => readJson(streamRequest([new Uint8Array([255])]).request),
    { status: 400 },
  );
  await assert.rejects(() => readJson(streamRequest([encode("{")]).request), {
    status: 400,
  });
  assert.deepEqual(
    await readJson(streamRequest([encode('{"ok":true}')]).request),
    { ok: true },
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => readBody(streamRequest([], {}, controller.signal).request, 10),
    { status: 499 },
  );
});
function form(file: string, extra = false) {
  const data = new FormData();
  data.set("password", "synthetic-password");
  data.set(
    "file",
    new Blob([file], { type: "application/zip" }),
    "../../ignored-path.zip",
  );
  if (extra) data.set("unexpected", "value");
  return new Request("http://local.test/restore", {
    method: "POST",
    body: data,
  });
}
const emptyTemp = () =>
  assert.deepEqual(readdirSync(path.join(dataDir, "upload-tmp")), []);
test("恢复上传流式落盘，边界值成功且用户文件名不成为路径", async () => {
  const { password, upload } = await readRestoreUpload(form("123456"), {
    body: 2000,
    file: 6,
  });
  assert.equal(password, "synthetic-password");
  assert.equal(upload.size, 6);
  const destination = path.join(dataDir, "moved.zip");
  try {
    await upload.moveTo(destination);
    assert.equal(readFileSync(destination, "utf8"), "123456");
  } finally {
    await upload.dispose();
    unlinkSync(destination);
  }
  emptyTemp();
});
test("恢复文件超限、实际请求超限、多余字段及截断表单均清理临时文件", async () => {
  await assert.rejects(
    () => readRestoreUpload(form("1234567"), { body: 2000, file: 6 }),
    { status: 413 },
  );
  emptyTemp();
  await assert.rejects(
    () => readRestoreUpload(form("123"), { body: 10, file: 6 }),
    { status: 413 },
  );
  emptyTemp();
  await assert.rejects(
    () => readRestoreUpload(form("123", true), { body: 2000, file: 6 }),
    { status: 400 },
  );
  emptyTemp();
  const source = form("123"),
    bytes = new Uint8Array(await source.arrayBuffer());
  const broken = streamRequest([bytes.slice(0, -12)], {
    "Content-Type": source.headers.get("content-type")!,
  }).request;
  await assert.rejects(
    () => readRestoreUpload(broken, { body: 2000, file: 1000 }),
    { status: 400 },
  );
  emptyTemp();
});
test("上传中途取消时关闭写入并删除临时目录", async () => {
  const original = form("123456"),
    bytes = new Uint8Array(await original.arrayBuffer());
  const controller = new AbortController();
  const input = streamRequest(
    [bytes.slice(0, -40), bytes.slice(-40, -10), bytes.slice(-10)],
    { "Content-Type": original.headers.get("content-type")! },
    controller.signal,
    (index) => {
      if (index === 2) controller.abort();
    },
  );
  await assert.rejects(
    () => readRestoreUpload(input.request, { body: 2000, file: 10 }),
    { status: 499 },
  );
  emptyTemp();
});
