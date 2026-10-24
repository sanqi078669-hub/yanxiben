import { z } from "zod";
import { run } from "../../../lib/db";
import { settings } from "../../entries/service";
import { settingsSchema } from "../../../lib/model";
import { newPasswordSchema } from "../../../lib/password-policy";
import type { ApiContext } from "../context";
import {
  verifyCurrentPassword,
  restoreGrant,
  changePassword,
} from "../../auth/reauth";
export async function accountHandler(context: ApiContext) {
  const { p, method, owner, s, json, ok } = context;
  if (p === "auth/identity" && method === "GET") return ok({ owner });
  if (p === "auth/reauth" && method === "POST") {
    const body = z
      .object({ password: z.string(), purpose: z.literal("RESTORE") })
      .strict()
      .parse(await json());
    await verifyCurrentPassword(owner, body.password, { sid: s.sid! });
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
        current: z.string(),
        password: newPasswordSchema,
      })
      .strict()
      .parse(await json());
    await changePassword(owner, s.sid!, b.current, b.password);
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
