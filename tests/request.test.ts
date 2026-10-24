import { test } from "node:test";
import assert from "node:assert/strict";
import { api, request, readEnvelope, RequestError } from "../src/lib/request";

test("共享请求保留 HTTP 状态、业务错误码与 requestId", async () => {
  await assert.rejects(
    () =>
      readEnvelope(
        Response.json(
          {
            error: { code: "NOT_INITIALIZED", message: "请先初始化" },
            meta: { requestId: "request-123" },
          },
          { status: 503 },
        ),
      ),
    (error: unknown) =>
      error instanceof RequestError &&
      error.status === 503 &&
      error.code === "NOT_INITIALIZED" &&
      error.requestId === "request-123" &&
      error.message.includes("请先初始化"),
  );
  await assert.rejects(
    () =>
      readEnvelope(
        new Response("<html>private-upstream-detail</html>", {
          status: 413,
          headers: {
            "content-type": "text/html",
            "x-request-id": "body-limit",
          },
        }),
      ),
    (error: unknown) =>
      error instanceof RequestError &&
      error.status === 413 &&
      error.requestId === "body-limit" &&
      !error.message.includes("private-upstream-detail"),
  );
  await assert.rejects(
    () =>
      readEnvelope(
        new Response("{", { headers: { "content-type": "application/json" } }),
      ),
    { code: "INVALID_RESPONSE" },
  );
  await assert.rejects(
    () => readEnvelope(Response.json({ unexpected: true })),
    { code: "INVALID_RESPONSE" },
  );
  assert.deepEqual(await readEnvelope(Response.json({ data: { value: 1 } })), {
    value: 1,
  });
});

test("请求共享 JSON/FormData/目标头，网络错误可辨识", async (t) => {
  let captured: RequestInit | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      captured = init;
      return Response.json({ data: "ok" });
    },
  );
  assert.equal(
    await api("ai/study", { target: "fingerprint" }, undefined, {
      "X-AI-Target": "fingerprint",
    }),
    "ok",
  );
  assert.equal(
    new Headers(captured!.headers).get("X-AI-Target"),
    "fingerprint",
  );
  assert.equal(
    new Headers(captured!.headers).get("X-Requested-With"),
    "yanxiben",
  );
  assert.equal(
    new Headers(captured!.headers).get("Content-Type"),
    "application/json",
  );
  const form = new FormData();
  form.set("password", "synthetic");
  await request("restore", { method: "POST", body: form });
  assert.equal(captured!.body, form);
  assert.equal(new Headers(captured!.headers).has("Content-Type"), false);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("internal network message");
  });
  await assert.rejects(
    () => api("settings"),
    (error: unknown) =>
      error instanceof RequestError &&
      error.status === 0 &&
      error.code === "NETWORK_ERROR" &&
      !error.message.includes("internal network message"),
  );
});

test("共享请求覆盖等待响应与读取正文的超时，并保留主动取消", async (t) => {
  // AbortSignal.timeout timers do not themselves keep Node's test process alive.
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener(
          "abort",
          () => reject(init.signal!.reason),
          { once: true },
        );
      }),
  );
  await assert.rejects(() => request("settings", { timeoutMs: 5 }), {
    code: "REQUEST_TIMEOUT",
  });
  const caller = new AbortController();
  const cancelled = request("settings", {
    signal: caller.signal,
    timeoutMs: 1000,
  });
  caller.abort(new DOMException("Cancelled by test", "AbortError"));
  await assert.rejects(() => cancelled, { name: "AbortError" });
  t.mock.restoreAll();
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init.signal!.addEventListener(
              "abort",
              () => controller.error(init.signal!.reason),
              { once: true },
            );
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  await assert.rejects(() => request("settings", { timeoutMs: 5 }), {
    code: "REQUEST_TIMEOUT",
  });
});
