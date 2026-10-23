import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import bcrypt from "bcryptjs";
import sharp from "sharp";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-http-"));
const { run, dataDir } = await import("../src/lib/db");
const { defaults } = await import("../src/lib/model");
const password = randomBytes(18).toString("hex");
for (const username of ["alpha", "beta"])
  run(
    "INSERT INTO users VALUES(?,?,?,?)",
    randomUUID(),
    username,
    bcrypt.hashSync(password, 4),
    JSON.stringify(defaults),
  );
writeFileSync(
  path.join(dataDir, "session-secret"),
  randomBytes(48).toString("hex"),
);
const port = 3127,
  base = `http://127.0.0.1:${port}`;
test("HTTP 接口集成：鉴权、上传、并发、备份、退出", async (t) => {
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  server.stderr.on("data", (b) => (output += b));
  server.stdout.on("data", (b) => (output += b));
  t.after(() => {
    server.kill();
  });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(base + "/api/v1/settings");
      if (r.status === 401) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert(ready, output);
  let cookie = "",
    otherCookie = "",
    entryId = "",
    attachmentId = "",
    reviewId = "";
  const call = (
    p: string,
    body?: any,
    method = body ? "POST" : "GET",
    extras: Record<string, string> = {},
  ) =>
    fetch(base + "/api/v1/" + p, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "yanxiben",
        Origin: base,
        Cookie: cookie,
        ...extras,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  await t.test("未登录读取私有接口返回 401", async () =>
    assert.equal((await call("entries")).status, 401),
  );
  await t.test("同源登录成功、异源和缺少 CSRF 标识被拒绝", async () => {
    assert.equal(
      (
        await call("auth/login", { username: "alpha", password }, "POST", {
          Origin: "https://evil.test",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("auth/login", { username: "alpha", password }, "POST", {
          "X-Requested-With": "",
        })
      ).status,
      403,
    );
    const r = await call("auth/login", { username: "alpha", password });
    assert.equal(r.status, 200, await r.text());
    cookie = r.headers.get("set-cookie")!.split(";")[0];
    assert(cookie);
    const r2 = await call(
      "auth/login",
      { username: "beta", password },
      "POST",
      { Cookie: "" },
    );
    otherCookie = r2.headers.get("set-cookie")!.split(";")[0];
  });
  await t.test("AI 配置接口鉴权、CSRF与密钥不回传", async () => {
    assert.equal((await call("ai/config",undefined,"GET",{Cookie:""})).status,401);
    const profile={id:randomUUID(),name:"fixture",base:"https://example.com",model:"fixture",vision:false,key:"synthetic-secret"};
    assert.equal((await call("ai/config",{action:"save",profile},"POST",{"X-Requested-With":""})).status,403);
    const saved=await call("ai/config",{action:"save",profile});assert.equal(saved.status,200);assert(!(await saved.text()).includes(profile.key));
    const other=await call("ai/config",undefined,"GET",{Cookie:otherCookie});assert.equal((await other.json()).data.profiles.length,0);
  });
  await t.test("AI目标变更保护与关闭状态不发送外部请求", async () => {
    assert.equal((await call("ai/study",{})).status,409);
    const status=(await (await call("ai/status")).json()).data;assert.equal(status.ready,false);
    const request={action:"organize",entry:{type:"MATH",subject:"高等数学",title:"fixture",body:"x"},consent:true,target:status.target};
    assert.equal((await call("ai/study",request,"POST",{"X-AI-Target":status.target})).status,503);
  });
  await t.test("伪装图片被拒绝，真实图片可上传且需要鉴权", async () => {
    const fake = new FormData();
    fake.append(
      "file",
      new Blob(['<svg onload="alert(1)">'], { type: "image/png" }),
      "fake.png",
    );
    const upload = (f: FormData, c = cookie) =>
      fetch(base + "/api/v1/attachments", {
        method: "POST",
        headers: { "X-Requested-With": "yanxiben", Origin: base, Cookie: c },
        body: f,
      });
    assert.equal((await upload(fake)).status, 415);
    const f = new FormData();
    f.append(
      "file",
      new Blob(
        [
          new Uint8Array(
            await sharp({
              create: {
                width: 4,
                height: 4,
                channels: 3,
                background: "#ffffff",
              },
            })
              .png()
              .toBuffer(),
          ),
        ],
        { type: "image/png" },
      ),
      "test.png",
    );
    const r = await upload(f);
    assert.equal(r.status, 200);
    attachmentId = (await r.json()).data.id;
    const content = await call("attachments/" + attachmentId + "/content");
    assert.equal(content.status, 200);
    assert.equal(content.headers.get("content-type"), "image/png");
    assert.equal(content.headers.get("x-content-type-options"), "nosniff");
    assert.match(content.headers.get("content-security-policy") || "", /default-src 'none'; sandbox/);
    assert.match(content.headers.get("content-disposition") || "", /^inline;/);
    const download = await call("attachments/" + attachmentId + "/content?download=1");
    assert.match(download.headers.get("content-disposition") || "", /^attachment;/);
    run("UPDATE attachments SET mime='text/html' WHERE id=?", attachmentId);
    assert.equal((await call("attachments/" + attachmentId + "/content")).status, 415);
    run("UPDATE attachments SET mime='image/png' WHERE id=?", attachmentId);
    assert.equal(
      (
        await call(
          "attachments/" + attachmentId + "/content",
          undefined,
          "GET",
          { Cookie: otherCookie },
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await call(
          "attachments/" + attachmentId + "/content",
          undefined,
          "GET",
          { Cookie: "" },
        )
      ).status,
      401,
    );
  });
  await t.test("图片单独收集、跨账号访问拦截", async () => {
    const r = await call("entries", {
      type: "MATH",
      title: "HTTP 冒烟测试",
      subject: "高等数学",
      body: "",
      attachments: [{ id: attachmentId, role: "PROMPT" }],
    });
    assert.equal(r.status, 200);
    entryId = (await r.json()).data.id;
    assert.equal(
      (
        await call("entries/" + entryId, undefined, "GET", {
          Cookie: otherCookie,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call(
          "entries/" + entryId,
          { expectedVersion: 1, title: "非法" },
          "PATCH",
          { Cookie: otherCookie },
        )
      ).status,
      404,
    );
  });
  await t.test("两次并发修改仅一个成功，另一个返回 409", async () => {
    const responses = await Promise.all([
      call(
        "entries/" + entryId,
        { expectedVersion: 1, title: "版本 A" },
        "PATCH",
      ),
      call(
        "entries/" + entryId,
        { expectedVersion: 1, title: "版本 B" },
        "PATCH",
      ),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  });
  await t.test("复习幂等并发只写一份历史", async () => {
    const r = await call("review-items", { entryId });
    assert.equal(r.status, 200);
    reviewId = (await r.json()).data.id;
    const b = {
      expectedVersion: 1,
      mode: "SCHEDULED",
      rating: "GOOD",
      hintUsed: false,
      answerMd: "独立完成",
    };
    const responses = await Promise.all([
      call("review-items/" + reviewId + "/attempts", b, "POST", {
        "Idempotency-Key": "concurrent",
      }),
      call("review-items/" + reviewId + "/attempts", b, "POST", {
        "Idempotency-Key": "concurrent",
      }),
    ]);
    assert(responses.every((r) => r.status === 200));
    assert.deepEqual(
      (await responses[0].json()).data,
      (await responses[1].json()).data,
    );
    const h = await (await call("reviews/history")).json();
    assert.equal(h.data.length, 1);
  });
  await t.test("导出需要重新验证密码，正确密码返回 ZIP", async () => {
    assert.equal(
      (await call("exports", { type: "BACKUP", password: "incorrect" })).status,
      401,
    );
    for (const type of ["BACKUP", "MARKDOWN"]) {
      const r = await call("exports", { type, password });
      assert.equal(r.status, 200);
      const bytes = new Uint8Array(await r.arrayBuffer());
      assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
    }
  });
  await t.test("删除与恢复保持历史并暂停复习", async () => {
    assert.equal(
      (await call("entries/" + entryId, undefined, "DELETE")).status,
      200,
    );
    assert.equal((await call("entries/" + entryId)).status, 404);
    assert.equal(
      (await call("entries/" + entryId + "/restore", {})).status,
      200,
    );
    const e = (await (await call("entries/" + entryId)).json()).data;
    assert.equal(e.review.stage, "PAUSED");
    assert.equal(e.history.length, 1);
  });
  await t.test("退出撤销服务器会话，旧 Cookie 不可重放", async () => {
    assert.equal((await call("auth/logout", {})).status, 200);
    assert.equal((await call("entries")).status, 401);
  });
});
