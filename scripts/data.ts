import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { privateDirectory } from "../src/lib/private-files";
import { BACKUP_ZIP_MAX_BYTES } from "../src/lib/capacity";
const [command, file] = process.argv.slice(2);
if (!file)
  throw new Error(
    "用法：npm run backup -- backups/name.zip 或 DATA_DIR=空目录 npm run restore -- backups/name.zip",
  );
if (!["backup", "restore"].includes(command)) throw new Error("未知命令");
if (command === "backup" && existsSync(file))
  throw new Error("目标文件已存在，请选择新文件名");
if (command === "restore") {
  if (
    !process.env.DATA_DIR ||
    !process.env.RESTORE_PASSWORD ||
    process.env.RESTORE_PASSWORD.length < 12
  )
    throw new Error("请指定新的 DATA_DIR 和至少 12 位 RESTORE_PASSWORD");
  const directory = path.resolve(process.env.DATA_DIR);
  if (existsSync(directory) && readdirSync(directory).length > 0)
    throw new Error("恢复需要全新或空目录；未打开或迁移已有数据库");
  if (statSync(file).size > BACKUP_ZIP_MAX_BYTES)
    throw new Error("备份 ZIP 最大 200 MiB");
}
const restoreBytes = command === "restore" ? readFileSync(file) : null;
const { all } = await import("../src/lib/db");
const { backup, restore } =
  await import("../src/modules/data-management/backup");
if (command === "backup") {
  const users = all("SELECT id FROM users");
  if (users.length !== 1) throw new Error("本地命令需要恰好一个账号");
  if (existsSync(file)) throw new Error("目标文件已存在，请选择新文件名");
  privateDirectory(path.dirname(path.resolve(file)));
  writeFileSync(file, backup(users[0].id), { flag: "wx", mode: 0o600 });
  console.log("备份已写入 " + path.resolve(file));
} else if (command === "restore") {
  console.log(
    await restore(
      restoreBytes!,
      process.env.RESTORE_USERNAME || "student",
      bcrypt.hashSync(process.env.RESTORE_PASSWORD!, 12),
    ),
  );
} else throw new Error("未知命令");
