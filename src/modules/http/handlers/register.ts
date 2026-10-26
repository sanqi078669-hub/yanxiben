import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { newPasswordSchema } from "../../../lib/password-policy";
import { defaults } from "../../../lib/model";
import { run, transaction } from "../../../lib/db";
import { AppError } from "../../entries/service";
import { limitRegister } from "../../auth/register-boundary";
import { session } from "../../auth/session";
import type { PublicContext } from "../context";

const registerBody = z
  .object({
    username: z
      .string()
      .regex(
        /^[a-zA-Z0-9_.-]{1,100}$/,
        "用户名仅允许字母、数字、点、下划线和连字符，长度 1–100",
      ),
    password: newPasswordSchema,
  })
  .strict();

export async function registerHandler(context: PublicContext) {
  const { json, ok, req } = context;
  limitRegister(req.headers);

  const { username, password } = registerBody.parse(await json());
  const hashedPassword = bcrypt.hashSync(password, 12);
  const s = await session();
  const newSid = randomUUID();
  const owner = randomUUID();

  try {
    transaction(() => {
      if (s.sid) run("DELETE FROM sessions WHERE id=?", s.sid);
      run(
        "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
        owner,
        username,
        hashedPassword,
        JSON.stringify(defaults),
        "user",
      );
      run(
        "INSERT INTO sessions VALUES(?,?,?)",
        newSid,
        owner,
        Date.now() + 604800000,
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "REGISTRATION_LIMIT_REACHED") {
      throw new AppError(
        409,
        "REGISTRATION_LIMIT_REACHED",
        "注册名额已满（上限 7 人）",
      );
    }
    if (message.includes("UNIQUE constraint failed: users.username")) {
      throw new AppError(400, "USERNAME_TAKEN", "用户名已被占用");
    }
    throw error;
  }

  s.sid = newSid;
  await s.save();
  return ok({ settings: defaults });
}
