import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-reauth-"));
const { run, one, db } = await import("../src/lib/db");
db.exec("DROP TRIGGER IF EXISTS enforce_user_capacity");
const { defaults } = await import("../src/lib/model");
const {
  verifyCurrentPassword,
  restoreGrant,
  consumeRestoreGrant,
  changePassword,
} = await import("../src/modules/auth/reauth");
function account() {
  const owner = randomUUID();
  run(
    "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
    owner,
    owner,
    bcrypt.hashSync("synthetic-password", 4),
    JSON.stringify(defaults),
    "user",
  );
  return owner;
}
function login(owner: string) {
  const sid = randomUUID();
  run("INSERT INTO sessions VALUES(?,?,?)", sid, owner, Date.now() + 60000);
  return sid;
}
test("改密在比较和哈希阶段拒绝重置、停用、撤销、过期及并发二次改密", async (t) => {
  for (const stage of ["compare", "hash"] as const) {
    for (const action of [
      "reset",
      "disable",
      "revoke",
      "expire",
      "password",
    ] as const) {
      await t.test(`${stage}/${action}`, async () => {
        const owner = account(),
          sid = login(owner),
          other = login(owner);
        const grant = restoreGrant(owner);
        let release!: () => void, entered!: () => void;
        const waiting = new Promise<void>((resolve) => (entered = resolve));
        const barrier = new Promise<void>((resolve) => (release = resolve));
        const original = bcrypt[stage].bind(bcrypt);
        const replacement = mock.method(
          bcrypt,
          stage,
          async (...args: unknown[]) => {
            entered();
            await barrier;
            return (original as (...values: unknown[]) => unknown)(...args);
          },
        );
        try {
          const pending = changePassword(
            owner,
            sid,
            "synthetic-password",
            "pending-password",
          );
          const rejected = assert.rejects(
            pending,
            (error) => (error as { code: string }).code === "UNAUTHENTICATED",
          );
          await waiting;
          replacement.mock.restore();
          if (action === "reset") {
            run(
              "UPDATE users SET password=? WHERE id=?",
              bcrypt.hashSync("admin-password", 4),
              owner,
            );
            run("DELETE FROM sessions WHERE owner=?", owner);
          } else if (action === "disable") {
            run("INSERT INTO account_status VALUES(?,1)", owner);
          } else if (action === "revoke") {
            run("DELETE FROM sessions WHERE id=?", sid);
          } else if (action === "expire") {
            run("UPDATE sessions SET expires=0 WHERE id=?", sid);
          } else {
            // A second request can complete while the first computes its new hash.
            if (stage === "hash")
              await changePassword(
                owner,
                other,
                "synthetic-password",
                "second-password",
              );
            else
              run(
                "UPDATE users SET password=? WHERE id=?",
                bcrypt.hashSync("second-password", 4),
                owner,
              );
          }
          const expected = one(
            "SELECT password FROM users WHERE id=?",
            owner,
          )!.password;
          release();
          await rejected;
          assert.equal(
            one("SELECT password FROM users WHERE id=?", owner)!.password,
            expected,
          );
          assert.equal(bcrypt.compareSync("pending-password", expected), false);
          // A rejected request must not consume unrelated recovery authorization.
          if (stage === "hash" && action === "password")
            assert.throws(
              () => consumeRestoreGrant(owner, grant.token),
              /过期或已使用/,
            );
          else consumeRestoreGrant(owner, grant.token);
        } finally {
          release();
          replacement.mock.restore();
        }
      });
    }
  }
});
test("成功改密原子保留当前会话并撤销其他会话和全部恢复授权", async () => {
  const owner = account(),
    sid = login(owner);
  login(owner);
  const grant = restoreGrant(owner);
  await changePassword(
    owner,
    sid,
    "synthetic-password",
    "replacement-password",
  );
  assert(
    bcrypt.compareSync(
      "replacement-password",
      one("SELECT password FROM users WHERE id=?", owner)!.password,
    ),
  );
  assert.equal(
    one("SELECT count(*) n FROM sessions WHERE owner=?", owner)!.n,
    1,
  );
  assert(one("SELECT id FROM sessions WHERE id=?", sid));
  assert.throws(() => consumeRestoreGrant(owner, grant.token), /过期或已使用/);
});
test("二次验证按账号持久退避，成功清除失败计数且账号互不影响", async () => {
  const owner = account(),
    other = account();
  let now = Date.now();
  const options = { now: () => now };
  await assert.rejects(
    () => verifyCurrentPassword(owner, "wrong", options),
    /不正确/,
  );
  assert.equal(
    one("SELECT failures FROM reauth_limits WHERE owner=?", owner)!.failures,
    1,
  );
  await assert.rejects(
    () => verifyCurrentPassword(owner, "synthetic-password", options),
    (error) => (error as { code: string }).code === "REAUTH_RATE_LIMITED",
  );
  assert(await verifyCurrentPassword(other, "synthetic-password", options));
  now += 1001;
  await assert.rejects(() => verifyCurrentPassword(owner, "wrong", options));
  assert.equal(
    one("SELECT blocked_until FROM reauth_limits WHERE owner=?", owner)!
      .blocked_until,
    now + 2000,
  );
  now += 2001;
  assert(await verifyCurrentPassword(owner, "synthetic-password", options));
  assert.equal(
    one("SELECT * FROM reauth_limits WHERE owner=?", owner),
    undefined,
  );
});
test("并发密码比较先抢持久租约，租约过期可恢复", async () => {
  const owner = account();
  const first = verifyCurrentPassword(owner, "synthetic-password");
  await assert.rejects(
    () => verifyCurrentPassword(owner, "synthetic-password"),
    /正在验证/,
  );
  await first;
  run(
    "INSERT INTO reauth_limits VALUES(?,0,0,?,'abandoned')",
    owner,
    Date.now() - 1,
  );
  assert(await verifyCurrentPassword(owner, "synthetic-password"));
});
test("恢复凭据仅存摘要、短期、归属隔离且一次性消费", () => {
  const owner = account(),
    other = account(),
    now = Date.now();
  const grant = restoreGrant(owner, now);
  const stored = one(
    "SELECT key_hash FROM reauth_grants WHERE owner=?",
    owner,
  )!;
  assert.notEqual(stored.key_hash, grant.token);
  assert.throws(
    () => consumeRestoreGrant(other, grant.token, now),
    /过期或已使用/,
  );
  consumeRestoreGrant(owner, grant.token, now);
  assert.throws(
    () => consumeRestoreGrant(owner, grant.token, now),
    /过期或已使用/,
  );
  assert.throws(
    () =>
      consumeRestoreGrant(owner, restoreGrant(owner, now).token, now + 120001),
    /过期或已使用/,
  );
  assert.throws(() => consumeRestoreGrant(owner, null, now), /先验证/);
});
