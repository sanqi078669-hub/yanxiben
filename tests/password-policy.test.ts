import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import bcrypt from "bcryptjs";
import { newPasswordSchema, passwordBytes } from "../src/lib/password-policy";
process.env.DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-password-policy-"),
);
const { one, run } = await import("../src/lib/db");
const { defaults } = await import("../src/lib/model");
const { changePassword, verifyCurrentPassword } =
  await import("../src/modules/auth/reauth");
const { maintainAccount } = await import("../src/modules/auth/admin");
test("网页与 CLI 的 ASCII、中文、emoji 新密码统一使用 UTF-8 72/73 字节边界", () => {
  for (const prefix of ["a".repeat(72), "中".repeat(24), "😀".repeat(18)]) {
    assert.equal(passwordBytes(prefix), 72);
    assert.equal(newPasswordSchema.safeParse(prefix).success, true);
    assert.equal(passwordBytes(prefix + "x"), 73);
    assert.equal(newPasswordSchema.safeParse(prefix + "x").success, false);
    const username = randomUUID();
    const result = maintainAccount("create", username, prefix);
    unlinkSync(result.credential!);
    const before = one(
      "SELECT password FROM users WHERE username=?",
      username,
    )!.password;
    assert.throws(
      () => maintainAccount("reset", username, prefix + "x"),
      /72 字节/,
    );
    assert.equal(
      one("SELECT password FROM users WHERE username=?", username)!.password,
      before,
    );
    assert.throws(
      () => maintainAccount("create", randomUUID(), prefix + "x"),
      /72 字节/,
    );
  }
});
test("存量长密码仍可验证，仅改超限后缀被拒绝，随后可改为合规密码", async () => {
  const owner = randomUUID(),
    sid = randomUUID(),
    old = "a".repeat(72) + "old".repeat(100);
  const credential = bcrypt.hashSync(old, 4);
  // bcryptjs truncates beyond byte 72 rather than rejecting the input.
  assert(bcrypt.compareSync("a".repeat(72) + "different-suffix", credential));
  run(
    "INSERT INTO users VALUES(?,?,?,?)",
    owner,
    owner,
    credential,
    JSON.stringify(defaults),
  );
  run("INSERT INTO sessions VALUES(?,?,?)", sid, owner, Date.now() + 60000);
  assert(await verifyCurrentPassword(owner, old, { sid }));
  await assert.rejects(
    () => changePassword(owner, sid, old, "a".repeat(72) + "new"),
    /72 字节/,
  );
  assert.equal(
    one("SELECT password FROM users WHERE id=?", owner)!.password,
    credential,
  );
  const next = "中".repeat(24);
  await changePassword(owner, sid, old, next);
  const updated = one("SELECT password FROM users WHERE id=?", owner)!.password;
  assert(bcrypt.compareSync(next, updated));
  assert.equal(bcrypt.compareSync(old, updated), false);
});
