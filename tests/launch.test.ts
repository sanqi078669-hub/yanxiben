import "./ai-test-key";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { unzipSync, strFromU8 } from "fflate";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-launch-"));
const { one, run, db, dataDir } = await import("../src/lib/db");
db.exec("DROP TRIGGER IF EXISTS enforce_user_capacity");
const { maintainAccount } = await import("../src/modules/auth/admin");
const { clientIp, limitLogin, acquireLoginSlot, loginFailureKey } =
  await import("../src/modules/auth/login-boundary");
const password = randomBytes(18).toString("hex");

test("账号凭据独占保存、重置/停用/启用均撤销会话", () => {
  const first = maintainAccount("create", "operator", password, "user");
  const second = maintainAccount("create", "second", password, "user");
  assert.notEqual(first.credential, second.credential);
  const bytes = readFileSync(first.credential!);
  assert(!existsSync(path.join(dataDir, "local-login.txt")));
  const owner = one("SELECT id FROM users WHERE username='operator'")!.id;
  for (const command of ["reset", "disable", "enable", "revoke"]) {
    run(
      "INSERT INTO sessions VALUES(?,?,?)",
      randomUUID(),
      owner,
      Date.now() + 100000,
    );
    maintainAccount(command, "operator", password);
    assert.equal(
      one("SELECT count(*) n FROM sessions WHERE owner=?", owner)!.n,
      0,
    );
  }
  assert.deepEqual(readFileSync(first.credential!), bytes);
});
test("可信代理秘密、IP 与登录并发边界；伪造 XFF 无效", () => {
  process.env.PROXY_SECRET = randomBytes(32).toString("hex");
  assert.throws(() => clientIp(new Headers({ "x-forwarded-for": "1.2.3.4" })));
  const h = new Headers({
    "x-yanxi-proxy": process.env.PROXY_SECRET,
    "x-yanxi-client-ip": "192.0.2.1",
  });
  assert.equal(clientIp(h), "192.0.2.1");
  const originalPair = loginFailureKey(h, "student");
  for (let i = 0; i < 30; i++) limitLogin(h);
  h.set("x-forwarded-for", "192.0.2.99");
  assert.throws(() => limitLogin(h), /登录尝试/);
  for (let i = 2; i <= 4; i++) {
    h.set("x-yanxi-client-ip", `192.0.2.${i}`);
    for (let j = 0; j < 30; j++) limitLogin(h);
  }
  h.set("x-yanxi-client-ip", "192.0.2.5");
  assert.notEqual(loginFailureKey(h, "student"), originalPair);
  assert.equal(loginFailureKey(h, "student"), loginFailureKey(h, "STUDENT"));
  limitLogin(h);
  const releases = Array.from({ length: 8 }, () => acquireLoginSlot());
  assert.throws(() => acquireLoginSlot(), /登录繁忙/);
  releases.forEach((release) => release());
  acquireLoginSlot()();
  delete process.env.PROXY_SECRET;
  run("DELETE FROM login_limits");
});

test("7 账号 HTTP 核心操作、重启持久化及完整实例快照恢复", async (t) => {
  const port = 3137,
    base = `http://127.0.0.1:${port}`;
  writeFileSync(
    path.join(dataDir, "session-secret"),
    randomBytes(48).toString("hex"),
  );
  for (let i = 0; i < 7; i++) maintainAccount("create", `user${i}`, password, "user");
  const secret = randomBytes(32).toString("hex");
  let server: ReturnType<typeof spawn>;
  const start = async () => {
    server = spawn(
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
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          PROXY_SECRET: secret,
          PUBLIC_ORIGIN: base,
          RESTORE_MODE: "admin",
          AI_ENABLED: "0",
          CAPACITY_POLICY: "invited",
        },
      },
    );
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/api/v1/health")).ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("服务未启动");
  };
  const stop = async () => {
    const exited = new Promise<void>((r) => server.once("exit", () => r()));
    server.kill();
    await exited;
  };
  t.after(() => server?.kill());
  await start();
  const timings: number[] = [];
  async function call(
    i: number,
    resource: string,
    body?: unknown,
    cookie = "",
    method = body ? "POST" : "GET",
  ) {
    const started = Date.now();
    const response = await fetch(base + "/api/v1/" + resource, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "yanxiben",
        Origin: base,
        Cookie: cookie,
        "x-yanxi-proxy": secret,
        "x-yanxi-client-ip": `192.0.2.${i + 1}`,
        "Idempotency-Key": randomUUID(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    timings.push(Date.now() - started);
    return response;
  }
  const png = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const accounts = await Promise.all(
    Array.from({ length: 7 }, async (_, i) => {
      const login = await call(i, "auth/login", {
        username: `user${i}`,
        password,
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      const created = await call(
        i,
        "entries",
        {
          type: "MATH",
          title: `Synthetic ${i}`,
          body: "$x^2$",
          subject: "高等数学",
          details: {},
        },
        cookie,
      );
      assert.equal(created.status, 200);
      const entry = (await created.json()).data;
      const form = new FormData();
      form.set("file", new File([png], "synthetic.png", { type: "image/png" }));
      // Respect explicit two-slot image backpressure: concurrent callers retry 429.
      let uploaded: Response | undefined;
      for (let attempt = 0; attempt < 10; attempt++) {
        uploaded = await fetch(base + "/api/v1/attachments", {
          method: "POST",
          headers: {
            Cookie: cookie,
            "X-Requested-With": "yanxiben",
            Origin: base,
          },
          body: form,
        });
        if (uploaded.status !== 429) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(uploaded!.status, 200);
      const attachment = (await uploaded!.json()).data;
      assert.equal(
        (
          await call(
            i,
            `entries/${entry.id}`,
            {
              expectedVersion: 1,
              manual: true,
              body: "$x^2+1$",
              attachments: [{ id: attachment.id, role: "PROMPT" }],
            },
            cookie,
            "PATCH",
          )
        ).status,
        200,
      );
      const review = await call(
        i,
        "review-items",
        { entryId: entry.id },
        cookie,
      );
      assert.equal(review.status, 200, await review.clone().text());
      const plan = (await review.json()).data;
      assert.equal(
        (
          await call(
            i,
            `review-items/${plan.id}/attempts`,
            {
              expectedVersion: plan.version,
              mode: "SCHEDULED",
              rating: "GOOD",
              hintUsed: false,
              answerMd: "synthetic",
            },
            cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await call(
            i,
            "reviews/statistics?from=2026-01-01&to=2027-12-31",
            undefined,
            cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (await call(i, "data/restore-launch", {}, cookie)).status,
        403,
      );
      assert.equal((await call(i, "ai/study", {}, cookie)).status, 403);
      return { cookie, entry, attachment };
    }),
  );
  const { saveConfig, activeConfig } = await import("../src/modules/ai/config");
  const quotaOwner = one("SELECT id FROM users WHERE username='user0'")!.id;
  const quotaId = randomUUID();
  // Simulate accumulated legacy data using metadata, without allocating 79 MiB.
  run(
    "INSERT INTO attachments VALUES(?,?,?,?,?,?,?)",
    quotaId,
    quotaOwner,
    "capacity-fixture",
    "image/png",
    79 * 1048576,
    "synthetic",
    new Date().toISOString(),
  );
  assert.equal(
    (
      await call(
        0,
        "entries",
        {
          type: "MATH",
          title: "Must reject",
          body: "x",
          subject: "高等数学",
          details: {},
        },
        accounts[0].cookie,
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await call(
        0,
        `entries/${accounts[0].entry.id}`,
        undefined,
        accounts[0].cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await (
        await call(0, "data/capacity", undefined, accounts[0].cookie)
      ).json()
    ).data.warning,
    true,
  );
  run("DELETE FROM attachments WHERE id=?", quotaId);
  const aiOwner = one("SELECT id FROM users WHERE username='user1'")!.id;
  const profileId = randomUUID();
  saveConfig(aiOwner, {
    action: "save",
    profile: {
      id: profileId,
      name: "synthetic",
      base: "https://example.com",
      model: "synthetic",
      vision: false,
      key: "synthetic-not-a-provider-key",
    },
  });
  saveConfig(aiOwner, { action: "activate", id: profileId });
  assert.equal(activeConfig(aiOwner)!.key, "synthetic-not-a-provider-key");
  const extra = (
    await (
      await call(
        1,
        "entries",
        {
          type: "MATH",
          title: "Synthetic relation",
          body: "x",
          subject: "高等数学",
          details: {},
        },
        accounts[1].cookie,
      )
    ).json()
  ).data;
  assert.equal(
    (
      await call(
        1,
        `entries/${accounts[1].entry.id}/relations`,
        { targetId: extra.id, type: "SIMILAR" },
        accounts[1].cookie,
      )
    ).status,
    200,
  );
  for (let i = 0; i < 7; i++) {
    const a = accounts[i],
      b = accounts[(i + 1) % 7];
    assert.equal(
      (await call(i, `entries/${b.entry.id}`, undefined, a.cookie)).status,
      404,
    );
    assert.equal(
      (
        await call(
          i,
          `entries/${b.entry.id}`,
          { expectedVersion: 1, title: "Forbidden" },
          a.cookie,
          "PATCH",
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await call(
          i,
          `attachments/${b.attachment.id}/content`,
          undefined,
          a.cookie,
        )
      ).status,
      404,
    );
  }
  const exported = await call(
    1,
    "exports",
    { type: "BACKUP", password },
    accounts[1].cookie,
  );
  assert.equal(exported.status, 200);
  const learning = JSON.parse(
    strFromU8(
      unzipSync(new Uint8Array(await exported.arrayBuffer()))["data.json"],
    ),
  );
  assert.equal(learning.entries.length, 2);
  assert(
    learning.entries.every(
      (entry: { owner: string }) => entry.owner === aiOwner,
    ),
  );
  const html = await fetch(base),
    html2 = await fetch(base);
  const policy = html.headers.get("content-security-policy")!;
  const nonce = /'nonce-([^']+)'/.exec(policy)![1];
  assert.notEqual(policy, html2.headers.get("content-security-policy"));
  assert((await html.text()).includes(`nonce="${nonce}"`));
  for (const pathname of ["/apix", "/apiary", "/_next/staticx"]) {
    const page = await fetch(base + pathname);
    assert(page.headers.get("content-security-policy"), pathname);
  }
  maintainAccount("disable", "user0");
  assert.equal(
    (await call(0, "settings", undefined, accounts[0].cookie)).status,
    401,
  );
  assert.equal(
    (await call(0, "auth/login", { username: "user0", password })).status,
    401,
  );
  maintainAccount("enable", "user0");
  const resetPassword = randomBytes(18).toString("hex");
  maintainAccount("reset", "user6", resetPassword);
  assert.equal(
    (await call(6, "settings", undefined, accounts[6].cookie)).status,
    401,
  );
  assert.equal(
    (await call(6, "auth/login", { username: "user6", password })).status,
    401,
  );
  assert.equal(
    (
      await call(6, "auth/login", {
        username: "user6",
        password: resetPassword,
      })
    ).status,
    200,
  );
  await stop();
  const snapshot = path.join(path.dirname(dataDir), "snapshot-" + randomUUID());
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/instance.ts",
      "snapshot",
      snapshot,
      "--offline",
    ],
    { env: process.env, encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const restored = new DatabaseSync(path.join(snapshot, "yanxiben.sqlite"));
  assert.equal(restored.prepare("SELECT count(*) n FROM users").get()!.n, 9);
  assert.equal(restored.prepare("SELECT count(*) n FROM entries").get()!.n, 8);
  assert.equal(
    restored.prepare("SELECT count(*) n FROM attachments").get()!.n,
    7,
  );
  restored.close();
  for (const name of ["ai-private/" + aiOwner + ".json", "session-secret"])
    assert.deepEqual(
      readFileSync(path.join(snapshot, name)),
      readFileSync(path.join(dataDir, name)),
    );
  const old = process.env.DATA_DIR;
  process.env.DATA_DIR = snapshot;
  await start();
  assert.equal(
    (await call(1, "settings", undefined, accounts[1].cookie)).status,
    200,
  );
  assert.equal(
    (
      await call(
        1,
        `attachments/${accounts[1].attachment.id}/content`,
        undefined,
        accounts[1].cookie,
      )
    ).status,
    200,
  );
  const restoredEntry = (
    await (
      await call(
        1,
        `entries/${accounts[1].entry.id}`,
        undefined,
        accounts[1].cookie,
      )
    ).json()
  ).data;
  assert.equal(restoredEntry.history.length, 1);
  assert.equal(restoredEntry.relations.length, 1);
  assert.equal(restoredEntry.attachments.length, 1);
  assert.equal(
    (await (await call(1, "ai/config", undefined, accounts[1].cookie)).json())
      .data.profiles.length,
    1,
  );
  await stop();
  process.env.DATA_DIR = old;
  console.log(
    JSON.stringify({
      syntheticHttpAccounts: 7,
      requests: timings.length,
      maxMs: Math.max(...timings),
      medianMs: timings.sort((a, b) => a - b)[Math.floor(timings.length / 2)],
      snapshot: JSON.parse(result.stdout),
    }),
  );
  assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 11);
});
