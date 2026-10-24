import path from "node:path";
import { pruneMigrationSnapshots } from "../src/modules/data-management/snapshots";

const args = process.argv.slice(2);
const options: { keep?: number; days?: number } = {};
let apply = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--apply") apply = true;
  else if (args[i] === "--keep" || args[i] === "--days")
    options[args[i].slice(2) as "keep" | "days"] = Number(args[++i]);
  else
    throw new Error(
      "用法：npm run maintenance:snapshots -- [--keep 3] [--days 30] [--apply]；默认只预览",
    );
}
// No db.ts import: inspecting old snapshots must not migrate the live database.
const directory = path.join(
  path.resolve(process.env.DATA_DIR || "data"),
  "migration-backups",
);
console.log(
  JSON.stringify(pruneMigrationSnapshots(directory, options, apply), null, 2),
);
