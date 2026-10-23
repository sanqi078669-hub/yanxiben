import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import sharp from "sharp";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-test-"));
const { db, one, run, all, dataDir } = await import("../src/lib/db");
const {
  createEntry,
  updateEntry,
  getEntry,
  entries,
  trashEntry,
  addReview,
  attempt,
  reviewQueue,
} = await import("../src/modules/entries/service");
const { schedule, localDate } = await import("../src/modules/review/schedule");
const { backup, restore, markdownExport } =
  await import("../src/modules/data-management/backup");
const { defaults, entrySchema } = await import("../src/lib/model");
const awaitAuditModule = await import("../src/modules/ai/audit");
const owner = randomUUID(),
  other = randomUUID();
run(
  "INSERT INTO users VALUES(?,?,?,?)",
  owner,
  "one",
  "hash",
  JSON.stringify(defaults),
);
run(
  "INSERT INTO users VALUES(?,?,?,?)",
  other,
  "two",
  "hash",
  JSON.stringify(defaults),
);
const input = (type = "MATH", body = "求 $\\lim_{x\\to 0} \\sin(x)/x$") =>
  entrySchema.parse({
    type,
    title: "极限测试",
    subject: type === "MATH" ? "高等数学" : type === "CS" ? "数据结构" : "英语",
    body,
  });
test("四种模板可以创建并回读", () => {
  for (const t of ["MATH", "CS", "VOCABULARY", "SENTENCE"]) {
    const e = createEntry(owner, input(t));
    assert.equal(getEntry(owner, e.id).type, t);
  }
});
test("空题面以及只有无效附件不得保存", () => {
  assert.throws(() => createEntry(owner, input("MATH", "")));
  assert.throws(() =>
    createEntry(owner, {
      ...input("MATH", ""),
      attachments: [{ id: randomUUID(), role: "PROMPT" }],
    }),
  );
});
test("未知字段和不兼容科目被拒绝", () => {
  assert.throws(() => createEntry(owner, { ...input(), admin: true }));
  assert.throws(() => createEntry(owner, { ...input(), subject: "英语" }));
  assert.throws(() =>
    createEntry(owner, { ...input(), details: { bogus: "x" } }),
  );
});
test("旧版本不会覆盖新内容，手动保存保留历史", () => {
  const e = createEntry(owner, input());
  const updated = updateEntry(owner, e.id, {
    expectedVersion: 1,
    title: "新的思考",
    manual: true,
  });
  assert.equal(updated.version, 2);
  assert.throws(
    () => updateEntry(owner, e.id, { expectedVersion: 1, title: "旧内容" }),
    /其他页面/,
  );
  assert.equal(getEntry(owner, e.id).title, "新的思考");
  assert.equal(
    one("SELECT count(*) n FROM revisions WHERE entry_id=?", e.id)!.n,
    1,
  );
});
test("跨账号读取、写入和删除均被拒绝", () => {
  const e = createEntry(owner, input());
  for (const fn of [
    () => getEntry(other, e.id),
    () => updateEntry(other, e.id, { expectedVersion: 1, title: "盗写" }),
    () => trashEntry(other, e.id),
  ])
    assert.throws(fn, /不存在/);
  assert.equal(entries(other, new URLSearchParams()).total, 0);
});
test("知识点与附件归属必须匹配", () => {
  const k = randomUUID(),
    a = randomUUID();
  run(
    "INSERT INTO knowledge VALUES(?,?,?,?,?,?,0)",
    k,
    other,
    "高等数学",
    null,
    "极限",
    "",
  );
  run(
    "INSERT INTO attachments VALUES(?,?,?,?,?,?,?)",
    a,
    other,
    "x.png",
    "image/png",
    1,
    "hash",
    new Date().toISOString(),
  );
  assert.throws(() => createEntry(owner, { ...input(), knowledgeIds: [k] }));
  assert.throws(() =>
    createEntry(owner, {
      ...input(),
      attachments: [{ id: a, role: "PROMPT" }],
    }),
  );
});
test("搜索覆盖分析内容，条件组合为 AND", () => {
  const e = createEntry(owner, {
    ...input(),
    title: "特征搜索",
    details: { takeaway_md: "洛必达专用词" },
    errors: ["条件"],
    tags: ["专题"],
  });
  assert.equal(
    entries(
      owner,
      new URLSearchParams("q=洛必达专用词&type=MATH&error=条件&tag=专题"),
    ).items[0].id,
    e.id,
  );
  assert.equal(
    entries(owner, new URLSearchParams("q=洛必达专用词&type=CS")).total,
    0,
  );
});
test("调度阶梯和成功次数遵循设计", () => {
  assert.equal(
    schedule({ stage_index: -1, success_streak: 0 }, "GOOD", "2026-10-21")
      .due_on,
    "2026-10-22",
  );
  assert.equal(
    schedule({ stage_index: -1, success_streak: 0 }, "EASY", "2026-10-21")
      .due_on,
    "2026-10-24",
  );
  assert.equal(
    schedule({ stage_index: 4, success_streak: 7 }, "AGAIN", "2026-10-21")
      .success_streak,
    0,
  );
  assert.equal(
    schedule({ stage_index: 3, success_streak: 3 }, "HARD", "2026-10-21")
      .due_on,
    "2026-10-28",
  );
  assert.equal(
    schedule({ stage_index: 2, success_streak: 2 }, "GOOD", "2026-10-21").stage,
    "MAINTENANCE",
  );
});
test("跨午夜、闰年与夏令时按用户日历计算", () => {
  assert.equal(
    localDate("Asia/Shanghai", new Date("2026-10-21T16:05:00Z")),
    "2026-10-22",
  );
  assert.equal(
    localDate("America/New_York", new Date("2026-03-08T06:30:00Z")),
    "2026-03-08",
  );
  assert.equal(
    schedule({ stage_index: -1, success_streak: 0 }, "GOOD", "2028-02-28")
      .due_on,
    "2028-02-29",
  );
});
test("幂等重放不会重复历史或调度，异内容请求冲突", () => {
  const e = createEntry(owner, input()),
    r = addReview(owner, e.id);
  const b = {
    expectedVersion: 1,
    mode: "SCHEDULED",
    rating: "GOOD",
    hintUsed: false,
    answerMd: "答案",
  };
  const a = attempt(owner, r.id, b, "stable-key");
  assert.deepEqual(attempt(owner, r.id, b, "stable-key"), a);
  assert.equal(
    one("SELECT count(*) n FROM logs WHERE review_id=?", r.id)!.n,
    1,
  );
  assert.throws(
    () => attempt(owner, r.id, { ...b, rating: "HARD" }, "stable-key"),
    /标识/,
  );
});
test("同一天只接受一次计划调度", () => {
  const e = createEntry(owner, input()),
    r = addReview(owner, e.id);
  attempt(
    owner,
    r.id,
    {
      expectedVersion: 1,
      mode: "SCHEDULED",
      rating: "GOOD",
      hintUsed: false,
      answerMd: "",
    },
    "first",
  );
  run(
    "UPDATE reviews SET due_on=? WHERE id=?",
    localDate(defaults.timezone),
    r.id,
  );
  assert.throws(
    () =>
      attempt(
        owner,
        r.id,
        {
          expectedVersion: 2,
          mode: "SCHEDULED",
          rating: "GOOD",
          hintUsed: false,
          answerMd: "",
        },
        "second",
      ),
    /今天已/,
  );
});
test("主动练习保存历史但不修改计划", () => {
  const e = createEntry(owner, input()),
    r = addReview(owner, e.id);
  attempt(
    owner,
    r.id,
    {
      expectedVersion: 1,
      mode: "PRACTICE",
      rating: "GOOD",
      hintUsed: false,
      answerMd: "练习",
    },
    randomUUID(),
  );
  assert.deepEqual(one("SELECT * FROM reviews WHERE id=?", r.id), r);
});
test("提示后不得评价熟练；旧调度版本拒绝写入", () => {
  const e = createEntry(owner, input()),
    r = addReview(owner, e.id);
  assert.throws(
    () =>
      attempt(
        owner,
        r.id,
        {
          expectedVersion: 1,
          mode: "SCHEDULED",
          rating: "EASY",
          hintUsed: true,
          answerMd: "",
        },
        randomUUID(),
      ),
    /提示/,
  );
  assert.throws(
    () =>
      attempt(
        owner,
        r.id,
        {
          expectedVersion: 9,
          mode: "SCHEDULED",
          rating: "GOOD",
          hintUsed: false,
          answerMd: "",
        },
        randomUUID(),
      ),
    /更新/,
  );
  assert.equal(
    one("SELECT count(*) n FROM logs WHERE review_id=?", r.id)!.n,
    0,
  );
});

test("复习答案 50k 边界接受，超限失败后原键可修正重试且只写一次", () => {
  const e = createEntry(owner, input()),
    r = addReview(owner, e.id);
  const body = {
    expectedVersion: 1,
    mode: "PRACTICE",
    rating: "GOOD",
    hintUsed: false,
    answerMd: "x".repeat(50001),
  };
  assert.throws(() => attempt(owner, r.id, body, "length-boundary"));
  assert.equal(
    one("SELECT count(*) n FROM logs WHERE review_id=?", r.id)!.n,
    0,
  );
  const accepted = { ...body, answerMd: body.answerMd.slice(0, 50000) };
  const result = attempt(owner, r.id, accepted, "length-boundary");
  assert.deepEqual(attempt(owner, r.id, accepted, "length-boundary"), result);
  assert.equal(
    one("SELECT count(*) n FROM logs WHERE review_id=?", r.id)!.n,
    1,
  );
});
test("软删除隐藏搜索与队列，恢复后计划暂停且保留历史", () => {
  const e = createEntry(owner, input()),
    r = addReview(owner, e.id);
  attempt(
    owner,
    r.id,
    {
      expectedVersion: 1,
      mode: "PRACTICE",
      rating: "HARD",
      hintUsed: false,
      answerMd: "test",
    },
    randomUUID(),
  );
  trashEntry(owner, e.id);
  assert.throws(() => getEntry(owner, e.id));
  assert(!reviewQueue(owner).items.some((x) => x.entry.id === e.id));
  trashEntry(owner, e.id, true);
  assert.equal(getEntry(owner, e.id).id, e.id);
  assert.equal(
    one("SELECT stage FROM reviews WHERE id=?", r.id)!.stage,
    "PAUSED",
  );
  assert.equal(
    one("SELECT count(*) n FROM logs WHERE review_id=?", r.id)!.n,
    1,
  );
});
test("完整备份包含图片、关系与历史，隔离目录恢复成功", async () => {
  const id = randomUUID(),
    bytes = await sharp({
      create: { width: 1, height: 1, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
  writeFileSync(path.join(dataDir, "attachments", id), bytes);
  run(
    "INSERT INTO attachments VALUES(?,?,?,?,?,?,?)",
    id,
    owner,
    "像素.png",
    "image/png",
    bytes.length,
    createHash("sha256").update(bytes).digest("hex"),
    new Date().toISOString(),
  );
  const e = createEntry(owner, {
      ...input(),
      attachments: [{ id, role: "PROMPT" }],
    }),
    f = createEntry(
      owner,
      input("SENTENCE", "The more we learn, the better we understand."),
    );
  run(
    "INSERT INTO relations VALUES(?,?,?,?,?)",
    randomUUID(),
    owner,
    e.id,
    f.id,
    "SUPPORTS",
  );
  const { initAudit } = awaitAuditModule;
  initAudit();
  const auditId = randomUUID();
  run(
    "INSERT INTO ai_audit VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    auditId,
    owner,
    "related",
    "test",
    "example.com",
    new Date().toISOString(),
    12,
    "success",
    100,
    JSON.stringify({ matches: [] }),
    "需复查",
  );
  run(
    "INSERT INTO ai_audit_extras VALUES(?,?,?)",
    auditId,
    owner,
    JSON.stringify({ cost: null }),
  );
  const zip = backup(owner),
    decoded = unzipSync(zip);
  assert(decoded["attachments/" + id]);
  const file = path.join(dataDir, "test.zip");
  writeFileSync(file, zip);
  const target = mkdtempSync(path.join(os.tmpdir(), "yanxi-restored-"));
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/data.ts", "restore", file],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_DIR: target,
        RESTORE_PASSWORD: "isolated-test-password",
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const { DatabaseSync } = requireSqlite();
  const restored = new DatabaseSync(path.join(target, "yanxiben.sqlite"));
  assert.equal(
    (restored.prepare("SELECT count(*) n FROM entries").get() as any).n,
    entries(owner, new URLSearchParams("limit=100")).total,
  );
  assert.equal(
    (restored.prepare("SELECT count(*) n FROM relations").get() as any).n,
    1,
  );
  assert((restored.prepare("SELECT count(*) n FROM logs").get() as any).n > 0);
  assert.equal(
    (
      restored
        .prepare("SELECT feedback FROM ai_audit WHERE id=?")
        .get(auditId) as any
    ).feedback,
    "需复查",
  );
  assert.equal(
    (
      restored
        .prepare("SELECT payload FROM ai_audit_extras WHERE id=?")
        .get(auditId) as any
    ).payload,
    JSON.stringify({ cost: null }),
  );
  assert.deepEqual(readFileSync(path.join(target, "attachments", id)), bytes);
  restored.close();
});
test("拒绝覆盖已有数据库", async () => {
  await assert.rejects(() => restore(backup(owner), "new", "hash"), /空白/);
});
test("Markdown 导出含本地附件相对路径", () => {
  const files = unzipSync(markdownExport(owner));
  assert(files["README.md"]);
  const entry = Object.keys(files).find(
    (k) => k.endsWith(".md") && strFromU8(files[k]).includes("](attachments/"),
  );
  assert(entry);
  assert(Object.keys(files).some((k) => k.startsWith("attachments/")));
});
import { createRequire } from "node:module";
const requireSqlite = () => createRequire(import.meta.url)("node:sqlite");
test("不会评价固定次日复习，不受自定义首阶间隔影响", () => {
  assert.equal(
    schedule(
      { stage_index: 4, success_streak: 4 },
      "AGAIN",
      "2026-10-21",
      [2, 4, 8, 16, 32, 64],
    ).due_on,
    "2026-10-22",
  );
});
test("无计划记录的主动练习不会自动加入到期队列", () => {
  const e = createEntry(owner, input()),
    r = addReview(owner, e.id, true);
  assert.equal(r.stage, "PAUSED");
  assert(!reviewQueue(owner).items.some((x) => x.entry.id === e.id));
  attempt(
    owner,
    r.id,
    {
      expectedVersion: 1,
      mode: "PRACTICE",
      rating: "GOOD",
      hintUsed: false,
      answerMd: "练习",
    },
    randomUUID(),
  );
  assert.equal(
    one("SELECT stage FROM reviews WHERE id=?", r.id)!.stage,
    "PAUSED",
  );
});
test("篡改摘要、不兼容版本和路径穿越包在隔离恢复时拒绝", () => {
  const original = unzipSync(backup(owner));
  for (const kind of ["hash", "version", "path"]) {
    const files = { ...original };
    if (kind === "hash") files["data.json"] = strToU8("{}");
    if (kind === "version") {
      const m = JSON.parse(strFromU8(files["manifest.json"]));
      m.schemaVersion = 999;
      files["manifest.json"] = strToU8(JSON.stringify(m));
    }
    if (kind === "path") files["../escape.txt"] = strToU8("unsafe");
    const file = path.join(dataDir, kind + ".zip");
    writeFileSync(file, zipSync(files));
    const target = mkdtempSync(path.join(os.tmpdir(), "yanxi-rejected-"));
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/data.ts", "restore", file],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATA_DIR: target,
          RESTORE_PASSWORD: "isolated-test-password",
        },
        encoding: "utf8",
      },
    );
    assert.notEqual(result.status, 0);
    const { DatabaseSync } = requireSqlite();
    const check = new DatabaseSync(path.join(target, "yanxiben.sqlite"));
    assert.equal(
      (check.prepare("SELECT count(*) n FROM users").get() as any).n,
      0,
    );
    check.close();
  }
});
