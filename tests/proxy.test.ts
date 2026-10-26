import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest, NextResponse } from "next/server";
import { config as proxyConfig, proxy } from "../src/proxy";

function request(pathname: string) {
  return new NextRequest(`http://localhost${pathname}`);
}

test("Proxy 安全头与路径放行", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Proxy 不应发起网络请求");
  });
  t.after(() => assert.equal(fetchMock.mock.callCount(), 0));

  await t.test("直接访问 /register 放行", async () => {
    const response = await proxy(request("/register"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.ok(response.headers.get("content-security-policy"));
  });

  await t.test("直接访问 /login 放行", async () => {
    const response = await proxy(request("/login"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.ok(response.headers.get("content-security-policy"));
  });

  await t.test("首页放行", async () => {
    assert.equal((await proxy(request("/"))).status, 200);
  });

  await t.test("CSP 保留全部 directive 和开发环境规则", async () => {
    const response = await proxy(request("/"));
    const csp = response.headers.get("content-security-policy");
    assert.ok(csp);
    for (const directive of [
      "default-src 'self'",
      "script-src 'self' 'nonce-",
      "'strict-dynamic'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]) {
      assert.ok(csp.includes(directive), `缺少 CSP 规则：${directive}`);
    }
    assert.ok(!csp.includes("supabase"));
    const connect = csp
      .split(";")
      .find((part) => part.trim().startsWith("connect-src"));
    assert.ok(connect);
    const dev = process.env.NODE_ENV === "development";
    assert.equal(csp.includes("'unsafe-eval'"), dev);
    assert.equal(connect.includes("ws:"), dev);
    assert.equal(connect.includes("wss:"), dev);
  });

  await t.test("Cache-Control 精确为 private, no-store", async () => {
    const response = await proxy(request("/register"));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  await t.test("下游 x-nonce 与请求及响应 CSP 一致", async (t) => {
    const originalNext = NextResponse.next;
    let capturedHeaders: Headers | undefined;
    t.mock.method(
      NextResponse,
      "next",
      (init?: Parameters<typeof NextResponse.next>[0]) => {
        capturedHeaders = init?.request?.headers;
        return originalNext(init);
      },
    );
    const response = await proxy(request("/register"));
    const csp = response.headers.get("content-security-policy");
    assert.ok(csp);
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    assert.ok(nonce, "CSP 应包含 nonce");
    assert.ok(capturedHeaders, "NextResponse.next 应收到请求头");
    assert.equal(capturedHeaders.get("x-nonce"), nonce);
    assert.equal(capturedHeaders.get("content-security-policy"), csp);
  });

  await t.test("matcher 排除 API 和静态资源并匹配登录页", () => {
    const matcher = new RegExp("^" + proxyConfig.matcher[0] + "$");
    for (const pathname of [
      "/api/v1/auth/identity",
      "/api",
      "/_next/static/chunk.js",
      "/_next/image",
      "/favicon.ico",
    ]) {
      assert.equal(matcher.test(pathname), false, pathname);
    }
    assert.equal(matcher.test("/login"), true);
  });
});
