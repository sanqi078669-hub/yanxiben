import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { dataDir, one, run, transaction } from "../../lib/db";
import { defaults } from "../../lib/model";
import { privateDirectory } from "../../lib/private-files";
import { newPasswordSchema, newPasswordHint } from "../../lib/password-policy";

export function maintainAccount(
  command: string,
  username: string,
  supplied?: string,
  role: "user" | "admin" = "user",
) {
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(username))
    throw new Error("用户名仅允许字母、数字、点、下划线和连字符");
  const user = one("SELECT id FROM users WHERE username=?", username);
  if (!["create", "reset", "disable", "enable", "revoke"].includes(command))
    throw new Error("未知账号操作");
  if (command === "create" ? !!user : !user)
    throw new Error(command === "create" ? "账号已存在" : "账号不存在");
  let credential: string | undefined;
  const owner = user?.id || randomUUID();
  const password = supplied || randomBytes(18).toString("base64url");
  if (["create", "reset"].includes(command)) {
    if (!newPasswordSchema.safeParse(password).success)
      throw new Error(newPasswordHint);
    const folder = path.join(dataDir, "credentials");
    privateDirectory(folder);
    credential = path.join(folder, randomUUID() + ".txt");
    writeFileSync(
      credential,
      `账号：${username}\n临时密码：${password}\n登录后请修改密码；通过私密渠道交付后删除此文件。\n`,
      { flag: "wx", mode: 0o600 },
    );
  }
  try {
    transaction(() => {
      if (command === "create")
        run(
          "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
          owner,
          username,
          bcrypt.hashSync(password, 12),
          JSON.stringify(defaults),
          role,
        );
      if (command === "reset")
        run(
          "UPDATE users SET password=? WHERE id=?",
          bcrypt.hashSync(password, 12),
          owner,
        );
      if (["disable", "enable"].includes(command))
        run(
          "INSERT INTO account_status VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET disabled=excluded.disabled",
          owner,
          command === "disable" ? 1 : 0,
        );
      if (command !== "create") {
        run("DELETE FROM sessions WHERE owner=?", owner);
        run("DELETE FROM reauth_grants WHERE owner=?", owner);
      }
    });
  } catch (error) {
    if (credential) unlinkSync(credential);
    throw error;
  }
  return { credential };
}
