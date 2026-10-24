import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import {
  resolveCandidateCommit,
  transferReleaseEvidence,
} from "./release-verification.mjs";
import { classifyFailure } from "./ci-release-evidence.mjs";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";

const source = process.cwd();
const npmCli = process.env.npm_execpath;
assert(npmCli, "请通过 npm run test:clean 执行");
const gitArgs = ["-c", `safe.directory=${source.replaceAll("\\", "/")}`];
const commit = resolveCandidateCommit(source, process.argv.slice(2));
const tempRoot = realpathSync(os.tmpdir());
const folder = mkdtempSync(path.join(tempRoot, "yanxi-clean-install-"));
const workspace = path.join(folder, "workspace");
mkdirSync(workspace);
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
for (const name of Object.keys(env)) {
  if (
    /^(AI_|SESSION_|RESTORE_|INIT_)/.test(name) ||
    name === "DATA_DIR" ||
    name === "SECURE_COOKIES"
  )
    delete env[name];
}
env.DATA_DIR = path.join(folder, "private-data");
env.INIT_USERNAME = "clean-qa";
env.INIT_PASSWORD = randomBytes(24).toString("hex");
env.CANDIDATE_COMMIT = commit;
const results = [];
let lockfileSha256;
let failure,
  transfers = [];
const evidenceDirectory =
  process.env.RELEASE_EVIDENCE_DIR || path.join(source, "test-results");
async function command(label, args) {
  console.log(`Checking: ${label}`);
  const started = Date.now();
  const child = spawn(process.execPath, [npmCli, ...args], {
    cwd: workspace,
    env,
    windowsHide: true,
  });
  let spawnError;
  child.once("error", (error) => {
    spawnError = error;
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      output = (output + chunk).slice(-50000);
    });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 240000);
  const code = await new Promise((resolve) => {
    child.once("close", resolve);
  }).finally(() => clearTimeout(timer));
  results.push({
    label,
    code,
    timedOut,
    durationMs: Date.now() - started,
    output,
    spawnError: spawnError?.code || null,
    failure_class:
      code === 0
        ? null
        : classifyFailure(output + (spawnError?.code || ""), timedOut),
  });
  assert(code === 0 && !timedOut, `${label} 失败：${output}`);
}
try {
  const archive = path.join(folder, "source.tar");
  execFileSync(
    "git",
    [...gitArgs, "archive", "--format=tar", `--output=${archive}`, commit],
    { cwd: source },
  );
  execFileSync("tar", ["-xf", archive, "-C", workspace]);
  lockfileSha256 = createHash("sha256")
    .update(readFileSync(path.join(workspace, "package-lock.json")))
    .digest("hex");
  await command("npm ci (fresh directory, offline cache)", [
    "ci",
    "--offline",
    "--no-audit",
    "--no-fund",
  ]);
  await command("initialization", ["run", "init"]);
  const secret = path.join(env.DATA_DIR, "session-secret");
  assert(readFileSync(secret).length >= 32);
  rmSync(secret);
  await command("existing account repairs missing session key", [
    "run",
    "init",
  ]);
  assert(readFileSync(secret).length >= 32);
  await command("lint", ["run", "lint"]);
  await command("format", ["run", "format:check"]);
  await command("types before first build", ["run", "typecheck"]);
  await command("production build", ["run", "build"]);
  await command("full tests and coverage", ["run", "test:coverage"]);
  await command("production-only install and restore lifecycle", [
    "run",
    "test:production",
  ]);
  console.log("Functional checks completed; final evidence transfer follows.");
} catch (error) {
  error.failure_class =
    results.find((result) => result.code !== 0)?.failure_class ||
    classifyFailure(error.message);
  failure = error;
  throw error;
} finally {
  let transferError;
  try {
    transfers = transferReleaseEvidence(workspace, evidenceDirectory, !failure);
  } catch (error) {
    transferError = error;
    transfers = error.transfers || [];
  }
  const report = path.join(evidenceDirectory, "clean-install-acceptance.json");
  mkdirSync(path.dirname(report), { recursive: true });
  writeFileSync(
    report,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        commit,
        lockfileSha256,
        node: process.version,
        status: failure || transferError ? "failed" : "passed",
        failure_class: transferError
          ? "evidence"
          : failure?.failure_class || null,
        transfers,
        evidenceError: transferError?.message || null,
        results,
      },
      null,
      2,
    ),
  );
  // Only the exact task-created temporary parent may be removed recursively.
  const actual = realpathSync(folder);
  assert(
    path.dirname(actual) === tempRoot &&
      path.basename(actual).startsWith("yanxi-clean-install-"),
  );
  rmSync(actual, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 200,
  });
  if (transferError) throw transferError;
  if (!failure)
    console.log(
      "PASS: clean source install, init repair, quality, build, full tests, production restore and evidence transfer.",
    );
}
