import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-benchmark-"));
const { run, transaction } = await import("../src/lib/db");
const { defaults, entrySchema } = await import("../src/lib/model");
const { entries, reviewQueue } = await import("../src/modules/entries/service");
const { localDate } = await import("../src/modules/review/schedule");
const { learningStatistics } = await import("../src/modules/review/statistics");
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
  for (let i = 0; i < 10000; i++) {
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
const cases: Record<string, () => unknown> = {
  list: () => entries(owner, new URLSearchParams()),
  search: () =>
    entries(owner, new URLSearchParams("q=条件&type=MATH&tag=高数")),
  reviewQueue: () => reviewQueue(owner),
  statistics: () => learningStatistics(owner, { from: day, to: day }),
};
const results: Record<string, unknown> = {};
for (const [name, fn] of Object.entries(cases)) {
  fn();
  const timings = [];
  for (let i = 0; i < 30; i++) {
    const t = performance.now();
    fn();
    timings.push(performance.now() - t);
  }
  timings.sort((a, b) => a - b);
  results[name] = {
    samples: timings.length,
    p50Ms: +timings[14].toFixed(2),
    p95Ms: +timings[28].toFixed(2),
    maxMs: +timings[29].toFixed(2),
  };
}
const report = {
  timestamp: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  cpu: os.cpus()[0].model,
  records: 10000,
  history: 100000,
  tags: 20000,
  fixtureMs: +fixtureMs.toFixed(2),
  scope: "service-layer, single-process, warm-cache; no HTTP or images",
  results,
};
mkdirSync("test-results", { recursive: true });
writeFileSync("test-results/benchmark.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
