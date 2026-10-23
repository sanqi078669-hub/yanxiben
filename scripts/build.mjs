import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
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
  if (process.exitCode === 0) {
    const project = process.cwd();
    const privateFolders = [
      "data",
      "test-results",
      "backups",
      ".private-secrets",
    ].map((name) => path.resolve(project, name));
    if (process.env.DATA_DIR)
      privateFolders.push(path.resolve(process.env.DATA_DIR));
    const inside = (file, directory) => {
      const relative = path.relative(directory, file);
      return (
        !relative ||
        (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
      );
    };
    for (const entry of readdirSync(".next", {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".nft.json")) continue;
      const trace = path.join(entry.parentPath, entry.name);
      for (const file of JSON.parse(readFileSync(trace, "utf8")).files || []) {
        const resolved = path.resolve(path.dirname(trace), file),
          relative = path.relative(project, resolved).replaceAll("\\", "/");
        if (
          privateFolders.some((dir) => inside(resolved, dir)) ||
          /^data-[^/]+\//.test(relative) ||
          /(^|\/)\.env[^/]*$|\.(key|pem|sqlite[^/]*|db(?:-[^/]*)?)$/i.test(
            relative,
          ) ||
          (process.env.AI_KEY_FILE &&
            resolved === path.resolve(process.env.AI_KEY_FILE))
        )
          throw new Error(
            "Build trace contains a private runtime file; refusing this artifact",
          );
      }
    }
    console.log("Private runtime files excluded from server traces.");
  }
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
