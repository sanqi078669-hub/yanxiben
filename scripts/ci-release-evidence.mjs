import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function npmInvocation(
  args,
  executable = process.execPath,
  npmExecPath = process.env.npm_execpath,
) {
  const base = path.dirname(executable);
  const cli = [
    npmExecPath,
    path.join(base, "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(base, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].find((file) => file && existsSync(file));
  if (!cli) {
    const error = new Error("npm CLI not found beside the Node runtime");
    error.code = "ENOENT";
    throw error;
  }
  return { file: executable, args: [cli, ...args] };
}

export function classifyFailure(output, timedOut = false) {
  if (
    timedOut ||
    /ENOTCACHED|EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EADDRINUSE|ENOSPC|ENOMEM|EACCES|EPERM|ENOENT|ENETUNREACH|out of memory|could not resolve host|failed to connect|certificate has expired|unable to get local issuer/i.test(
      output,
    )
  )
    return "environment";
  return "code";
}
export function validateCandidateSha(
  repository,
  requested,
  fetchMissing = true,
) {
  assert(
    /^[0-9a-f]{40}$/i.test(requested || ""),
    "candidate_sha must be a full 40-character hexadecimal SHA",
  );
  requested = requested.toLowerCase();
  const git = (args) =>
    execFileSync(
      "git",
      [
        "-c",
        `safe.directory=${path.resolve(repository).replaceAll("\\", "/")}`,
        ...args,
      ],
      {
        cwd: repository,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  try {
    git(["cat-file", "-t", requested]);
  } catch {
    assert(fetchMissing, "candidate SHA does not exist locally");
    git(["fetch", "--no-tags", "--depth=1", "origin", requested]);
  }
  assert.equal(
    git(["cat-file", "-t", requested]),
    "commit",
    "candidate_sha must name a commit, not a tree/tag/blob",
  );
  return requested.toLowerCase();
}
function directory() {
  assert(process.env.RELEASE_EVIDENCE_DIR, "RELEASE_EVIDENCE_DIR is required");
  mkdirSync(process.env.RELEASE_EVIDENCE_DIR, { recursive: true });
  return process.env.RELEASE_EVIDENCE_DIR;
}
function save(report) {
  writeFileSync(
    path.join(directory(), "release-summary.json"),
    JSON.stringify(report, null, 2),
  );
}
function load() {
  return JSON.parse(
    readFileSync(path.join(directory(), "release-summary.json"), "utf8"),
  );
}
export async function main([operation, ...args]) {
  if (operation === "init") {
    save({
      candidate_sha: process.env.CANDIDATE_SHA,
      event_sha: process.env.GITHUB_SHA,
      workflow_sha: process.env.RELEASE_WORKFLOW_SHA,
      workflow_ref: process.env.RELEASE_WORKFLOW_REF,
      run_id: process.env.GITHUB_RUN_ID,
      run_attempt: process.env.GITHUB_RUN_ATTEMPT,
      runner: {
        os: process.env.RUNNER_OS || "unavailable",
        image: process.env.ImageOS || "unavailable",
        image_version: process.env.ImageVersion || "unavailable",
      },
      commands: [],
      overall_status: "pending",
      failure_class: null,
      browser: {
        status: "skipped/manual",
        failure_class: "skipped",
        reason: "人工检查；CI 不执行真实浏览器上传验收",
      },
    });
    return;
  }
  const report = load();
  if (operation === "validate") {
    try {
      report.candidate_sha = validateCandidateSha(
        args[0],
        process.env.CANDIDATE_SHA,
      );
      if (process.env.GITHUB_OUTPUT)
        writeFileSync(
          process.env.GITHUB_OUTPUT,
          `candidate_sha=${report.candidate_sha}\n`,
          { flag: "a" },
        );
      if (process.env.GITHUB_ENV)
        writeFileSync(
          process.env.GITHUB_ENV,
          `CANDIDATE_SHA=${report.candidate_sha}\n`,
          { flag: "a" },
        );
    } catch (error) {
      report.overall_status = "failed";
      report.failure_class = classifyFailure(
        String(error.stderr || error.message),
      );
      save(report);
      throw error;
    }
  } else if (operation === "runtime") {
    report.node = process.version;
    const npm = npmInvocation(["--version"]);
    report.npm = execFileSync(npm.file, npm.args, {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    report.lockfile_sha256 = createHash("sha256")
      .update(readFileSync("package-lock.json"))
      .digest("hex");
    save(report);
    const checkedOut = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    assert.equal(
      checkedOut,
      report.candidate_sha,
      "checkout differs from candidate SHA",
    );
    if (report.node !== "v24.19.0" || report.npm !== "11.17.0") {
      report.failure_class = "environment";
      save(report);
    }
    assert.equal(report.node, "v24.19.0");
    assert.equal(report.npm, "11.17.0");
  } else if (operation === "run") {
    const [label, command, ...commandArgs] = args;
    const started = Date.now();
    let output = "",
      spawnError;
    const invocation =
      command === "npm"
        ? npmInvocation(commandArgs)
        : {
            file: command === "node" ? process.execPath : command,
            args: commandArgs,
          };
    const child = spawn(invocation.file, invocation.args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        const value = chunk.toString();
        output += value;
        process.stdout.write(value);
      });
    child.once("error", (error) => {
      spawnError = error.code || error.message;
    });
    const code = await new Promise((resolve) => child.once("close", resolve));
    writeFileSync(path.join(directory(), `${label}.log`), output);
    let clean;
    if (label === "clean") {
      const file = path.join(directory(), "clean-install-acceptance.json");
      if (existsSync(file)) {
        try {
          clean = JSON.parse(readFileSync(file, "utf8"));
        } catch {
          clean = { failure_class: "evidence" };
        }
      }
    }
    const timedOut = clean?.results?.some((result) => result.timedOut) || false;
    const failureClass =
      code === 0
        ? null
        : clean?.failure_class ||
          classifyFailure(output + (spawnError || ""), timedOut);
    report.commands.push({
      label,
      command: [command, ...commandArgs],
      code,
      duration_ms: Date.now() - started,
      timed_out: timedOut,
      spawn_error: spawnError || null,
      failure_class: failureClass,
    });
    if (code !== 0) {
      report.overall_status = "failed";
      report.failure_class = failureClass;
    }
    save(report);
    if (code !== 0) process.exitCode = 1;
    return;
  } else if (operation === "finalize") {
    report.step_outcomes = JSON.parse(
      process.env.RELEASE_STEP_OUTCOMES || "{}",
    );
    report.overall_status = Object.values(report.step_outcomes).some(
      (value) => value === "failure" || value === "cancelled",
    )
      ? "failed"
      : "passed";
    if (report.step_outcomes.clean !== "success") {
      report.overall_status = "failed";
      report.failure_class ||=
        report.step_outcomes.clean === "skipped" ? "skipped" : "environment";
    }
    if (report.overall_status === "failed" && !report.failure_class)
      report.failure_class = "environment";
    if (report.overall_status === "passed") {
      try {
        const clean = JSON.parse(
          readFileSync(
            path.join(directory(), "clean-install-acceptance.json"),
            "utf8",
          ),
        );
        const production = JSON.parse(
          readFileSync(
            path.join(directory(), "production-restore-acceptance.json"),
            "utf8",
          ),
        );
        JSON.parse(
          readFileSync(path.join(directory(), "coverage-summary.json"), "utf8"),
        );
        assert.equal(clean.status, "passed");
        assert.equal(clean.commit, report.candidate_sha);
        assert.equal(production.candidateCommit, report.candidate_sha);
        assert.equal(clean.lockfileSha256, report.lockfile_sha256);
        assert.equal(production.lockfileSha256, report.lockfile_sha256);
        for (const item of clean.transfers) {
          assert.equal(item.status, "copied");
          assert.equal(
            createHash("sha256")
              .update(readFileSync(item.target))
              .digest("hex"),
            item.sha256,
          );
        }
      } catch (error) {
        report.overall_status = "failed";
        report.failure_class = "evidence";
        report.evidence_error = error.message;
      }
    }
    report.finished_at = new Date().toISOString();
    report.evidence_inventory = [
      "clean-install-acceptance.json",
      "production-restore-acceptance.json",
      "coverage-summary.json",
    ].map((name) => {
      const file = path.join(directory(), name);
      return {
        file,
        status: existsSync(file) ? "present" : "not-produced",
        sha256: existsSync(file)
          ? createHash("sha256").update(readFileSync(file)).digest("hex")
          : null,
      };
    });
    save(report);
    if (report.overall_status !== "passed") process.exitCode = 1;
    return;
  } else throw new Error("Unknown evidence operation");
  save(report);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    try {
      const report = load();
      report.overall_status = "failed";
      report.failure_class ||= classifyFailure(
        String(error.stderr || error.message),
      );
      report.error = error.message;
      save(report);
    } catch {
      /* Preserve the original failure even when the evidence destination is unavailable. */
    }
    console.error(error);
    process.exitCode = 1;
  }
