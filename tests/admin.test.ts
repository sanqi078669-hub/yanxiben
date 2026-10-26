import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import bcrypt from "bcryptjs";

process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-admin-"));
const { db, run, one, dataDir } = await import("../src/lib/db");
const { defaults } = await import("../src/lib/model");
const { requireAdmin } = await import("../src/modules/auth/admin-guard");
const password = randomBytes(18).toString("hex");
const hash = bcrypt.hashSync(password, 4);
const base = "http://127.0.0.1:3193";

function seed(username: string, role: "admin" | "user" = "user") {
  const id = randomUUID();
  run(
    "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
    id,
    username,
    hash,
    JSON.stringify(defaults),
    role,
  );
  return id;
}

async function call(
  resource: string,
  cookie = "",
  method = "GET",
  body?: unknown,
) {
  return fetch(base + "/api/v1/" + resource, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "yanxiben",
      Origin: base,
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function login(username: string) {
  const response = await call("auth/login", "", "POST", { username, password });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";")[0];
}

function insert(table: string, row: Record<string, string | number | null>) {
  const keys = Object.keys(row);
  run(
    `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    ...Object.values(row),
  );
}

function learningData(owner: string) {
  const now = new Date().toISOString();
  const entry = randomUUID(),
    otherEntry = randomUUID(),
    review = randomUUID(),
    node = randomUUID(),
    child = randomUUID(),
    attachment = randomUUID();
  for (const id of [entry, otherEntry])
    insert("entries", {
      id,
      owner,
      type: "MATH",
      title: "测试记录",
      subject: "数学",
      status: "INBOX",
      body: "测试",
      payload: JSON.stringify({ tags: ["测试"] }),
      version: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });
  insert("knowledge", {
    id: node,
    owner,
    subject: "数学",
    parent_id: null,
    name: "父节点",
    description: "",
    archived: 0,
  });
  insert("knowledge", {
    id: child,
    owner,
    subject: "数学",
    parent_id: node,
    name: "子节点",
    description: "",
    archived: 0,
  });
  insert("reviews", {
    id: review,
    owner,
    entry_id: entry,
    stage: "ACQUIRE",
    stage_index: 0,
    success_streak: 0,
    due_on: "2026-10-26",
    version: 1,
  });
  insert("logs", {
    id: randomUUID(),
    owner,
    review_id: review,
    mode: "SCHEDULED",
    rating: "GOOD",
    local_date: "2026-10-26",
    payload: "{}",
    created_at: now,
  });
  insert("relations", {
    id: randomUUID(),
    owner,
    from_id: entry,
    to_id: otherEntry,
    type: "SIMILAR",
  });
  insert("revisions", {
    id: randomUUID(),
    owner,
    entry_id: entry,
    version: 1,
    snapshot: "{}",
    reason: "TEST",
    created_at: now,
  });
  insert("attachments", {
    id: attachment,
    owner,
    name: "test.txt",
    mime: "text/plain",
    size: 4,
    sha256: "0".repeat(64),
    created_at: now,
  });
  insert("idempotency", {
    owner,
    scope: "test",
    key: "test",
    hash: "test",
    response: "{}",
    created_at: now,
  });
  insert("knowledge_aliases", {
    id: randomUUID(),
    owner,
    node_id: child,
    name: "别名",
  });
  insert("knowledge_merges", {
    id: randomUUID(),
    owner,
    payload: "{}",
    undone: 0,
  });
  insert("ai_audit", {
    id: randomUUID(),
    owner,
    action: "TEST",
    model: "test",
    host: "test",
    created_at: now,
    duration: 0,
    status: "OK",
    tokens: 0,
    result: null,
    feedback: "",
  });
  insert("ai_audit_extras", { id: randomUUID(), owner, payload: "{}" });
  insert("batch_edits", { id: randomUUID(), owner, payload: "{}" });
  insert("ai_prices", { owner, model: "test", host: "test", payload: "{}" });
  insert("restore_workspaces", {
    id: randomUUID(),
    owner,
    folder: "test",
    counts: "{}",
    created: now,
    url: null,
    pid: null,
  });
  insert("backup_status", { owner, created: now });
  insert("entry_hint_usage", {
    owner,
    entry_id: entry,
    review_version: 1,
    used_at: now,
  });
  insert("ai_daily_budget", {
    owner,
    day: "2026-10-26",
    currency: "USD",
    calls: 1,
    spent: 0,
    unknown: 0,
  });
  insert("ai_budget_active", {
    owner,
    id: randomUUID(),
    expires: Date.now() + 60000,
  });
  const exportId = randomUUID();
  insert("export_receipts", {
    owner,
    key_hash: "test",
    type: "BACKUP",
    file_id: exportId,
    expires: Date.now() + 60000,
  });
  insert("reauth_limits", {
    owner,
    failures: 0,
    blocked_until: 0,
    lease_until: 0,
    lease_id: "",
  });
  insert("reauth_grants", {
    owner,
    key_hash: randomUUID(),
    expires: Date.now() + 60000,
  });
  insert("account_status", { owner, disabled: 0 });
  insert("sessions", { id: randomUUID(), owner, expires: Date.now() + 60000 });
  const files = [
    path.join(dataDir, "attachments", attachment),
    path.join(dataDir, "ai-private", owner + ".json"),
    path.join(dataDir, "export-cache", exportId + ".zip"),
  ];
  for (const file of files) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "test");
  }
  return files;
}

test(
  "管理员 HTTP：权限、账号状态、外键清理与真实名额限制",
  { timeout: 120000 },
  async (t) => {
    assert(path.basename(dataDir).startsWith("yanxi-admin-"));
    const admin = seed("admin-user", "admin");
    const users = Array.from({ length: 6 }, (_, index) => seed("user" + index));
    assert.ok(
      one(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name='enforce_user_capacity'",
      ),
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATA_DIR: dataDir,
      SESSION_SECRET: randomBytes(48).toString("hex"),
      SECURE_COOKIES: "0",
      PUBLIC_ORIGIN: base,
      CAPACITY_POLICY: "invited",
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
        "3193",
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
    assert(ready, "admin test server did not start");
    const adminCookie = await login("admin-user");
    const userCookie = await login("user0");

    await t.test("列表包含七个账号且不暴露密码和 settings", async () => {
      const response = await call("admin/users", adminCookie);
      assert.equal(response.status, 200);
      const list = (await response.json()).data.users;
      assert.equal(list.length, 7);
      for (const user of list) {
        assert.deepEqual(
          Object.keys(user).sort(),
          [
            "id",
            "username",
            "role",
            "disabled",
            "entriesCount",
            "sessionsCount",
          ].sort(),
        );
        assert.equal(typeof user.disabled, "boolean");
      }
    });
    await t.test("非管理员所有管理请求均返回 FORBIDDEN", async () => {
      for (const [resource, method] of [
        ["admin/users", "GET"],
        [`admin/users/${users[1]}/disable`, "POST"],
        [`admin/users/${users[1]}/enable`, "POST"],
        [`admin/users/${users[1]}`, "DELETE"],
        ["admin/unknown", "GET"],
      ]) {
        const response = await call(resource, userCookie, method);
        assert.equal(response.status, 403);
        assert.equal((await response.json()).error.code, "FORBIDDEN");
      }
    });
    await t.test("未登录返回 UNAUTHENTICATED", async () => {
      const response = await call("admin/users");
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
    });
    await t.test("requireAdmin 拒绝普通及不存在的用户", () => {
      assert.doesNotThrow(() => requireAdmin(admin));
      for (const id of [users[0], randomUUID()])
        assert.throws(
          () => requireAdmin(id),
          (e: unknown) =>
            e instanceof Error && "code" in e && e.code === "FORBIDDEN",
        );
    });
    await t.test(
      "禁用撤销会话及重新认证授权，旧会话与重新登录均失败",
      async () => {
        insert("reauth_grants", {
          key_hash: randomUUID(),
          owner: users[0],
          expires: Date.now() + 60000,
        });
        const response = await call(
          `admin/users/${users[0]}/disable`,
          adminCookie,
          "POST",
          {},
        );
        assert.equal(response.status, 200);
        assert.equal(
          one("SELECT disabled FROM account_status WHERE owner=?", users[0])!
            .disabled,
          1,
        );
        for (const table of ["sessions", "reauth_grants"])
          assert.equal(
            one(`SELECT COUNT(*) AS c FROM ${table} WHERE owner=?`, users[0])!
              .c,
            0,
          );
        assert.equal((await call("auth/identity", userCookie)).status, 401);
        assert.equal(
          (
            await call("auth/login", "", "POST", {
              username: "user0",
              password,
            })
          ).status,
          401,
        );
      },
    );
    await t.test("启用恢复登录且不撤销既有会话或授权", async () => {
      assert.equal(
        (await call(`admin/users/${users[0]}/enable`, adminCookie, "POST", {}))
          .status,
        200,
      );
      assert.equal(
        one("SELECT disabled FROM account_status WHERE owner=?", users[0])!
          .disabled,
        0,
      );
      await login("user0");
      const grant = randomUUID();
      insert("reauth_grants", {
        key_hash: grant,
        owner: users[0],
        expires: Date.now() + 60000,
      });
      const sessions = one(
        "SELECT COUNT(*) AS c FROM sessions WHERE owner=?",
        users[0],
      )!.c;
      assert.equal(
        (await call(`admin/users/${users[0]}/enable`, adminCookie, "POST", {}))
          .status,
        200,
      );
      assert.equal(
        one("SELECT COUNT(*) AS c FROM sessions WHERE owner=?", users[0])!.c,
        sessions,
      );
      assert.ok(
        one("SELECT key_hash FROM reauth_grants WHERE key_hash=?", grant),
      );
    });
    await t.test("满七人拒绝第八人，删除后新账号可插入", async () => {
      assert.throws(() => seed("eighth-blocked"), /REGISTRATION_LIMIT_REACHED/);
      assert.equal(
        (await call(`admin/users/${users[1]}`, adminCookie, "DELETE")).status,
        200,
      );
      assert.equal(one("SELECT COUNT(*) AS c FROM users")!.c, 6);
      assert.ok(seed("eighth-after-delete"));
      assert.equal(one("SELECT COUNT(*) AS c FROM users")!.c, 7);
    });
    await t.test("不能删除自己，唯一管理员保留", async () => {
      const response = await call(
        `admin/users/${admin}`,
        adminCookie,
        "DELETE",
      );
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "CANNOT_TARGET_SELF");
      assert.equal(
        one("SELECT COUNT(*) AS c FROM users WHERE role='admin'")!.c,
        1,
      );
    });
    await t.test("不能禁用自己", async () => {
      const response = await call(
        `admin/users/${admin}/disable`,
        adminCookie,
        "POST",
        {},
      );
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "CANNOT_TARGET_SELF");
    });
    await t.test(
      "删除清理全部 owner 表和级联表，保留其他用户及文件资源",
      async () => {
        const files = learningData(users[2]);
        const tables = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )
          .all()
          .map((r) => String(r.name))
          .filter((name) =>
            db
              .prepare(`PRAGMA table_info(${name})`)
              .all()
              .some((r) => r.name === "owner"),
          );
        for (const table of tables)
          assert(
            one(`SELECT COUNT(*) AS c FROM ${table} WHERE owner=?`, users[2])!
              .c > 0,
            table,
          );
        const result = await call(
          `admin/users/${users[2]}`,
          adminCookie,
          "DELETE",
        );
        assert.equal(result.status, 200, JSON.stringify(await result.json()));
        for (const table of tables)
          assert.equal(
            one(`SELECT COUNT(*) AS c FROM ${table} WHERE owner=?`, users[2])!
              .c,
            0,
            table,
          );
        assert.ok(one("SELECT id FROM users WHERE id=?", admin));
        assert.equal(one("PRAGMA foreign_keys")!.foreign_keys, 1);
        assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
        for (const file of files) assert(existsSync(file), file);
      },
    );
    await t.test("存在其他管理员时可以禁用、启用和删除管理员", async () => {
      const other = seed("second-admin", "admin");
      for (const action of ["disable", "enable"])
        assert.equal(
          (
            await call(
              `admin/users/${other}/${action}`,
              adminCookie,
              "POST",
              {},
            )
          ).status,
          200,
        );
      assert.equal(
        (await call(`admin/users/${other}`, adminCookie, "DELETE")).status,
        200,
      );
      assert.equal(
        one("SELECT COUNT(*) AS c FROM users WHERE role='admin'")!.c,
        1,
      );
    });
    await t.test("学习空间已超额仍可进行管理操作", async () => {
      insert("attachments", {
        id: randomUUID(),
        owner: admin,
        name: "quota",
        mime: "text/plain",
        size: 80 * 1024 * 1024,
        sha256: "0".repeat(64),
        created_at: new Date().toISOString(),
      });
      assert.equal(
        (await call(`admin/users/${users[0]}/enable`, adminCookie, "POST", {}))
          .status,
        200,
      );
    });
    await t.test("不存在的目标或管理路径返回 404", async () => {
      for (const resource of [
        "admin/users/00000000-0000-0000-0000-000000000000",
        `admin/users/${users[0]}/extra`,
      ]) {
        const response = await call(resource, adminCookie, "DELETE");
        assert.equal(response.status, 404);
        assert.equal((await response.json()).error.code, "RESOURCE_NOT_FOUND");
      }
    });
  },
);
