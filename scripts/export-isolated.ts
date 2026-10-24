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
      reservedBytes: z.number().int().positive(),
    })
    .strict()
    .parse(JSON.parse(readFileSync(0, "utf8")));
  const artifact = exportArtifact(
    input.owner,
    input.type,
    input.key,
    Date.now(),
    input.candidateId,
    input.reservedBytes,
  );
  process.stdout.write(JSON.stringify({ fileId: artifact.fileId }));
} catch (error) {
  const code = (error as { code?: string })?.code || "EXPORT_FAILED";
  if (
    ![
      "BACKUP_TOO_LARGE",
      "ATTACHMENT_TOO_LARGE",
      "IDEMPOTENCY_CONFLICT",
      "EXPORT_CACHE_LIMIT",
      "EXPORT_DISK_LIMIT",
      "EXPORT_CONFIG_INVALID",
    ].includes(code)
  )
    console.error(
      "Export worker failed:",
      error instanceof Error ? error.stack : "unknown",
    );
  process.stdout.write(JSON.stringify({ error: { code } }));
  process.exitCode = 1;
}
