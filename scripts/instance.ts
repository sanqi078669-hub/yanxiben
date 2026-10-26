// Offline instance snapshot: caller MUST stop all writers, including admin CLIs.
// No import of db.ts: never migrate source or destination during backup/verify.
import { DatabaseSync } from "node:sqlite";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  createReadStream,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
const [command, target, flag] = process.argv.slice(2);
const source = process.env.DATA_DIR && path.resolve(process.env.DATA_DIR);
if (!source || !target || !["snapshot", "verify"].includes(command))
  throw new Error(
    "DATA_DIR 必填；用法 instance snapshot 新目录 --offline 或 instance verify 快照目录",
  );
const destination = path.resolve(target);
async function fileDigest(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function digest(folder: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(relative: string) {
    const file = path.join(folder, relative),
      stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error("拒绝符号链接");
    if (stat.isDirectory())
      for (const name of readdirSync(file).sort())
        await walk(path.join(relative, name));
    else if (stat.isFile())
      result[relative.replaceAll("\\", "/")] = await fileDigest(file);
    else throw new Error("拒绝特殊文件");
  }
  for (const name of [
    "yanxiben.sqlite",
    "attachments",
    "ai-private",
    "session-secret",
  ])
    if (existsSync(path.join(folder, name))) await walk(name);
  return result;
}
if (command === "snapshot") {
  if (existsSync(path.join(source, "ai-private", "encryption-key")))
    throw new Error(
      "检测到旧版内置 AI 主密钥；先在隔离副本迁移并独立托管后再备份",
    );
  if (flag !== "--offline")
    throw new Error("请先停止应用和所有写入 CLI，再显式传入 --offline");
  if (existsSync(destination) || destination.startsWith(source + path.sep))
    throw new Error("目标必须为 DATA_DIR 外的全新目录");
  await digest(source); // Reject linked input before copying.
  mkdirSync(destination, { mode: 0o700 });
  const db = new DatabaseSync(path.join(source, "yanxiben.sqlite"), {
    readOnly: true,
  });
  try {
    const filename = path.join(destination, "yanxiben.sqlite");
    writeFileSync(filename, "", { mode: 0o600, flag: "wx" });
    db.exec("VACUUM INTO '" + filename.replaceAll("'", "''") + "'");
  } finally {
    db.close();
  }
  for (const name of ["attachments", "ai-private", "session-secret"])
    if (existsSync(path.join(source, name)))
      cpSync(path.join(source, name), path.join(destination, name), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
  writeFileSync(
    path.join(destination, "instance-manifest.json"),
    JSON.stringify({
      version: 1,
      created: new Date().toISOString(),
      files: await digest(destination),
    }),
    { mode: 0o600, flag: "wx" },
  );
}
const manifest = JSON.parse(
  readFileSync(path.join(destination, "instance-manifest.json"), "utf8"),
);
if (
  JSON.stringify(manifest.files) !== JSON.stringify(await digest(destination))
)
  throw new Error("快照文件摘要不匹配");
const db = new DatabaseSync(path.join(destination, "yanxiben.sqlite"), {
  readOnly: true,
});
try {
  if (
    db.prepare("PRAGMA integrity_check").get()!.integrity_check !== "ok" ||
    db.prepare("PRAGMA foreign_key_check").all().length
  )
    throw new Error("数据库完整性失败");
  const counts = Object.fromEntries(
    [
      "users",
      "entries",
      "attachments",
      "reviews",
      "logs",
      "revisions",
      "relations",
    ].map((name) => [
      name,
      db.prepare(`SELECT count(*) n FROM ${name}`).get()!.n,
    ]),
  );
  for (const row of db.prepare("SELECT id,sha256 FROM attachments").all()) {
    if (
      (await fileDigest(
        path.join(destination, "attachments", String(row.id)),
      )) !== row.sha256
    )
      throw new Error("附件摘要不匹配");
  }
  console.log(JSON.stringify({ status: "verified", counts }));
} finally {
  db.close();
}
