import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { one, run, transaction } from "../../lib/db";
import { AppError, assert } from "../entries/service";
import { newPasswordSchema } from "../../lib/password-policy";

function assertCredentialState(
  owner: string,
  credential: string,
  sid: string | undefined,
  now: number,
) {
  assert(
    one(
      "SELECT id FROM users WHERE id=? AND password=? AND NOT EXISTS(SELECT 1 FROM account_status WHERE owner=? AND disabled=1)",
      owner,
      credential,
      owner,
    ) &&
      (!sid ||
        one(
          "SELECT id FROM sessions WHERE id=? AND owner=? AND expires>?",
          sid,
          owner,
          now,
        )),
    401,
    "UNAUTHENTICATED",
    "凭据或会话已失效，请重新登录",
  );
}

export async function verifyCurrentPassword(
  owner: string,
  password: string,
  options: {
    status?: number;
    code?: string;
    message?: string;
    now?: () => number;
    sid?: string;
  } = {},
) {
  z.string().parse(password);
  const clock = options.now || Date.now,
    leaseId = randomUUID();
  transaction(() => {
    const now = clock(),
      previous = one("SELECT * FROM reauth_limits WHERE owner=?", owner);
    assert(
      !previous || previous.blocked_until <= now,
      429,
      "REAUTH_RATE_LIMITED",
      "密码验证失败后需要等待，请稍后重试",
    );
    assert(
      !previous || previous.lease_until <= now,
      429,
      "REAUTH_BUSY",
      "当前账号正在验证密码，请等待结果",
    );
    const failures =
      previous && now - previous.blocked_until < 900000 ? previous.failures : 0;
    run(
      "INSERT INTO reauth_limits VALUES(?,?,0,?,?) ON CONFLICT(owner) DO UPDATE SET failures=excluded.failures,lease_until=excluded.lease_until,lease_id=excluded.lease_id",
      owner,
      failures,
      now + 30000,
      leaseId,
    );
  });
  let finished = false;
  try {
    const user = one("SELECT password FROM users WHERE id=?", owner);
    assert(user, 401, "UNAUTHENTICATED", "会话已失效，请重新登录");
    assertCredentialState(owner, user.password, options.sid, clock());
    const valid = await bcrypt.compare(password, user.password);
    transaction(() => {
      assertCredentialState(owner, user.password, options.sid, clock());
      const lease = one(
        "SELECT * FROM reauth_limits WHERE owner=? AND lease_id=?",
        owner,
        leaseId,
      );
      assert(lease, 429, "REAUTH_EXPIRED", "密码验证状态已过期，请重试");
      if (valid)
        run(
          "DELETE FROM reauth_limits WHERE owner=? AND lease_id=?",
          owner,
          leaseId,
        );
      else {
        const failures = Number(lease.failures) + 1;
        const delay = Math.min(900000, 1000 * 2 ** Math.min(20, failures - 1));
        run(
          "UPDATE reauth_limits SET failures=?,blocked_until=?,lease_until=0,lease_id='' WHERE owner=? AND lease_id=?",
          failures,
          clock() + delay,
          owner,
          leaseId,
        );
      }
    });
    finished = true;
    if (!valid)
      throw new AppError(
        options.status ?? 403,
        options.code || "INVALID_PASSWORD",
        options.message || "当前密码不正确",
      );
    return String(user.password);
  } finally {
    if (!finished)
      run(
        "UPDATE reauth_limits SET lease_until=0,lease_id='' WHERE owner=? AND lease_id=?",
        owner,
        leaseId,
      );
  }
}
export async function changePassword(
  owner: string,
  sid: string,
  current: string,
  password: string,
) {
  newPasswordSchema.parse(password);
  const credential = await verifyCurrentPassword(owner, current, {
    status: 400,
    sid,
  });
  const next = await bcrypt.hash(password, 12);
  transaction(() => {
    assertCredentialState(owner, credential, sid, Date.now());
    const result = run(
      "UPDATE users SET password=? WHERE id=? AND password=?",
      next,
      owner,
      credential,
    );
    assert(
      result.changes === 1,
      401,
      "UNAUTHENTICATED",
      "凭据已失效，请重新登录",
    );
    run("DELETE FROM sessions WHERE owner=? AND id<>?", owner, sid);
    run("DELETE FROM reauth_grants WHERE owner=?", owner);
  });
}
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function restoreGrant(owner: string, now = Date.now()) {
  const token = randomBytes(32).toString("hex");
  transaction(() => {
    run("DELETE FROM reauth_grants WHERE expires<=?", now);
    run(
      "INSERT INTO reauth_grants VALUES(?,?,?)",
      hash(token),
      owner,
      now + 120000,
    );
  });
  return { token, expiresInSeconds: 120 };
}
export function consumeRestoreGrant(
  owner: string,
  token: string | null,
  now = Date.now(),
) {
  assert(
    token && /^[a-f0-9]{64}$/.test(token),
    403,
    "REAUTH_REQUIRED",
    "请先验证当前密码，再上传恢复 ZIP",
  );
  transaction(() => {
    const result = run(
      "DELETE FROM reauth_grants WHERE key_hash=? AND owner=? AND expires>?",
      hash(token),
      owner,
      now,
    );
    assert(
      result.changes === 1,
      403,
      "REAUTH_REQUIRED",
      "恢复凭据已过期或已使用，请重新验证密码",
    );
  });
}
