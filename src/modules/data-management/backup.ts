import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { createHash, randomBytes } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  all,
  one,
  run,
  transaction,
  readSnapshot,
  db,
  dataDir,
} from "../../lib/db";
import { assert, unpack, AppError } from "../entries/service";
import { templateFields, legacyTemplate, type Template } from "../../lib/model";
import { z } from "zod";
import { initKnowledgeTools } from "../entries/knowledge";
import { initAudit } from "../ai/audit";
import { validateBackupData } from "./backup-validation";
import { ensureReferenced } from "../dictionaries/ensure";
import { BACKUP_FORMAT_VERSION, upgradeBackup } from "./backup-upgrade";
import { DATABASE_VERSION } from "../../lib/migrations";
import {
  BACKUP_ZIP_MAX_BYTES,
  BACKUP_UNPACKED_MAX_BYTES,
} from "../../lib/capacity";
import { checkAttachmentCapacity, checkBackupCapacity } from "./capacity";
const tables = [
  "dictionary_items",
  "entries",
  "attachments",
  "knowledge",
  "relations",
  "reviews",
  "logs",
  "revisions",
  "idempotency",
  "knowledge_aliases",
  "knowledge_merges",
  "ai_audit",
  "ai_audit_extras",
  "entry_hint_usage",
] as const;
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function checkedZip(files: Record<string, Uint8Array>) {
  const unpacked = Object.values(files).reduce(
    (sum, value) => sum + value.byteLength,
    0,
  );
  checkBackupCapacity(unpacked);
  const zipped = zipSync(files);
  checkBackupCapacity(unpacked, zipped.byteLength);
  return zipped;
}
function preflightBackup(owner: string) {
  let estimated = 0;
  for (const table of tables) {
    const columns = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => String(row.name));
    const expression = columns
      .map((column) => `'${column}',"${column}"`)
      .join(",");
    const size = one(
      `SELECT coalesce(sum(length(CAST(json_object(${expression}) AS BLOB))+1),0) n FROM ${table} WHERE owner=?`,
      owner,
    )!;
    estimated += Number(size.n);
    checkBackupCapacity(estimated);
  }
  for (const attachment of db
    .prepare("SELECT id FROM attachments WHERE owner=?")
    .iterate(owner)) {
    const size = statSync(
      path.join(dataDir, "attachments", String(attachment.id)),
    ).size;
    checkAttachmentCapacity(size);
    estimated += size;
    checkBackupCapacity(estimated);
  }
}
function backupJson(bytes: Uint8Array, name: string) {
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    assert(false, 400, "INVALID_BACKUP", `备份 JSON 无效：${name}`);
  }
}
export function backup(owner: string) {
  initKnowledgeTools();
  initAudit();
  const files = readSnapshot(() => {
    preflightBackup(owner);
    const data: Record<string, unknown> = {
      profile: {
        id: owner,
        settings: JSON.parse(
          one("SELECT settings FROM users WHERE id=?", owner)!.settings,
        ),
      },
    };
    const files: Record<string, Uint8Array> = {};
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const rows = all(`SELECT * FROM ${table} WHERE owner=?`, owner);
      data[table] = rows;
      counts[table] = rows.length;
    }
    for (const a of data.attachments as any[])
      files["attachments/" + a.id] = readFileSync(
        path.join(dataDir, "attachments", a.id),
      );
    files["data.json"] = strToU8(JSON.stringify(data));
    files["manifest.json"] = strToU8(
      JSON.stringify(
        {
          schemaVersion: BACKUP_FORMAT_VERSION,
          databaseVersion: DATABASE_VERSION,
          appVersion: "0.1.0",
          exportedAt: new Date().toISOString(),
          counts,
          files: Object.entries(files).map(([name, b]) => ({
            name,
            size: b.length,
            sha256: digest(b),
          })),
        },
        null,
        2,
      ),
    );
    return files;
  });
  return checkedZip(files);
}
export function markdownExport(owner: string) {
  const files = readSnapshot(() => {
    const files: Record<string, Uint8Array> = {};
    const dictionaryLabels = new Map(
      all(
        "SELECT kind,value,label FROM dictionary_items WHERE owner=?",
        owner,
      ).map((row) => [
        JSON.stringify([row.kind, row.value]),
        row.label as string,
      ]),
    );
    const typeTemplates = new Map<string, Template>(
      all(
        "SELECT value,template FROM dictionary_items WHERE owner=? AND kind='TYPE'",
        owner,
      ).map((row) => [row.value, row.template]),
    );
    const label = (kind: "SUBJECT" | "ERROR", value: string) =>
      dictionaryLabels.get(JSON.stringify([kind, value]))?.trim() || value;
    const knowledgeNames = new Map(
      all("SELECT id,name FROM knowledge WHERE owner=?", owner).map((row) => [
        row.id,
        row.name as string,
      ]),
    );
    let index = "# 研习本 · 阅读导出\n\n";
    for (const row of all(
      "SELECT * FROM entries WHERE owner=? AND deleted_at IS NULL",
      owner,
    )) {
      const e = unpack(row);
      const template =
        typeTemplates.get(e.type) ?? legacyTemplate(e.type) ?? "GENERIC";
      let md = `# ${e.title || "未命名记录"}\n\n${label("SUBJECT", e.subject)} · ${e.status}\n\n## 原材料\n\n${e.body}\n\n来源：${e.source}\n\n`;
      if (template === "CS") {
        md += `题型：${e.details.subtype === "CONCEPT" ? "概念疑问" : "题目"}\n\n`;
        if (e.details.options_json)
          md += `## 选项\n\n${JSON.parse(e.details.options_json)
            .map((option: string) => `- ${option}`)
            .join("\n")}\n\n`;
      }
      for (const [key, label] of templateFields[template])
        if (e.details[key]) md += `## ${label}\n\n${e.details[key]}\n\n`;
      for (const c of e.contexts)
        md += `## 语境\n\n${c.sentence_text}\n\n${c.meaning_md}\n\n${c.collocation}\n\n来源：${c.source}\n\n`;
      md += `## 总结\n\n${e.summary}\n\n标签：${e.tags.join("、")}\n\n`;
      md += `错因：${e.errors.map((value) => label("ERROR", value)).join("、") || "无"}\n\n知识点：${e.knowledgeIds.map((value) => knowledgeNames.get(value) || value).join("、") || "无"}\n\n`;
      for (const a of e.attachments) {
        const f = one(
          "SELECT * FROM attachments WHERE id=? AND owner=?",
          a.id,
          owner,
        )!;
        const ext =
          f.mime === "image/png"
            ? "png"
            : f.mime === "image/jpeg"
              ? "jpg"
              : "webp";
        const name = `attachments/${a.id}.${ext}`;
        checkAttachmentCapacity(
          statSync(path.join(dataDir, "attachments", a.id)).size,
        );
        files[name] = readFileSync(path.join(dataDir, "attachments", a.id));
        md += `![${a.role === "PROMPT" ? "题面" : "答案"}](${name})\n\n`;
      }
      files[e.id + ".md"] = strToU8(md);
      index += `- [${e.title.replace(/[\[\]\n]/g, "") || "未命名记录"}](${e.id}.md)\n`;
    }
    files["README.md"] = strToU8(index);
    return files;
  });
  return checkedZip(files);
}
export async function restore(
  bytes: Uint8Array,
  username: string,
  passwordHash: string,
) {
  try {
    return await restoreData(bytes, username, passwordHash);
  } catch (error) {
    const sqlite = error as { errcode?: number };
    if (
      error instanceof z.ZodError ||
      (typeof sqlite.errcode === "number" && (sqlite.errcode & 255) === 19)
    ) {
      console.error("Restore validation/constraint failure:", error);
      throw new AppError(
        400,
        "INVALID_BACKUP",
        "备份数据校验未通过，未导入数据",
      );
    }
    throw error;
  }
}
async function restoreData(
  bytes: Uint8Array,
  username: string,
  passwordHash: string,
) {
  initKnowledgeTools();
  initAudit();
  assert(
    !one("SELECT id FROM users LIMIT 1"),
    400,
    "NOT_EMPTY",
    "恢复仅允许在空白 DATA_DIR 中执行",
  );
  assert(
    bytes.length <= BACKUP_ZIP_MAX_BYTES,
    413,
    "BACKUP_TOO_LARGE",
    "备份 ZIP 最大 200 MiB",
  );
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        assert(
          !f.name.includes("..") &&
            !f.name.includes("\\") &&
            !f.name.startsWith("/"),
          400,
          "INVALID_BACKUP",
          "不安全的归档路径",
        );
        total += f.originalSize;
        assert(
          total <= BACKUP_UNPACKED_MAX_BYTES,
          400,
          "INVALID_BACKUP",
          "归档解压容量过大",
        );
        return true;
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_BACKUP", "ZIP 结构无效，未导入数据");
  }
  assert(
    files["manifest.json"] && files["data.json"],
    400,
    "INVALID_BACKUP",
    "备份缺少清单",
  );
  const manifest = z
    .object({
      schemaVersion: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
      ]),
      counts: z.record(z.string(), z.number().int().nonnegative()),
      files: z.array(
        z
          .object({
            name: z.string(),
            size: z.number().int().nonnegative(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      ),
    })
    .passthrough()
    .safeParse(backupJson(files["manifest.json"], "manifest.json"));
  assert(manifest.success, 400, "INVALID_BACKUP", "备份版本不兼容");
  const m = manifest.data;
  const expected = new Set(["manifest.json"]);
  for (const f of m.files) {
    assert(
      !expected.has(f.name) &&
        (f.name === "data.json" || /^attachments\/[0-9a-f-]{36}$/.test(f.name)),
    );
    const b = files[f.name];
    assert(
      b && b.length === f.size && digest(b) === f.sha256,
      400,
      "INVALID_BACKUP",
      "备份摘要或大小不匹配",
    );
    expected.add(f.name);
  }
  assert(
    expected.has("data.json") &&
      Object.keys(files).every((n) => expected.has(n)),
    400,
    "INVALID_BACKUP",
    "备份文件清单不完整",
  );
  const data = backupJson(files["data.json"], "data.json");
  assert(
    data && typeof data === "object" && !Array.isArray(data),
    400,
    "INVALID_BACKUP",
    "备份数据无效",
  );
  assert(
    Object.keys(data).every(
      (t) => t === "profile" || (tables as readonly string[]).includes(t),
    ),
    400,
    "INVALID_BACKUP",
    "备份含未知数据表",
  );
  upgradeBackup(data, m);
  for (const t of tables) {
    assert(
      Array.isArray(data[t]) && data[t].length === m.counts[t],
      400,
      "INVALID_BACKUP",
      `备份行数不符：${t}`,
    );
  }
  await validateBackupData(data, files);
  const owner = data.profile.id as string;
  const written: string[] = [];
  let promotedAdmin: string | null = null;
  try {
    transaction(() => {
      assert(
        !one("SELECT id FROM users LIMIT 1"),
        400,
        "NOT_EMPTY",
        "恢复仅允许在空白 DATA_DIR 中执行",
      );
      db.exec("PRAGMA defer_foreign_keys=ON");
      run(
        "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
        owner,
        username,
        passwordHash,
        JSON.stringify(data.profile.settings),
        "user",
      );
      const adminCount = db
        .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'")
        .get() as { c: number };
      if (adminCount.c === 0) {
        const first = db
          .prepare("SELECT id, username FROM users ORDER BY username LIMIT 1")
          .get() as { id: string; username: string } | undefined;
        if (first) {
          db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(first.id);
          promotedAdmin = first.username;
        }
      }
      for (const t of tables) {
        // Use accepted row keys, validated above; no SQL identifiers originate in the archive.
        const allowed = db
          .prepare(`PRAGMA table_info(${t})`)
          .all()
          .map((c) => c.name as string);
        for (const row of data[t]) {
          const keys = allowed.filter((c) => Object.hasOwn(row, c));
          db.prepare(
            `INSERT INTO ${t} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
          ).run(...keys.map((c) => row[c]));
        }
      }
      ensureReferenced(owner);
      assert(!db.prepare("PRAGMA foreign_key_check").all().length);
      for (const a of data.attachments) {
        const filename = path.join(dataDir, "attachments", a.id);
        writeFileSync(filename, files["attachments/" + a.id], {
          flag: "wx",
          mode: 0o600,
        });
        written.push(filename);
      }
      const secret = path.join(dataDir, "session-secret");
      if (!existsSync(secret)) {
        writeFileSync(secret, randomBytes(48).toString("hex"), {
          mode: 0o600,
          flag: "wx",
        });
        written.push(secret);
      }
    });
  } catch (error) {
    for (const filename of written.reverse()) unlinkSync(filename);
    throw error;
  }
  return { owner, counts: m.counts, promotedAdmin };
}
