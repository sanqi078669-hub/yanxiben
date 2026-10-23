import { complete } from "../src/modules/ai/provider";
import { one } from "../src/lib/db";
import { relatedSchema } from "../src/modules/ai/related";
import { writeFileSync } from "node:fs";
if (!process.argv.includes("--live")) throw new Error("--live required");
const owner = one("SELECT id FROM users WHERE username=?", "student")?.id;
const material = {
  entry: { body: "求x^2的导数，原解法漏乘指数。" },
  candidates: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "幂函数求导",
      body: "求x^3的导数，原解法为x^2。",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      title: "极限",
      body: "求sin(x)/x在0的极限。",
    },
  ],
};
try {
  const result = await complete(
    "比较相似错题，只引用候选id，输出 {matches:[{id,reason,difference}],warnings:[]}。",
    material,
    relatedSchema,
    [],
    fetch,
    owner,
  );
  writeFileSync(
    "test-results/ai-related-live.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} catch (e) {
  console.log((e as Error).message);
  process.exitCode = 1;
}
