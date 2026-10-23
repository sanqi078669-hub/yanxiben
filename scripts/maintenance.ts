import { all, run, transaction, dataDir } from "../src/lib/db";
import { unlinkSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
const [command, id, confirm] = process.argv.slice(2);
if (command === "purge") {
  if (!/^[0-9a-f-]{36}$/.test(id || "") || confirm !== "--confirm")
    throw new Error(
      "用法：npm run maintenance -- purge <回收站记录 UUID> --confirm",
    );
  const row = all(
    "SELECT * FROM entries WHERE id=? AND deleted_at IS NOT NULL",
    id,
  )[0];
  if (!row) throw new Error("只能永久清理已在回收站中的记录");
  // Stop rather than silently break vocabulary-context links in active or deleted entries.
  if (
    all("SELECT id,payload FROM entries WHERE id<>?", id).some((e) =>
      JSON.parse(e.payload).contexts.some(
        (c: any) => c.sentence_entry_id === id,
      ),
    )
  )
    throw new Error("请先解除其他词条语境对该长难句的引用");
  transaction(() => {
    run(
      "DELETE FROM idempotency WHERE scope IN (SELECT id FROM reviews WHERE entry_id=?)",
      id,
    );
    run(
      "DELETE FROM logs WHERE review_id IN (SELECT id FROM reviews WHERE entry_id=?)",
      id,
    );
    run("DELETE FROM reviews WHERE entry_id=?", id);
    run("DELETE FROM relations WHERE from_id=? OR to_id=?", id, id);
    run("DELETE FROM revisions WHERE entry_id=?", id);
    run("DELETE FROM entries WHERE id=?", id);
  });
  console.log("已永久清理指定记录；附件由 cleanup 命令检查引用后清理。");
} else if (command === "cleanup") {
  const used = new Set<string>();
  for (const r of all("SELECT payload FROM entries"))
    for (const a of JSON.parse(r.payload).attachments) used.add(a.id);
  for (const r of all("SELECT snapshot FROM revisions"))
    for (const a of JSON.parse(r.snapshot).attachments) used.add(a.id);
  let count = 0;
  transaction(() => {
    for (const a of all("SELECT * FROM attachments"))
      if (!used.has(a.id) && Date.now() - Date.parse(a.created_at) > 86400000) {
        try {
          unlinkSync(path.join(dataDir, "attachments", a.id));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        run("DELETE FROM attachments WHERE id=?", a.id);
        count++;
      }
    run("DELETE FROM sessions WHERE expires<?", Date.now());
    run("DELETE FROM login_limits WHERE reset_at<?", Date.now());
  });
  const known = new Set(all("SELECT id FROM attachments").map((a) => a.id));
  for (const name of readdirSync(path.join(dataDir, "attachments")))
    if (
      /^[0-9a-f-]{36}$/.test(name) &&
      !known.has(name) &&
      Date.now() - statSync(path.join(dataDir, "attachments", name)).mtimeMs >
        86400000
    ) {
      unlinkSync(path.join(dataDir, "attachments", name));
      count++;
    }
  console.log(`已清理 ${count} 个超过 24 小时且未被正文或历史引用的附件。`);
} else
  throw new Error(
    "用法：npm run maintenance -- cleanup 或 purge <UUID> --confirm。执行前请停止应用并备份。",
  );
