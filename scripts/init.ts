import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir, one } from "../src/lib/db";
import { maintainAccount } from "../src/modules/auth/admin";
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
const result = maintainAccount("create", username, process.env.INIT_PASSWORD);
console.log("账号创建完成；私有交付文件：" + result.credential);
