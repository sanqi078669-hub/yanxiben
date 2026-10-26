import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import bcrypt from "bcryptjs";

process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-register-"));
const { db, run, one, all, transaction, dataDir } =
  await import("../src/lib/db");
const { defaults } = await import("../src/lib/model");
const password = "123456789012";
const base = "http://127.0.0.1:3189";

function reset() {
  assert(path.basename(dataDir).startsWith("yanxi-register-"));
  transaction(() => {
    run("DELETE FROM sessions");
    run("DELETE FROM users");
    run("DELETE FROM login_limits");
  });
}

function seed(username: string) {
  const id = randomUUID();
  run(
    "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
    id,
    username,
    bcrypt.hashSync(password, 4),
    JSON.stringify(defaults),
    "user",
  );
  return id;
}

async function call(resource: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Requested-With": "yanxiben",
    Origin: base,
  };
  if (cookie) headers.Cookie = cookie;
  return fetch(base + "/api/v1/" + resource, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test(
  "注册 HTTP：校验、数据库限额、事务与自动登录",
  { timeout: 120000 },
  async (t) => {
  const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATA_DIR: dataDir,
      PUBLIC_ORIGIN: base,
      SESSION_SECRET: randomBytes(48).toString("hex"),
      SECURE_COOKIES: "0",
    };
    delete env.PROXY_SECRET;
    const server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3189",
      ],
      { env, windowsHide: true, stdio: "ignore" },
    );
    t.after(async () => {
      if (server.exitCode === null) {
        const closed = new Promise((resolve) => server.once("close", resolve));
        server.kill();
        await closed;
      }
      db.close();
    });
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        if ((await call("health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, "registration test server did not start");
    assert.ok(
      one(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name='enforce_user_capacity'",
      ),
    );

    await t.test("正常注册创建普通用户与七天会话", async () => {
      reset();
      const response = await call("auth/register", {
        username: "test1",
        password,
      });
      assert.equal(response.status, 200);
      assert.ok((await response.json()).data.settings);
      const user = one(
        "SELECT id, role, password FROM users WHERE username=?",
        "test1",
      )!;
      assert.equal(user.role, "user");
      assert.ok(bcrypt.compareSync(password, user.password));
      assert.equal(one("SELECT COUNT(*) AS n FROM users")!.n, 1);
      assert.equal(
        one("SELECT COUNT(*) AS n FROM sessions WHERE owner=?", user.id)!.n,
        1,
      );
      const session = one(
        "SELECT expires FROM sessions WHERE owner=?",
        user.id,
      )!;
      assert(session.expires > Date.now() + 6 * 86400000);
      assert(session.expires <= Date.now() + 7 * 86400000);
    });

    await t.test("用户名重复返回 400，事务回滚保留已有会话", async () => {
      reset();
      const owner = seed("taken");
      const login = await call("auth/login", { username: "taken", password });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      const response = await call(
        "auth/register",
        { username: "taken", password },
        cookie,
      );
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "USERNAME_TAKEN");
      assert.equal(one("SELECT COUNT(*) AS n FROM users")!.n, 1);
      assert.equal(
        one("SELECT COUNT(*) AS n FROM sessions WHERE owner=?", owner)!.n,
        1,
      );
      const identity = await call("auth/identity", undefined, cookie);
      assert.equal(identity.status, 200);
      assert.equal((await identity.json()).data.owner, owner);
    });

    await t.test("短密码返回校验错误且不创建账号或会话", async () => {
      reset();
      const response = await call("auth/register", {
        username: "short-password",
        password: "short",
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
      assert.equal(one("SELECT COUNT(*) AS n FROM users")!.n, 0);
      assert.equal(one("SELECT COUNT(*) AS n FROM sessions")!.n, 0);
    });

    await t.test("含空格的用户名返回校验错误", async () => {
      reset();
      const response = await call("auth/register", {
        username: "a b",
        password,
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
      assert.equal(one("SELECT COUNT(*) AS n FROM users")!.n, 0);
    });

    await t.test("七人已满时触发器拒绝注册，返回明确的 409", async () => {
      reset();
      for (let index = 0; index < 7; index++) seed("seed" + index);
      const response = await call("auth/register", {
        username: "eighth",
        password,
      });
      assert.equal(response.status, 409);
      const body = await response.json();
      assert.equal(body.error.code, "REGISTRATION_LIMIT_REACHED");
      assert.equal(body.error.message, "注册名额已满（上限 7 人）");
      assert.equal(one("SELECT COUNT(*) AS n FROM users")!.n, 7);
      assert.equal(one("SELECT COUNT(*) AS n FROM sessions")!.n, 0);
    });

    await t.test("注册响应 Cookie 可直接读取本人 identity", async () => {
      reset();
      const response = await call("auth/register", {
        username: "automatic-login",
        password,
      });
      assert.equal(response.status, 200);
      const setCookie = response.headers.get("set-cookie");
      assert.ok(setCookie);
      const identity = await call(
        "auth/identity",
        undefined,
        setCookie.split(";")[0],
      );
      assert.equal(identity.status, 200);
      const user = one(
        "SELECT id FROM users WHERE username=?",
        "automatic-login",
      )!;
      assert.equal((await identity.json()).data.owner, user.id);
    });

    await t.test("最后一个名额的并发注册仅一个成功", async () => {
      reset();
      for (let index = 0; index < 6; index++) seed("existing" + index);
      const responses = await Promise.all([
        call("auth/register", { username: "last-a", password }),
        call("auth/register", { username: "last-b", password }),
      ]);
      assert.deepEqual(
        responses.map((response) => response.status).sort(),
        [200, 409],
      );
      assert.equal(one("SELECT COUNT(*) AS n FROM users")!.n, 7);
      assert.equal(one("SELECT COUNT(*) AS n FROM sessions")!.n, 1);
    });

    await t.test("注册十次限流独立于登录 IP 计数", async () => {
      reset();
      seed("rate-login");
      for (let index = 0; index < 10; index++) {
        const response = await call("auth/register", {
          username: "rate" + index,
          password: "short",
        });
        assert.equal(response.status, 400);
      }
      const limited = await call("auth/register", {
        username: "rate-blocked",
        password,
      });
      assert.equal(limited.status, 429);
      assert.equal((await limited.json()).error.code, "RATE_LIMITED");
      const login = await call("auth/login", {
        username: "rate-login",
        password,
      });
      assert.equal(login.status, 200);
      const limits = all("SELECT key, count FROM login_limits");
      assert.equal(
        limits.find((row) => row.key.startsWith("@register-ip:"))?.count,
        10,
      );
      assert.equal(limits.find((row) => row.key.startsWith("@ip:"))?.count, 1);
    });

    await t.test("注册用户名保持大小写区分", async () => {
      reset();
      for (const username of ["CaseUser", "caseuser"]) {
        assert.equal(
          (await call("auth/register", { username, password })).status,
          200,
        );
      }
      assert.equal(one("SELECT COUNT(*) AS n FROM users")!.n, 2);
    });

    await t.test("客户端不能通过注册请求指定管理员角色", async () => {
      reset();
      const response = await call("auth/register", {
        username: "role-injection",
        password,
        role: "admin",
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
      assert.equal(one("SELECT COUNT(*) AS n FROM users")!.n, 0);
    });
  },
);
