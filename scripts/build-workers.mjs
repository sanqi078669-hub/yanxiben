import { build } from "esbuild";
await build({
  entryPoints: ["scripts/restore-isolated.ts"],
  outfile: "runtime/restore-worker.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "node24",
});
console.log("Production restore worker compiled.");
await build({
  entryPoints: ["scripts/export-isolated.ts"],
  outfile: "runtime/export-worker.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "node24",
});
console.log("Production export worker compiled.");
await build({
  entryPoints: ["scripts/export-cleanup.ts"],
  outfile: "runtime/export-cleanup.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "node24",
});
console.log("Export cache cleanup module compiled.");
