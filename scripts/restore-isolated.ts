import { readFileSync } from "node:fs";
import { restore } from "../src/modules/data-management/backup";
try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const result = await restore(
    readFileSync(input.file),
    input.username,
    input.passwordHash,
  );
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(
    JSON.stringify({ error: { message: (error as Error).message } }),
  );
  process.exitCode = 1;
}
