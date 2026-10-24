import bcrypt from "bcryptjs";
import { z } from "zod";
import { run } from "../../../lib/db";
import { settings } from "../../entries/service";
import { settingsSchema } from "../../../lib/model";
import type { ApiContext } from "../context";
import { verifyCurrentPassword, restoreGrant } from "../../auth/reauth";
export async function accountHandler(context: ApiContext) {
  const { p, method, owner, s, json, ok } = context;
  if (p === "auth/identity" && method === "GET") return ok({ owner });
  if (p === "auth/reauth" && method === "POST") {
    const body = z
      .object({ password: z.string().max(200), purpose: z.literal("RESTORE") })
      .strict()
      .parse(await json());
    await verifyCurrentPassword(owner, body.password);
    return ok(restoreGrant(owner));
  }
  if (p === "auth/logout" && method === "POST") {
    run("DELETE FROM sessions WHERE id=?", s.sid!);
    s.destroy();
    return ok(true);
  }
  if (p === "auth/password" && method === "POST") {
    const b = z
      .object({
        current: z.string().max(200),
        password: z.string().min(12).max(200),
      })
      .strict()
      .parse(await json());
    await verifyCurrentPassword(owner, b.current, { status: 400 });
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
