import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { one, run, transaction } from "../../../lib/db";
import { session } from "../../auth/session";
import { assert } from "../../entries/service";
import type { PublicContext } from "../context";
import {
  limitLogin,
  loginFailureKey,
  acquireLoginSlot,
} from "../../auth/login-boundary";
export async function loginHandler(context: PublicContext) {
  const { json, ok } = context;
  limitLogin(context.req.headers);
  const b = z
    .object({
      username: z.string().min(1).max(100),
      password: z.string(),
    })
    .strict()
    .parse(await json());
  const release = acquireLoginSlot();
  try {
    const key = loginFailureKey(context.req.headers, b.username);
    const limit = one("SELECT * FROM login_limits WHERE key=?", key);
    assert(
      !limit || limit.reset_at < Date.now() || limit.count < 20,
      429,
      "RATE_LIMITED",
      "尝试次数过多，请 15 分钟后再试",
    );
    const user = one("SELECT * FROM users WHERE username=?", b.username);
    const valid = await bcrypt.compare(
      b.password,
      user?.password ||
        "$2b$12$xg19SQp9u2/2XLu7HSS.Bu6wXGZ0BPFj3P8kHpoU5vTQyHEQhBvgy",
    );
    const disabled =
      user &&
      one("SELECT disabled FROM account_status WHERE owner=?", user.id)
        ?.disabled;
    if (!user || !valid || disabled)
      run(
        "INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END",
        key,
        Date.now() + 900000,
        Date.now(),
        Date.now(),
      );
    assert(
      user && valid && !disabled,
      401,
      "UNAUTHENTICATED",
      "账号或密码错误",
    );
    const s = await session();
    if (s.sid) run("DELETE FROM sessions WHERE id=?", s.sid);
    s.sid = randomUUID();
    transaction(() => {
      // A reset/disable may complete while bcrypt or cookies() is awaiting.
      assert(
        one("SELECT password FROM users WHERE id=?", user.id)?.password ===
          user.password &&
          !one("SELECT disabled FROM account_status WHERE owner=?", user.id)
            ?.disabled,
        401,
        "UNAUTHENTICATED",
        "账号或密码错误",
      );
      run(
        "INSERT INTO sessions VALUES(?,?,?)",
        s.sid!,
        user.id,
        Date.now() + 604800000,
      );
    });
    await s.save();
    run("DELETE FROM login_limits WHERE key=?", key);
    return ok({ settings: JSON.parse(user.settings) });
  } finally {
    release();
  }
}
