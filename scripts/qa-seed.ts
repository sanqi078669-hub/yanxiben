import { randomUUID, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
if (
  !process.env.DATA_DIR ||
  !path.resolve(process.env.DATA_DIR).includes("test-results")
)
  throw new Error("只能写入 test-results 中的隔离测试目录");
const { run, one, dataDir } = await import("../src/lib/db");
const { defaults, entrySchema } = await import("../src/lib/model");
const { createEntry, addReview } =
  await import("../src/modules/entries/service");
if (one("SELECT id FROM users LIMIT 1"))
  throw new Error("测试目录已使用，请换新目录");
const owner = randomUUID(),
  password = randomBytes(16).toString("hex");
run(
  "INSERT INTO users VALUES(?,?,?,?)",
  owner,
  "qa",
  bcrypt.hashSync(password, 4),
  JSON.stringify(defaults),
);
writeFileSync(
  path.join(dataDir, "session-secret"),
  randomBytes(48).toString("hex"),
);
for (const [type, title, body, subject] of [
  ["MATH", "自测 A：极限", "求 $\\lim_{x\\to0}\\sin x/x$", "高等数学"],
  ["CS", "自测 B：队列", "哪一种结构遵循先进先出？", "数据结构"],
  ["VOCABULARY", "自测 C：persist", "persist", "英语"],
  [
    "SENTENCE",
    "自测 D：长难句",
    "The more we learn, the better we understand.",
    "英语",
  ],
]) {
  const e = createEntry(
    owner,
    entrySchema.parse({
      type,
      title,
      body,
      subject,
      details:
        type === "MATH"
          ? { solution_md: "极限为 $1$。" }
          : type === "CS"
            ? {
                reference_answer_md: "队列",
                options_json: '["A. 栈","B. 队列"]',
              }
            : type === "VOCABULARY"
              ? { lemma: "persist", takeaway_md: "坚持；持续" }
              : { reference_translation_md: "学得越多，理解越深。" },
    }),
  );
  if (type !== "SENTENCE") addReview(owner, e.id);
}
writeFileSync(
  path.join(dataDir, "qa-login.json"),
  JSON.stringify({ username: "qa", password }),
);
console.log("已创建隔离自测账号、四类材料与三条到期复习。");
