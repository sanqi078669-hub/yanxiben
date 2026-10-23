import { one } from "../src/lib/db";
import { study } from "../src/modules/ai/service";
import { entrySchema } from "../src/lib/model";
import { getEntry } from "../src/modules/entries/service";
import { writeFileSync } from "node:fs";
if (!process.argv.includes("--live"))
  throw new Error("Explicit --live required");
const owner = one("SELECT id FROM users WHERE username=?", "student")?.id;
const action = process.argv[process.argv.indexOf("--action") + 1];
let entry = entrySchema.parse(
  action === "english"
    ? {
        type: "SENTENCE",
        subject: "英语",
        title: "合成英语例句",
        body: "Although the task was difficult, she persisted until she succeeded.",
      }
    : {
        type: "MATH",
        subject: "高等数学",
        title: "求导",
        body: "求 f(x)=x^2 的导数。",
        details: {
          original_work_md: "我的解法：直接把指数 2 减一，得到 f'(x)=x。",
          solution_md: "根据幂函数求导法则，f'(x)=2x。",
        },
      },
);
const entryId = process.argv.includes("--entry-id") ? process.argv[process.argv.indexOf("--entry-id") + 1] : undefined;
if (action === "hint") {
  if (!entryId) throw new Error("提示实测需要 --entry-id，且应指向隔离测试目录中的本人记录");
  const saved = getEntry(owner, entryId);
  entry = entrySchema.parse(Object.fromEntries(Object.keys(entrySchema.shape).map((key) => [key, saved[key as keyof typeof saved]])));
}
try {
  const result = await study(owner, {
    action,
    entry,
    ...(entryId ? { entryId } : {}),
    answer: "根据幂函数求导法则，导数是2x。",
    hintUsed: true,
    consent: true,
  });
  writeFileSync(
    `test-results/ai-${action}-live.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} catch (e) {
  console.log((e as Error).message);
  process.exitCode = 1;
}
