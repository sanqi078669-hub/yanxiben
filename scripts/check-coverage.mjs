import { readFileSync } from "node:fs";
import path from "node:path";
const report = JSON.parse(
  readFileSync(process.argv[2] || "coverage/coverage-summary.json", "utf8"),
);
const minimum = { lines: 40, statements: 40, branches: 80, functions: 70 };
const criticalLines = {
  "src/lib/migrations.ts": 95,
  "src/lib/review-session.ts": 95,
  "src/lib/review-contract.ts": 95,
  "src/modules/data-management/backup-validation.ts": 90,
  "src/modules/entries/service.ts": 95,
  "src/modules/http/body.ts": 95,
  "src/modules/ai/config.ts": 95,
  "src/modules/ai/budget.ts": 95,
  "src/modules/ai/network.ts": 95,
};
const failures = [];
for (const [metric, threshold] of Object.entries(minimum)) {
  const value = report.total?.[metric]?.pct;
  if (typeof value !== "number" || value < threshold)
    failures.push(`Global ${metric}: ${value} < ${threshold}`);
}
const files = new Map(
  Object.entries(report)
    .filter(([name]) => name !== "total")
    .map(([name, value]) => [
      path.relative(process.cwd(), name).replaceAll("\\", "/"),
      value,
    ]),
);
for (const [file, threshold] of Object.entries(criticalLines)) {
  const value = files.get(file)?.lines?.pct;
  if (typeof value !== "number" || value < threshold)
    failures.push(`${file}: ${value} < ${threshold}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "Coverage baseline passed, including all source files and critical-file floors.",
  );
