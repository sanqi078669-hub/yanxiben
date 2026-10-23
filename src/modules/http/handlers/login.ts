import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { one, run } from "../../../lib/db";
import { session } from "../../auth/session";
import { assert } from "../../entries/service";
import type { PublicContext } from "../context";
export async function loginHandler(context: PublicContext) {
  const { json, ok } = context;
  const b = z
    .object({
      username: z.string().min(1).max(100),
      password: z.string().max(200),
    })
    .strict()
    .parse(await json());
  const key = b.username.toLowerCase();
  const limit = one("SELECT * FROM login_limits WHERE key=?", key);
  assert(
    !limit || limit.reset_at < Date.now() || limit.count < 10,
    429,
    "RATE_LIMITED",
    "尝试次数过多，请 15 分钟后再试",
  );
  run(
    "INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END",
    key,
    Date.now() + 900000,
    Date.now(),
    Date.now(),
  );
  const user = one("SELECT * FROM users WHERE username=?", b.username);
  const valid = await bcrypt.compare(
    b.password,
    user?.password ||
      "$2b$12$xg19SQp9u2/2XLu7HSS.Bu6wXGZ0BPFj3P8kHpoU5vTQyHEQhBvgy",
  );
  assert(user && valid, 401, "UNAUTHENTICATED", "账号或密码错误");
  const s = await session();
  if (s.sid) run("DELETE FROM sessions WHERE id=?", s.sid);
  s.sid = randomUUID();
  run(
    "INSERT INTO sessions VALUES(?,?,?)",
    s.sid,
    user.id,
    Date.now() + 604800000,
  );
  await s.save();
  run("DELETE FROM login_limits WHERE key=?", key);
  return ok({ settings: JSON.parse(user.settings) });
}
