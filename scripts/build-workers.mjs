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
