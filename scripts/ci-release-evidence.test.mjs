import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { transferReleaseEvidence } from "./release-verification.mjs";
import {
  validateCandidateSha,
  classifyFailure,
  main,
  npmInvocation,
} from "./ci-release-evidence.mjs";

function fixture(t) {
  const parent = realpathSync(os.tmpdir()),
    folder = mkdtempSync(path.join(parent, "yanxi-evidence-unit-"));
  t.after(() => {
    const actual = realpathSync(folder);
    assert.equal(path.dirname(actual), parent);
    assert(path.basename(actual).startsWith("yanxi-evidence-unit-"));
    rmSync(actual, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 200,
    });
  });
  return folder;
}
function json(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}
test("npm 通过 Node CLI 调用，不依赖 cmd/shell，含空格路径保持单独参数", (t) => {
  const root = fixture(t),
    executable = path.join(root, "runtime with spaces", "node");
  const cli = path.join(
    path.dirname(executable),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  mkdirSync(path.dirname(cli), { recursive: true });
  writeFileSync(cli, "// synthetic npm CLI");
  assert.deepEqual(npmInvocation(["--version"], executable, ""), {
    file: executable,
    args: [cli, "--version"],
  });
  assert.throws(
    () => npmInvocation([], path.join(root, "missing", "node"), ""),
    { code: "ENOENT" },
  );
  const installed = npmInvocation(["--version"]);
  assert.match(
    execFileSync(installed.file, installed.args, {
      encoding: "utf8",
      windowsHide: true,
    }).trim(),
    /^\d+\.\d+\.\d+$/,
  );
});
test("候选 SHA 严格为完整 commit；拒绝短哈希、无效对象、tree/blob", () => {
  const repository = process.cwd();
  const git = (args) =>
    execFileSync(
      "git",
      ["-c", `safe.directory=${repository.replaceAll("\\", "/")}`, ...args],
      { encoding: "utf8" },
    ).trim();
  const commit = git(["rev-parse", "HEAD"]);
  assert.equal(validateCandidateSha(repository, commit, false), commit);
  assert.equal(
    validateCandidateSha(repository, commit.toUpperCase(), false),
    commit,
  );
  for (const input of [
    "",
    "HEAD",
    commit.slice(0, 12),
    "x".repeat(40),
    "0".repeat(40),
    git(["rev-parse", "HEAD^{tree}"]),
    git(["rev-parse", "HEAD:package.json"]),
  ])
    assert.throws(() => validateCandidateSha(repository, input, false));
});
test("校验后将规范化 SHA 绑定到输出和后续步骤环境", async (t) => {
  const root = fixture(t),
    repository = process.cwd();
  const commit = execFileSync(
    "git",
    [
      "-c",
      `safe.directory=${repository.replaceAll("\\", "/")}`,
      "rev-parse",
      "HEAD",
    ],
    { encoding: "utf8" },
  ).trim();
  const keys = [
    "RELEASE_EVIDENCE_DIR",
    "CANDIDATE_SHA",
    "GITHUB_OUTPUT",
    "GITHUB_ENV",
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, {
    RELEASE_EVIDENCE_DIR: path.join(root, "evidence"),
    CANDIDATE_SHA: commit.toUpperCase(),
    GITHUB_OUTPUT: path.join(root, "output"),
    GITHUB_ENV: path.join(root, "env"),
  });
  await main(["init"]);
  await main(["validate", repository]);
  assert.equal(
    readFileSync(process.env.GITHUB_OUTPUT, "utf8"),
    `candidate_sha=${commit}\n`,
  );
  assert.equal(
    readFileSync(process.env.GITHUB_ENV, "utf8"),
    `CANDIDATE_SHA=${commit}\n`,
  );
});
test("命令包装器保留真实退出码、耗时和日志，非零结果使流程失败", async (t) => {
  const root = fixture(t),
    oldDirectory = process.env.RELEASE_EVIDENCE_DIR,
    oldExit = process.exitCode;
  t.after(() => {
    if (oldDirectory === undefined) delete process.env.RELEASE_EVIDENCE_DIR;
    else process.env.RELEASE_EVIDENCE_DIR = oldDirectory;
    process.exitCode = oldExit;
  });
  process.env.RELEASE_EVIDENCE_DIR = root;
  await main(["init"]);
  await main([
    "run",
    "synthetic-code",
    process.execPath,
    "-e",
    "console.error('AssertionError: synthetic check'); process.exit(2)",
  ]);
  let summary = JSON.parse(
    readFileSync(path.join(root, "release-summary.json"), "utf8"),
  );
  assert.equal(summary.commands[0].code, 2);
  assert.equal(summary.commands[0].failure_class, "code");
  assert(summary.commands[0].duration_ms >= 0);
  assert.equal(summary.overall_status, "failed");
  assert.equal(process.exitCode, 1);
  assert.match(
    readFileSync(path.join(root, "synthetic-code.log"), "utf8"),
    /synthetic check/,
  );
  await main([
    "run",
    "synthetic-environment",
    process.execPath,
    "-e",
    "console.error('npm ENOTCACHED'); process.exit(1)",
  ]);
  summary = JSON.parse(
    readFileSync(path.join(root, "release-summary.json"), "utf8"),
  );
  assert.equal(summary.commands[1].failure_class, "environment");
});
test("证据在源目录清理后仍保留，转存路径与摘要准确，只复制允许的 JSON", (t) => {
  const root = fixture(t),
    workspace = path.join(root, "workspace"),
    destination = path.join(root, "evidence");
  json(
    path.join(workspace, "test-results/production-restore-acceptance.json"),
    { status: "synthetic" },
  );
  json(path.join(workspace, "coverage/coverage-summary.json"), { total: {} });
  json(path.join(workspace, "test-results/private-data.json"), {
    private: true,
  });
  const transferred = transferReleaseEvidence(workspace, destination, true);
  assert.equal(transferred.length, 2);
  assert(
    transferred.every(
      (item) =>
        item.source.startsWith(workspace) &&
        item.target.startsWith(destination) &&
        item.status === "copied",
    ),
  );
  rmSync(workspace, { recursive: true });
  for (const item of transferred)
    assert.equal(
      createHash("sha256").update(readFileSync(item.target)).digest("hex"),
      item.sha256,
    );
  assert.throws(() =>
    readFileSync(path.join(destination, "private-data.json")),
  );
});
test("必需证据缺失、JSON 损坏、目标不可写均抛 evidence；先前失败未产出有明确记录", (t) => {
  const root = fixture(t),
    workspace = path.join(root, "workspace");
  assert.throws(
    () => transferReleaseEvidence(workspace, path.join(root, "missing"), true),
    { failure_class: "evidence" },
  );
  assert(
    transferReleaseEvidence(
      workspace,
      path.join(root, "not-produced"),
      false,
    ).every((item) => item.status === "not-produced"),
  );
  json(
    path.join(workspace, "test-results/production-restore-acceptance.json"),
    {},
  );
  mkdirSync(path.join(workspace, "coverage"));
  writeFileSync(path.join(workspace, "coverage/coverage-summary.json"), "{");
  assert.throws(
    () => transferReleaseEvidence(workspace, path.join(root, "invalid"), true),
    { failure_class: "evidence" },
  );
  json(path.join(workspace, "coverage/coverage-summary.json"), {});
  const blocked = path.join(root, "blocked");
  mkdirSync(path.join(blocked, "production-restore-acceptance.json"), {
    recursive: true,
  });
  assert.throws(() => transferReleaseEvidence(workspace, blocked, true), {
    failure_class: "evidence",
  });
});
test("失败分类依据日志标记或已知超时，普通断言不会被降为环境告警", () => {
  assert.equal(classifyFailure("npm ENOTCACHED"), "environment");
  assert.equal(classifyFailure("listen EADDRINUSE"), "environment");
  assert.equal(classifyFailure("", true), "environment");
  assert.equal(
    classifyFailure("AssertionError: expected 1 to equal 2"),
    "code",
  );
});
test("汇总核对候选/锁摘要与证据完整性，缺失或篡改不能通过；浏览器显式 skipped/manual", async (t) => {
  const root = fixture(t),
    workspace = path.join(root, "workspace"),
    destination = path.join(root, "evidence");
  const previousEnv = {
    RELEASE_EVIDENCE_DIR: process.env.RELEASE_EVIDENCE_DIR,
    CANDIDATE_SHA: process.env.CANDIDATE_SHA,
    RELEASE_STEP_OUTCOMES: process.env.RELEASE_STEP_OUTCOMES,
  };
  const previousExit = process.exitCode;
  t.after(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.exitCode = previousExit;
  });
  process.env.RELEASE_EVIDENCE_DIR = destination;
  process.env.CANDIDATE_SHA = "a".repeat(40);
  process.env.RELEASE_STEP_OUTCOMES = JSON.stringify({ clean: "success" });
  await main(["init"]);
  const summaryFile = path.join(destination, "release-summary.json");
  const summary = JSON.parse(readFileSync(summaryFile, "utf8"));
  summary.lockfile_sha256 = "synthetic-lock-digest";
  json(summaryFile, summary);
  json(
    path.join(workspace, "test-results/production-restore-acceptance.json"),
    {
      candidateCommit: process.env.CANDIDATE_SHA,
      lockfileSha256: summary.lockfile_sha256,
    },
  );
  json(path.join(workspace, "coverage/coverage-summary.json"), { total: {} });
  const transfers = transferReleaseEvidence(workspace, destination, true);
  json(path.join(destination, "clean-install-acceptance.json"), {
    status: "passed",
    commit: process.env.CANDIDATE_SHA,
    lockfileSha256: summary.lockfile_sha256,
    transfers,
  });
  await main(["finalize"]);
  let result = JSON.parse(readFileSync(summaryFile, "utf8"));
  assert.equal(result.overall_status, "passed");
  assert.equal(result.browser.status, "skipped/manual");
  writeFileSync(transfers[1].target, "{}");
  await main(["finalize"]);
  result = JSON.parse(readFileSync(summaryFile, "utf8"));
  assert.equal(result.overall_status, "failed");
  assert.equal(result.failure_class, "evidence");
  assert.equal(process.exitCode, 1);
});
