import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-reauth-"));
const { run, one } = await import("../src/lib/db");
const { defaults } = await import("../src/lib/model");
const { verifyCurrentPassword, restoreGrant, consumeRestoreGrant } =
  await import("../src/modules/auth/reauth");
function account() {
  const owner = randomUUID();
  run(
    "INSERT INTO users VALUES(?,?,?,?)",
    owner,
    owner,
    bcrypt.hashSync("synthetic-password", 4),
    JSON.stringify(defaults),
  );
  return owner;
}
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
