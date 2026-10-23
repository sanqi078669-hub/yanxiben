import { randomUUID, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { dataDir, one, run } from "../src/lib/db";
import { defaults } from "../src/lib/model";
const username = process.env.INIT_USERNAME || "student";
if (!existsSync(path.join(dataDir, "session-secret"))) {
  writeFileSync(
    path.join(dataDir, "session-secret"),
    randomBytes(48).toString("hex"),
    { mode: 0o600, flag: "wx" },
  );
  console.log("已生成缺失的会话密钥；此前的浏览器会话需要重新登录。");
}
if (one("SELECT id FROM users WHERE username=?", username)) {
  console.log("账号已存在，未修改密码。");
  process.exit(0);
}
const password =
  process.env.INIT_PASSWORD || randomBytes(12).toString("base64url");
if (password.length < 12) throw new Error("密码至少 12 位");
run(
  "INSERT INTO users VALUES(?,?,?,?)",
  randomUUID(),
  username,
  bcrypt.hashSync(password, 12),
  JSON.stringify(defaults),
);
writeFileSync(
  path.join(dataDir, "local-login.txt"),
  `本地账号：${username}\n初始密码：${password}\n地址：http://127.0.0.1:3000\n请妥善保存，登录后可在设置修改密码。\n`,
  { mode: 0o600 },
);
console.log(
  "私人账号初始化成功。凭据保存在 data/local-login.txt（未输出到日志）。",
);
