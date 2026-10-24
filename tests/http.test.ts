import "./ai-test-key";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { request as httpRequest } from "node:http";
import { expandingPng } from "./image-fixtures";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-http-"));
const { run, one, dataDir } = await import("../src/lib/db");
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
  await t.test("资源分发统一鉴权、错误封装与方法边界", async () => {
    for (const resource of [
      "dashboard",
      "knowledge-nodes",
      "reviews/queue",
      "data/backup-status",
      "ai/budget",
      "auth/identity",
    ]) {
      assert.equal((await call(resource)).status, 200, resource);
      assert.equal(
        (await call(resource, undefined, "GET", { Cookie: "" })).status,
        401,
        resource,
      );
    }
    for (const [resource, method] of [
      ["missing-resource", "GET"],
      ["constructor", "GET"],
      ["__proto__", "GET"],
      ["review-items", "GET"],
      ["ai/config", "DELETE"],
    ]) {
      const response = await call(resource, undefined, method);
      assert.equal(response.status, 404);
      const envelope = await response.json();
      assert.equal(envelope.error.code, "RESOURCE_NOT_FOUND");
      assert.ok(envelope.meta.requestId);
    }
    assert.equal(
      (await call("knowledge-nodes", {}, "POST", { "X-Requested-With": "" }))
        .status,
      403,
    );
    assert.equal((await call("ai/study", {})).status, 409);
  });
  await t.test("AI 配置接口鉴权、CSRF与密钥不回传", async () => {
    assert.equal(
      (await call("ai/config", undefined, "GET", { Cookie: "" })).status,
      401,
    );
    const profile = {
      id: randomUUID(),
      name: "fixture",
      base: "https://example.com",
      model: "fixture",
      vision: false,
      key: "synthetic-secret",
    };
    assert.equal(
      (
        await call("ai/config", { action: "save", profile }, "POST", {
          "X-Requested-With": "",
        })
      ).status,
      403,
    );
    const saved = await call("ai/config", { action: "save", profile });
    assert.equal(saved.status, 200);
    assert(!(await saved.text()).includes(profile.key));
    const other = await call("ai/config", undefined, "GET", {
      Cookie: otherCookie,
    });
    assert.equal((await other.json()).data.profiles.length, 0);
    assert.equal(
      (await call("ai/budget", undefined, "GET", { Cookie: "" })).status,
      401,
    );
    const limits = { dailyCalls: 7, dailyCost: { amount: 1, currency: "CNY" } };
    assert.equal(
      (
        await call("ai/config", { action: "limits", limits }, "POST", {
          "X-Requested-With": "",
        })
      ).status,
      403,
    );
    assert.equal(
      (await call("ai/config", { action: "limits", limits })).status,
      200,
    );
    assert.deepEqual(
      (await (await call("ai/budget")).json()).data.limits,
      limits,
    );
    assert.equal(
      (
        await (
          await call("ai/budget", undefined, "GET", { Cookie: otherCookie })
        ).json()
      ).data.limits.dailyCalls,
      100,
    );
    assert.equal(
      (
        await call("ai/config", {
          action: "save",
          profile: { ...profile, base: "https://127.0.0.1" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("ai/config", {
          action: "save",
          profile: { ...profile, maxOutputTokens: 50000 },
        })
      ).status,
      400,
    );
  });
  await t.test(
    "无 Content-Length 的 chunked JSON 与图片超限均返回 413",
    async () => {
      const send = (p: string, size: number, contentType: string) =>
        new Promise<number>((resolve, reject) => {
          let completed = false;
          const req = httpRequest(
            base + "/api/v1/" + p,
            {
              method: "POST",
              headers: {
                "Transfer-Encoding": "chunked",
                "Content-Type": contentType,
                "X-Requested-With": "yanxiben",
                Origin: base,
                Cookie: cookie,
              },
            },
            (res) => {
              res.resume();
              res.on("end", () => {
                completed = true;
                resolve(res.statusCode!);
                req.destroy();
              });
            },
          );
          req.on("error", (error) => {
            if (!completed) reject(error);
          });
          req.write(Buffer.alloc(size, 120));
          req.end();
        });
      assert.equal(
        await send("entries", 1024 * 1024 + 1, "application/json"),
        413,
      );
      assert.equal(
        await send(
          "attachments",
          12 * 1024 * 1024 + 1,
          "multipart/form-data; boundary=test",
        ),
        413,
      );
    },
  );
  await t.test("AI目标变更保护与关闭状态不发送外部请求", async () => {
    assert.equal((await call("ai/study", {})).status, 409);
    const status = (await (await call("ai/status")).json()).data;
    assert.equal(status.ready, false);
    const request = {
      action: "organize",
      entry: { type: "MATH", subject: "高等数学", title: "fixture", body: "x" },
      consent: true,
      target: status.target,
    };
    assert.equal(
      (
        await call("ai/study", request, "POST", {
          "X-AI-Target": status.target,
        })
      ).status,
      503,
    );
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
    const expanding = await expandingPng();
    assert(expanding.length < 10 * 1024 * 1024);
    const enlarged = new FormData();
    enlarged.append(
      "file",
      new Blob([new Uint8Array(expanding)], { type: "image/png" }),
      "palette.png",
    );
    const rejected = await upload(enlarged);
    assert.equal(rejected.status, 413);
    assert.equal((await rejected.json()).error.code, "ATTACHMENT_TOO_LARGE");
    assert.equal(one("SELECT count(*) n FROM attachments")!.n, 0);
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
    const etag = content.headers.get("etag")!;
    assert.match(etag, /^"[a-f0-9]{64}"$/);
    assert.equal(content.headers.get("cache-control"), "private, no-cache");
    const unchanged = await call(
      "attachments/" + attachmentId + "/content",
      undefined,
      "GET",
      { "If-None-Match": etag },
    );
    assert.equal(unchanged.status, 304);
    assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
    const originalBytes = readFileSync(
      path.join(dataDir, "attachments", attachmentId),
    );
    writeFileSync(
      path.join(dataDir, "attachments", attachmentId),
      await sharp({
        create: { width: 2, height: 2, channels: 3, background: "red" },
      })
        .png()
        .toBuffer(),
    );
    const changed = await call(
      "attachments/" + attachmentId + "/content",
      undefined,
      "GET",
      { "If-None-Match": etag },
    );
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.get("etag"), etag);
    writeFileSync(
      path.join(dataDir, "attachments", attachmentId),
      originalBytes,
    );
    assert.equal(content.headers.get("content-type"), "image/png");
    assert.equal(content.headers.get("x-content-type-options"), "nosniff");
    assert.match(
      content.headers.get("content-security-policy") || "",
      /default-src 'none'; sandbox/,
    );
    assert.match(content.headers.get("content-disposition") || "", /^inline;/);
    const download = await call(
      "attachments/" + attachmentId + "/content?download=1",
    );
    assert.match(
      download.headers.get("content-disposition") || "",
      /^attachment;/,
    );
    run("UPDATE attachments SET mime='text/html' WHERE id=?", attachmentId);
    assert.equal(
      (
        await call(
          "attachments/" + attachmentId + "/content",
          undefined,
          "GET",
          { "If-None-Match": etag },
        )
      ).status,
      415,
    );
    run("UPDATE attachments SET mime='image/png' WHERE id=?", attachmentId);
    assert.equal(
      (
        await call(
          "attachments/" + attachmentId + "/content",
          undefined,
          "GET",
          { Cookie: otherCookie, "If-None-Match": etag },
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
          { Cookie: "", "If-None-Match": etag },
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
    const preview = await call("entries/batch-review-preview", [
      { id: entryId, version: 1 },
    ]);
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).data[0].id, entryId);
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
  await t.test("MAINTENANCE 暂停后恢复仍为长期巩固", async () => {
    run(
      "UPDATE reviews SET stage='MAINTENANCE',stage_index=3,success_streak=3,version=20 WHERE id=?",
      reviewId,
    );
    assert.equal(
      (
        await call(
          "review-items/" + reviewId,
          { expectedVersion: 20, paused: true },
          "PATCH",
        )
      ).status,
      200,
    );
    assert.equal(
      one("SELECT stage FROM reviews WHERE id=?", reviewId)!.stage,
      "PAUSED",
    );
    assert.equal(
      (
        await call(
          "review-items/" + reviewId,
          { expectedVersion: 21, paused: false },
          "PATCH",
        )
      ).status,
      200,
    );
    assert.equal(
      one("SELECT stage FROM reviews WHERE id=?", reviewId)!.stage,
      "MAINTENANCE",
    );
  });
  await t.test(
    "服务端提示状态不能通过谎报 false 绕过，跨账号提示标记拒绝",
    async () => {
      const entry = (
        await (
          await call("entries", {
            type: "MATH",
            subject: "高等数学",
            title: "提示验收",
            body: "求导",
          })
        ).json()
      ).data;
      const review = (
        await (
          await call("review-items", { entryId: entry.id, practice: true })
        ).json()
      ).data;
      assert.equal(
        (
          await call(
            `review-items/${review.id}/hint`,
            { expectedVersion: 1 },
            "POST",
            { Cookie: otherCookie },
          )
        ).status,
        404,
      );
      assert.equal(
        (await call(`review-items/${review.id}/hint`, { expectedVersion: 1 }))
          .status,
        200,
      );
      const body = {
        expectedVersion: 1,
        mode: "PRACTICE",
        rating: "EASY",
        hintUsed: false,
        answerMd: "answer",
      };
      assert.equal(
        (
          await call(`review-items/${review.id}/attempts`, body, "POST", {
            "Idempotency-Key": "hint-lying",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            `review-items/${review.id}/attempts`,
            { ...body, rating: "GOOD" },
            "POST",
            { "Idempotency-Key": "hint-good" },
          )
        ).status,
        200,
      );
      assert.equal(
        JSON.parse(
          one("SELECT payload FROM logs WHERE review_id=?", review.id)!.payload,
        ).hintUsed,
        true,
      );
    },
  );
  await t.test("导出需要重新验证密码，正确密码返回 ZIP", async () => {
    assert.equal(
      (await call("exports", { type: "BACKUP", password: "incorrect" })).status,
      401,
    );
    assert.equal(
      (await call("exports", { type: "BACKUP", password })).status,
      429,
    );
    // Advance only this synthetic fixture out of backoff; production has no reset API.
    run("DELETE FROM reauth_limits");
    for (const type of ["BACKUP", "MARKDOWN"]) {
      assert.equal((await call("exports", { type, password })).status, 400);
      const key = randomUUID();
      const r = await call("exports", { type, password }, "POST", {
        "Idempotency-Key": key,
      });
      assert.equal(r.status, 200);
      const bytes = new Uint8Array(await r.arrayBuffer());
      assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
      const retry = await call("exports", { type, password }, "POST", {
        "Idempotency-Key": key,
      });
      assert.equal(retry.status, 200);
      assert.deepEqual(new Uint8Array(await retry.arrayBuffer()), bytes);
      assert.equal(
        (
          await call("exports", { type, password: "wrong" }, "POST", {
            "Idempotency-Key": key,
          })
        ).status,
        401,
      );
      run("DELETE FROM reauth_limits");
      assert.equal(
        (
          await call(
            "exports",
            { type: type === "BACKUP" ? "MARKDOWN" : "BACKUP", password },
            "POST",
            { "Idempotency-Key": key },
          )
        ).status,
        409,
      );
    }
  });
  await t.test("恢复上传前校验一次性凭据，跨账号和重放拒绝", async () => {
    assert.equal((await call("data/restore-preview", {})).status, 403);
    assert.equal(
      (await call("auth/reauth", { password: "wrong", purpose: "RESTORE" }))
        .status,
      403,
    );
    assert.equal(
      (
        await call("auth/password", {
          current: password,
          password: "new-fixture-password",
        })
      ).status,
      429,
    );
    run("DELETE FROM reauth_limits");
    const grant = (
      await (await call("auth/reauth", { password, purpose: "RESTORE" })).json()
    ).data.token;
    assert.equal(
      (
        await call("data/restore-preview", {}, "POST", {
          Cookie: otherCookie,
          "X-Restore-Authorization": grant,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("data/restore-preview", {}, "POST", {
          "X-Restore-Authorization": grant,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("data/restore-preview", {}, "POST", {
          "X-Restore-Authorization": grant,
        })
      ).status,
      403,
    );
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
  await t.test(
    "缺失会话密钥返回初始化指令；已有账号 init 可补建且保留密码",
    async () => {
      const before = one(
        "SELECT password FROM users WHERE username='alpha'",
      )!.password;
      unlinkSync(path.join(dataDir, "session-secret"));
      const failed = await call("settings");
      assert.equal(failed.status, 503);
      const body = await failed.json();
      assert.equal(body.error.code, "NOT_INITIALIZED");
      assert.match(body.error.message, /npm run init/);
      const initialized = spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/init.ts"],
        {
          encoding: "utf8",
          env: { ...process.env, INIT_USERNAME: "alpha" },
          windowsHide: true,
        },
      );
      assert.equal(initialized.status, 0, initialized.stderr);
      assert.equal(
        one("SELECT password FROM users WHERE username='alpha'")!.password,
        before,
      );
      assert.ok(
        readFileSync(path.join(dataDir, "session-secret"), "utf8").length >= 32,
      );
      assert.equal((await call("settings")).status, 401);
      const login = await call("auth/login", { username: "alpha", password });
      assert.equal(login.status, 200);
      cookie = login.headers.get("set-cookie")!.split(";")[0];
    },
  );
  await t.test("退出撤销服务器会话，旧 Cookie 不可重放", async () => {
    assert.equal((await call("auth/logout", {})).status, 200);
    assert.equal((await call("entries")).status, 401);
  });
});
