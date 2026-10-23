import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { all, one, run, transaction, db, dataDir } from "../../lib/db";
import { assert, unpack } from "../entries/service";
import { fields } from "../../lib/model";
import { z } from "zod";
import { initKnowledgeTools } from "../entries/knowledge";
import { initAudit } from "../ai/audit";
import { validateBackupData } from "./backup-validation";
import { BACKUP_FORMAT_VERSION, upgradeBackup } from "./backup-upgrade";
import { DATABASE_VERSION } from "../../lib/migrations";
const tables = [
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
  return transaction(() => {
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
    return zipSync(files);
  });
}
export function markdownExport(owner: string) {
  return transaction(() => {
    const files: Record<string, Uint8Array> = {};
    let index = "# 研习本 · 阅读导出\n\n";
    for (const row of all(
      "SELECT * FROM entries WHERE owner=? AND deleted_at IS NULL",
      owner,
    )) {
      const e = unpack(row);
      let md = `# ${e.title || "未命名记录"}\n\n${e.subject} · ${e.status}\n\n## 原材料\n\n${e.body}\n\n来源：${e.source}\n\n`;
      if (e.type === "CS") {
        md += `题型：${e.details.subtype === "CONCEPT" ? "概念疑问" : "题目"}\n\n`;
        if (e.details.options_json)
          md += `## 选项\n\n${JSON.parse(e.details.options_json)
            .map((option: string) => `- ${option}`)
            .join("\n")}\n\n`;
      }
      for (const [key, label] of fields[e.type])
        if (e.details[key]) md += `## ${label}\n\n${e.details[key]}\n\n`;
      for (const c of e.contexts)
        md += `## 语境\n\n${c.sentence_text}\n\n${c.meaning_md}\n\n${c.collocation}\n\n来源：${c.source}\n\n`;
      md += `## 总结\n\n${e.summary}\n\n标签：${e.tags.join("、")}\n\n`;
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
        files[name] = readFileSync(path.join(dataDir, "attachments", a.id));
        md += `![${a.role === "PROMPT" ? "题面" : "答案"}](${name})\n\n`;
      }
      files[e.id + ".md"] = strToU8(md);
      index += `- [${e.title.replace(/[\[\]\n]/g, "") || "未命名记录"}](${e.id}.md)\n`;
    }
    files["README.md"] = strToU8(index);
    return zipSync(files);
  });
}
export async function restore(
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
  assert(bytes.length <= 200 * 1024 * 1024);
  let total = 0;
  const files = unzipSync(bytes, {
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
        total <= 500 * 1024 * 1024,
        400,
        "INVALID_BACKUP",
        "归档解压容量过大",
      );
      return true;
    },
  });
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
        z.literal(BACKUP_FORMAT_VERSION),
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
        "INSERT INTO users VALUES(?,?,?,?)",
        owner,
        username,
        passwordHash,
        JSON.stringify(data.profile.settings),
      );
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
      assert(!db.prepare("PRAGMA foreign_key_check").all().length);
      for (const a of data.attachments) {
        const filename = path.join(dataDir, "attachments", a.id);
        writeFileSync(filename, files["attachments/" + a.id], { flag: "wx" });
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
  return { owner, counts: m.counts };
}
