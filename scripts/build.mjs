import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
// Next may evaluate server modules while collecting page data. Never migrate the
// user's configured database as a side effect of compiling the application.
const folder = mkdtempSync(path.join(os.tmpdir(), "yanxi-build-"));
try {
  const child = spawn(
    process.execPath,
    [
      createRequire(import.meta.url).resolve("next/dist/bin/next"),
      "build",
      ...process.argv.slice(2),
    ],
    {
      env: { ...process.env, DATA_DIR: folder },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
} finally {
  const resolved = path.resolve(folder);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith("yanxi-build-")
  )
    throw new Error("Refusing to remove unknown build directory");
  rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
