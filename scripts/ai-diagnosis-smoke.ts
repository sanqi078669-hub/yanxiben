import { complete } from "../src/modules/ai/provider";
import { one } from "../src/lib/db";
import { diagnosisSchema } from "../src/modules/ai/diagnosis";
import { writeFileSync } from "node:fs";
if (!process.argv.includes("--live")) throw new Error("--live required");
const owner = one("SELECT id FROM users WHERE username=?", "student")?.id;
const material = {
  scope: "合成样本，仅用于测试，不代表真实学习情况",
  sampleSize: 3,
  entries: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "幂函数求导",
      subject: "高等数学",
      attempts: 3,
      again: 1,
      hard: 1,
      good: 1,
      easy: 0,
      hints: 2,
      practice: 1,
    },
  ],
};
try {
  const result = await complete(
    "基于统计给出学习诊断，说明样本不足，不评价智力。只引用现有id。输出 {summary:string,recommendations:[{title,reason,nextStep,entryIds:string[]}],warnings:string[]}。",
    material,
    diagnosisSchema,
    [],
    fetch,
    owner,
  );
  writeFileSync(
    "test-results/ai-diagnosis-live.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} catch (e) {
  console.log((e as Error).message);
  process.exitCode = 1;
}
