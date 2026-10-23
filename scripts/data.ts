import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { all } from "../src/lib/db";
import { backup, restore } from "../src/modules/data-management/backup";
const [command, file] = process.argv.slice(2);
if (!file)
  throw new Error(
    "用法：npm run backup -- backups/name.zip 或 DATA_DIR=空目录 npm run restore -- backups/name.zip",
  );
if (command === "backup") {
  const users = all("SELECT id FROM users");
  if (users.length !== 1) throw new Error("本地命令需要恰好一个账号");
  if (existsSync(file)) throw new Error("目标文件已存在，请选择新文件名");
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, backup(users[0].id));
  console.log("备份已写入 " + path.resolve(file));
} else if (command === "restore") {
  if (
    !process.env.DATA_DIR ||
    !process.env.RESTORE_PASSWORD ||
    process.env.RESTORE_PASSWORD.length < 12
  )
    throw new Error("请指定新的 DATA_DIR 和至少 12 位 RESTORE_PASSWORD");
  console.log(
    restore(
      readFileSync(file),
      process.env.RESTORE_USERNAME || "student",
      bcrypt.hashSync(process.env.RESTORE_PASSWORD, 12),
    ),
  );
} else throw new Error("未知命令");
