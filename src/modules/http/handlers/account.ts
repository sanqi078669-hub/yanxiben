import bcrypt from "bcryptjs";
import { z } from "zod";
import { one, run } from "../../../lib/db";
import { assert, settings } from "../../entries/service";
import { settingsSchema } from "../../../lib/model";
import type { ApiContext } from "../context";
export async function accountHandler(context: ApiContext) {
  const { p, method, owner, s, json, ok } = context;
  if (p === "auth/identity" && method === "GET") return ok({ owner });
  if (p === "auth/logout" && method === "POST") {
    run("DELETE FROM sessions WHERE id=?", s.sid!);
    s.destroy();
    return ok(true);
  }
  if (p === "auth/password" && method === "POST") {
    const b = z
      .object({ current: z.string(), password: z.string().min(12).max(200) })
      .strict()
      .parse(await json());
    assert(
      await bcrypt.compare(
        b.current,
        one("SELECT password FROM users WHERE id=?", owner)!.password,
      ),
      400,
      "INVALID_PASSWORD",
      "当前密码不正确",
    );
    run(
      "UPDATE users SET password=? WHERE id=?",
      await bcrypt.hash(b.password, 12),
      owner,
    );
    run("DELETE FROM sessions WHERE owner=? AND id<>?", owner, s.sid!);
    return ok(true);
  }
  if (p === "settings") {
    if (method === "GET") return ok(settings(owner));
    if (method === "PATCH") {
      const v = settingsSchema.parse(await json());
      run("UPDATE users SET settings=? WHERE id=?", JSON.stringify(v), owner);
      return ok(v);
    }
  }
}
