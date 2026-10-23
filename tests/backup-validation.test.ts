import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import sharp from "sharp";
process.env.DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-backup-boundary-"),
);
const { one, dataDir } = await import("../src/lib/db");
const { restore } = await import("../src/modules/data-management/backup");
const { defaults, entrySchema } = await import("../src/lib/model");
const { backupRowSchemas } =
  await import("../src/modules/data-management/backup-validation");
const owner = randomUUID(),
  entryId = randomUUID(),
  attachmentId = randomUUID(),
  reviewId = randomUUID(),
  logId = randomUUID();
const now = new Date().toISOString(),
  day = now.slice(0, 10);
const image = await sharp({
  create: { width: 2, height: 2, channels: 3, background: "blue" },
})
  .png()
  .toBuffer();
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const payload = entrySchema.parse({
  type: "MATH",
  title: "合法测试",
  subject: "高等数学",
  body: "极限",
  attachments: [{ id: attachmentId, role: "PROMPT" }],
});
const meta = {
  id: entryId,
  owner,
  version: 1,
  created_at: now,
  updated_at: now,
  deleted_at: null,
};
const r = {
  id: reviewId,
  owner,
  entry_id: entryId,
  stage: "NEW",
  stage_index: -1,
  success_streak: 0,
  due_on: day,
  version: 1,
};
function fixture(): Record<string, any> {
  const data: Record<string, any> = Object.fromEntries(
    Object.keys(backupRowSchemas).map((t) => [t, []]),
  );
  data.profile = { id: owner, settings: defaults };
  data.entries = [
    {
      ...meta,
      type: payload.type,
      title: payload.title,
      subject: payload.subject,
      body: payload.body,
      status: payload.status,
      payload: JSON.stringify(payload),
    },
  ];
  data.attachments = [
    {
      id: attachmentId,
      owner,
      name: "test.png",
      mime: "image/png",
      size: image.length,
      sha256: hash(image),
      created_at: now,
    },
  ];
  data.reviews = [structuredClone(r)];
  data.entry_hint_usage = [
    { owner, entry_id: entryId, review_version: 1, used_at: now },
  ];
  data.logs = [
    {
      id: logId,
      owner,
      review_id: reviewId,
      mode: "PRACTICE",
      rating: "GOOD",
      local_date: day,
      payload: JSON.stringify({
        expectedVersion: 1,
        mode: "PRACTICE",
        rating: "GOOD",
        hintUsed: false,
        answerMd: "answer",
        before: r,
        after: r,
        algorithmVersion: "calendar-v1",
      }),
      created_at: now,
    },
  ];
  data.revisions = [
    {
      id: randomUUID(),
      owner,
      entry_id: entryId,
      version: 1,
      snapshot: JSON.stringify({ ...payload, ...meta }),
      reason: "MANUAL",
      created_at: now,
    },
  ];
  data.idempotency = [
    {
      owner,
      scope: reviewId,
      key: "test-key",
      hash: "a".repeat(64),
      response: JSON.stringify({
        attemptId: logId,
        reviewLocalDate: day,
        nextDueOn: day,
        newVersion: 1,
        algorithmVersion: "calendar-v1",
      }),
      created_at: now,
    },
  ];
  return data;
}
function archive(data: Record<string, any>, bytes: Uint8Array = image) {
  const files = {
    "data.json": strToU8(JSON.stringify(data)),
    [`attachments/${attachmentId}`]: bytes,
  };
  return zipSync({
    ...files,
    "manifest.json": strToU8(
      JSON.stringify({
        schemaVersion: 1,
        counts: Object.fromEntries(
          Object.keys(backupRowSchemas).map((t) => [t, data[t].length]),
        ),
        files: Object.entries(files).map(([name, b]) => ({
          name,
          size: b.length,
          sha256: hash(b),
        })),
      }),
    ),
  });
}

test("恢复拒绝摘要正确但结构非法的数据，数据库与附件目录保持空白", async (t) => {
  const changes: [string, (d: Record<string, any>) => void][] = [
    ["日志坏 JSON", (d) => (d.logs[0].payload = "{")],
    ["日志空结构", (d) => (d.logs[0].payload = "{}")],
    ["快照结构", (d) => (d.revisions[0].snapshot = "[]")],
    ["幂等响应", (d) => (d.idempotency[0].response = "{}")],
    ["阶段枚举", (d) => (d.reviews[0].stage = "EVIL")],
    ["越界索引", (d) => (d.reviews[0].stage_index = 6)],
    ["不一致阶段", (d) => (d.reviews[0].stage = "MAINTENANCE")],
    ["不存在复习引用", (d) => (d.logs[0].review_id = randomUUID())],
    [
      "跨归属快照",
      (d) => {
        const p = JSON.parse(d.revisions[0].snapshot);
        p.owner = randomUUID();
        d.revisions[0].snapshot = JSON.stringify(p);
      },
    ],
    [
      "不存在附件",
      (d) => {
        const p = JSON.parse(d.entries[0].payload);
        p.attachments[0].id = randomUUID();
        d.entries[0].payload = JSON.stringify(p);
      },
    ],
    [
      "非法选项",
      (d) => {
        const p = JSON.parse(d.entries[0].payload);
        p.type = "CS";
        p.subject = "数据结构";
        p.details.options_json = "{}";
        d.entries[0].type = "CS";
        d.entries[0].subject = "数据结构";
        d.entries[0].payload = JSON.stringify(p);
      },
    ],
    [
      "未知关系",
      (d) =>
        d.relations.push({
          id: randomUUID(),
          owner,
          from_id: entryId,
          to_id: randomUUID(),
          type: "EVIL",
        }),
    ],
    ["HTML MIME", (d) => (d.attachments[0].mime = "text/html")],
    ["SVG MIME", (d) => (d.attachments[0].mime = "image/svg+xml")],
    ["重复主键", (d) => d.entries.push(d.entries[0])],
    ["跨归属行", (d) => (d.entries[0].owner = randomUUID())],
    [
      "合并日志缺失内部结构",
      (d) =>
        d.knowledge_merges.push({
          id: randomUUID(),
          owner,
          undone: 0,
          payload: JSON.stringify({
            before: {},
            after: {},
            aliasId: randomUUID(),
          }),
        }),
    ],
  ];
  for (const [name, mutate] of changes)
    await t.test(name, async () => {
      const data = fixture();
      mutate(data);
      await assert.rejects(() => restore(archive(data), "restored", "hash"), {
        code: "INVALID_BACKUP",
      });
      assert.equal(one("SELECT count(*) n FROM users")!.n, 0);
      assert.deepEqual(readdirSync(path.join(dataDir, "attachments")), []);
    });
  await t.test("伪装 PNG 内容", async () => {
    const bytes = strToU8("<html><script>alert(1)</script></html>"),
      data = fixture();
    data.attachments[0].size = bytes.length;
    data.attachments[0].sha256 = hash(bytes);
    await assert.rejects(
      () => restore(archive(data, bytes), "restored", "hash"),
      { code: "INVALID_BACKUP" },
    );
  });
});

test("文件写入失败会回滚数据库且不覆盖已有文件", async () => {
  const filename = path.join(dataDir, "attachments", attachmentId);
  writeFileSync(filename, "existing");
  await assert.rejects(() => restore(archive(fixture()), "restored", "hash"), {
    code: "EEXIST",
  });
  assert.equal(one("SELECT count(*) n FROM users")!.n, 0);
  unlinkSync(filename);
});

test("合法备份恢复 JSON、复习与真实图片", async () => {
  const result = await restore(archive(fixture()), "restored", "hash");
  assert.equal(result.owner, owner);
  assert.equal(one("SELECT count(*) n FROM users")!.n, 1);
  assert.equal(one("SELECT count(*) n FROM logs")!.n, 1);
  assert.equal(one("SELECT mime FROM attachments")!.mime, "image/png");
  assert.equal(
    one("SELECT review_version FROM entry_hint_usage")!.review_version,
    1,
  );
});
