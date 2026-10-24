import { readFileSync } from "node:fs";
import { z } from "zod";
import { exportArtifact } from "../src/modules/data-management/exports";
try {
  const input = z
    .object({
      owner: z.string().uuid(),
      type: z.enum(["BACKUP", "MARKDOWN"]),
      key: z.string().min(8).max(200),
      candidateId: z.string().uuid(),
    })
    .strict()
    .parse(JSON.parse(readFileSync(0, "utf8")));
  const artifact = exportArtifact(
    input.owner,
    input.type,
    input.key,
    Date.now(),
    input.candidateId,
  );
  process.stdout.write(JSON.stringify({ fileId: artifact.fileId }));
} catch (error) {
  const code = (error as { code?: string })?.code || "EXPORT_FAILED";
  if (
    ![
      "BACKUP_TOO_LARGE",
      "ATTACHMENT_TOO_LARGE",
      "IDEMPOTENCY_CONFLICT",
    ].includes(code)
  )
    console.error(
      "Export worker failed:",
      error instanceof Error ? error.stack : "unknown",
    );
  process.stdout.write(JSON.stringify({ error: { code } }));
  process.exitCode = 1;
}
