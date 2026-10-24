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
  console.error(
    "Restore worker failed:",
    error instanceof Error ? error.stack : "unknown",
  );
  const code = (error as { code?: string })?.code;
  process.stdout.write(
    JSON.stringify({
      error: {
        code: ["INVALID_BACKUP", "NOT_EMPTY", "BACKUP_TOO_LARGE"].includes(
          code || "",
        )
          ? code
          : "RESTORE_FAILED",
      },
    }),
  );
  process.exitCode = 1;
}
