import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { all, one, run, transaction, db, dataDir } from "../../lib/db";
import { assert, unpack } from "../entries/service";
import { entrySchema, settingsSchema, fields } from "../../lib/model";
import { initKnowledgeTools } from "../entries/knowledge";
import { initAudit } from "../ai/audit";
import { costSchema } from "../ai/pricing";
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
] as const;
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
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
          schemaVersion: 1,
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
export function restore(
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
  const m = JSON.parse(strFromU8(files["manifest.json"]));
  assert(
    m.schemaVersion === 1 && Array.isArray(m.files),
    400,
    "INVALID_BACKUP",
    "备份版本不兼容",
  );
  const expected = new Set(["manifest.json"]);
  for (const f of m.files) {
    assert(
      typeof f.name === "string" &&
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
  assert(Object.keys(files).every((n) => expected.has(n)));
  const data = JSON.parse(strFromU8(files["data.json"])),
    owner = data.profile.id;
  assert(/^[0-9a-f-]{36}$/.test(owner));
  settingsSchema.parse(data.profile.settings);
  for (const optional of ["knowledge_merges", "ai_audit", "ai_audit_extras"]) {
    if (data[optional] === undefined && m.counts[optional] === undefined) {
      data[optional] = [];
      m.counts[optional] = 0;
    }
  }
  // v1 backups created before aliases were introduced remain readable.
  if (
    data.knowledge_aliases === undefined &&
    m.counts.knowledge_aliases === undefined
  ) {
    data.knowledge_aliases = [];
    m.counts.knowledge_aliases = 0;
  }
  for (const t of tables) {
    assert(Array.isArray(data[t]) && data[t].length === m.counts[t]);
    for (const row of data[t])
      assert(row.owner === owner, 400, "INVALID_BACKUP", "备份归属不一致");
  }
  for (const e of data.entries) {
    const payload = entrySchema.parse(JSON.parse(e.payload));
    assert(
      payload.type === e.type &&
        payload.subject === e.subject &&
        payload.body === e.body &&
        payload.title === e.title &&
        payload.status === e.status,
    );
    for (const a of payload.attachments)
      assert(data.attachments.some((f: any) => f.id === a.id));
    for (const k of payload.knowledgeIds)
      assert(
        data.knowledge.some(
          (n: any) => n.id === k && n.subject === payload.subject,
        ),
      );
    for (const c of payload.contexts)
      if (c.sentence_entry_id)
        assert(
          data.entries.some(
            (n: any) => n.id === c.sentence_entry_id && n.type === "SENTENCE",
          ),
        );
  }
  for (const alias of data.knowledge_aliases) {
    assert(
      typeof alias.name === "string" &&
        alias.name.length > 0 &&
        alias.name.length <= 100,
    );
    assert(
      data.knowledge.some(
        (node: any) => node.id === alias.node_id && node.owner === owner,
      ),
    );
  }
  for (const audit of data.ai_audit) {
    assert(
      typeof audit.model === "string" &&
        typeof audit.host === "string" &&
        typeof audit.feedback === "string",
    );
    if (audit.result !== null) {
      const result = JSON.parse(audit.result);
      assert(
        result && typeof result === "object" && !Array.isArray(result),
        400,
        "INVALID_BACKUP",
        "AI 建议记录格式无效",
      );
    }
  }
  for (const extra of data.ai_audit_extras) {
    assert(
      data.ai_audit.some((row: any) => row.id === extra.id),
      400,
      "INVALID_BACKUP",
      "费用依据缺少对应调用记录",
    );
    const payload = JSON.parse(extra.payload);
    if (payload.cost !== null) costSchema.parse(payload.cost);
  }
  for (const merge of data.knowledge_merges) {
    const payload = JSON.parse(merge.payload);
    assert(
      payload.before && payload.after && typeof payload.aliasId === "string",
      400,
      "INVALID_BACKUP",
      "知识点合并日志格式无效",
    );
  }
  for (const a of data.attachments) {
    assert(/^[0-9a-f-]{36}$/.test(a.id));
    const b = files["attachments/" + a.id];
    assert(b && digest(b) === a.sha256 && b.length === a.size);
  }
  transaction(() => {
    db.exec("PRAGMA defer_foreign_keys=ON");
    run(
      "INSERT INTO users VALUES(?,?,?,?)",
      owner,
      username,
      passwordHash,
      JSON.stringify(data.profile.settings),
    );
    for (const t of tables) {
      const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(
        (c) => c.name,
      );
      for (const row of data[t]) {
        assert(
          Object.keys(row).length === cols.length &&
            cols.every((c) => c in row),
        );
        db.prepare(
          `INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
        ).run(...cols.map((c) => row[c]));
      }
    }
    assert(!db.prepare("PRAGMA foreign_key_check").all().length);
    for (const a of data.attachments)
      writeFileSync(
        path.join(dataDir, "attachments", a.id),
        files["attachments/" + a.id],
      );
  });
  writeFileSync(
    path.join(dataDir, "session-secret"),
    randomBytes(48).toString("hex"),
    { mode: 0o600 },
  );
  return { owner, counts: m.counts };
}
