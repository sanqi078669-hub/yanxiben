// Explicit opt-in only: sends synthetic material using the active local AI profile.
import { one } from "../src/lib/db";
import { complete, aiStatus } from "../src/modules/ai/provider";
import { extractionSchema } from "../src/modules/ai/contracts";
import { writeFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";
import { z } from "zod";
if (!process.argv.includes("--live"))
  throw new Error(
    "Use --live to authorize a real provider request with synthetic fixtures",
  );
const owner = one("SELECT id FROM users WHERE username=?", "student")?.id;
if (!owner) throw new Error("Local account unavailable");
console.log("Testing configured provider", aiStatus(owner));
const result: Record<string, unknown> = {};
try {
  result.connection = await complete(
    '返回 {"ok":true}',
    "连接测试",
    z.object({ ok: z.literal(true) }),
    [],
    fetch,
    owner,
  );
  const bytes = await sharp(
    Buffer.from(
      '<svg width="800" height="180"><rect width="100%" height="100%" fill="white"/><text x="30" y="70" font-size="34" fill="black">Mathematics: Solve 2x + 3 = 7.</text><text x="30" y="130" font-size="26" fill="black">Find x. Show your steps.</text></svg>',
    ),
  )
    .png()
    .toBuffer();
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/ai-ocr-fixture.png", bytes);
  result.extraction = await complete(
    '识别图片题目，不解答。输出 {type:"MATH",subject:"高等数学",title:string,body:string,options:[],warnings:[]}。',
    {},
    extractionSchema,
    ["data:image/png;base64," + bytes.toString("base64")],
    fetch,
    owner,
  );
  console.log(JSON.stringify(result));
} catch (e) {
  result.error = (e as Error).message;
  console.log(result.error);
  process.exitCode = 1;
}
mkdirSync("test-results", { recursive: true });
writeFileSync("test-results/ai-live.json", JSON.stringify(result, null, 2));
