import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
const option = (name: string, fallback: number, max: number) => {
  const i = process.argv.indexOf(name);
  const n = i < 0 ? fallback : Number(process.argv[i + 1]);
  if (!Number.isSafeInteger(n) || n < 1 || n > max)
    throw Error("Invalid benchmark option: " + name);
  return n;
};
const records = option("--records", 10000, 100000),
  samples = option("--samples", 30, 100);
import { randomUUID } from "node:crypto";
const fixtureDirectory = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-benchmark-"),
);
process.env.DATA_DIR = fixtureDirectory;
const { run, transaction, db, one, all } = await import("../src/lib/db");
process.once("exit", () => {
  db.close();
  if (
    path.dirname(path.resolve(fixtureDirectory)) ===
      path.resolve(os.tmpdir()) &&
    path.basename(fixtureDirectory).startsWith("yanxi-benchmark-")
  )
    rmSync(fixtureDirectory, { recursive: true, force: true });
});
const { defaults, entrySchema } = await import("../src/lib/model");
const { entries, reviewQueue, dashboard } =
  await import("../src/modules/entries/service");
const { localDate } = await import("../src/modules/review/schedule");
const { learningStatistics } = await import("../src/modules/review/statistics");
const { baselineEntries, baselineQueue, baselineStatistics } =
  await import("./benchmark-baseline");
const owner = randomUUID(),
  day = localDate("Asia/Shanghai"),
  now = new Date().toISOString();
const start = performance.now();
transaction(() => {
  run(
    "INSERT INTO users VALUES(?,?,?,?)",
    owner,
    "benchmark",
    "hash",
    JSON.stringify(defaults),
  );
  for (let i = 0; i < records; i++) {
    const id = randomUUID(),
      review = randomUUID();
    const e = entrySchema.parse({
      type: "MATH",
      title: "极限题 " + i,
      subject: "高等数学",
      body: "比较主要项和运算结构。".repeat(25),
      details: { takeaway_md: "注意条件与边界".repeat(20) },
      tags: ["高数", "极限"],
    });
    run(
      "INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)",
      id,
      owner,
      e.type,
      e.title,
      e.subject,
      e.status,
      e.body,
      JSON.stringify(e),
      1,
      now,
      now,
    );
    run(
      "INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?)",
      review,
      owner,
      id,
      "LEARNING",
      2,
      1,
      day,
      1,
    );
    for (let j = 0; j < 10; j++)
      run(
        "INSERT INTO logs VALUES(?,?,?,?,?,?,?,?)",
        randomUUID(),
        owner,
        review,
        "PRACTICE",
        j % 2 ? "GOOD" : "HARD",
        day,
        JSON.stringify({
          answerMd: "基准测试作答",
          before: {},
          after: {},
          algorithmVersion: "calendar-v1",
        }),
        now,
      );
  }
});
const fixtureMs = performance.now() - start;
const baselineDashboard = () => {
  const active = baselineEntries(owner, new URLSearchParams("limit=100"));
  return {
    total: active.total,
    inbox: baselineEntries(owner, new URLSearchParams("status=INBOX")).total,
    queue: baselineQueue(owner),
    recent: active.items.slice(0, 5),
    studied: one(
      "SELECT count(*) n FROM logs WHERE owner=? AND local_date=?",
      owner,
      baselineQueue(owner).date,
    )!.n,
    byType: all(
      "SELECT type,count(*) n FROM entries WHERE owner=? AND deleted_at IS NULL GROUP BY type",
      owner,
    ),
  };
};
const implementations: Record<string, Record<string, () => unknown>> = {
  baseline: {
    list: () => baselineEntries(owner, new URLSearchParams()),
    search: () =>
      baselineEntries(owner, new URLSearchParams("q=条件&type=MATH&tag=高数")),
    reviewQueue: () => baselineQueue(owner),
    statistics: () => baselineStatistics(owner, { from: day, to: day }),
    dashboard: baselineDashboard,
  },
  optimized: {
    list: () => entries(owner, new URLSearchParams()),
    search: () =>
      entries(owner, new URLSearchParams("q=条件&type=MATH&tag=高数")),
    reviewQueue: () => reviewQueue(owner),
    statistics: () => learningStatistics(owner, { from: day, to: day }),
    dashboard: () => dashboard(owner),
  },
};
assert.deepEqual(
  baselineEntries(owner, new URLSearchParams()).items.map((e) => e.id),
  entries(owner, new URLSearchParams()).items.map((e) => e.id),
);
assert.deepEqual(
  baselineStatistics(owner, { from: day, to: day }),
  learningStatistics(owner, { from: day, to: day }),
);
const results: Record<string, Record<string, unknown>> = {};
for (const [implementation, cases] of Object.entries(implementations)) {
  results[implementation] = {};
  for (const [name, fn] of Object.entries(cases)) {
    const value = fn(),
      timings: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t = performance.now();
      fn();
      timings.push(performance.now() - t);
    }
    timings.sort((a, b) => a - b);
    let statements = 0;
    const original = db.prepare;
    db.prepare = ((sql: string) => {
      statements++;
      return original.call(db, sql);
    }) as typeof db.prepare;
    try {
      fn();
    } finally {
      db.prepare = original;
    }
    results[implementation][name] = {
      samples,
      p50Ms: +timings[Math.ceil(samples * 0.5) - 1].toFixed(2),
      p95Ms: +timings[Math.ceil(samples * 0.95) - 1].toFixed(2),
      maxMs: +timings.at(-1)!.toFixed(2),
      statements,
      responseBytes: Buffer.byteLength(JSON.stringify(value)),
    };
    console.log(
      implementation +
        " " +
        name +
        " " +
        JSON.stringify(results[implementation][name]),
    );
  }
}
const report = {
  timestamp: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  cpu: os.cpus()[0].model,
  records,
  history: records * 10,
  tags: records * 2,
  fixtureMs: +fixtureMs.toFixed(2),
  scope:
    "same fixture and final schema/indexes; reference algorithms f3b721e vs optimized, service-layer, single-process, warm-cache; no HTTP or images",
  results,
};
mkdirSync("test-results", { recursive: true });
writeFileSync(
  "test-results/benchmark-comparison-" + records + ".json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
