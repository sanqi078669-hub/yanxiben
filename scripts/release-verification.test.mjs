import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  resolveCandidateCommit,
  verifyAdminCli,
} from "./release-verification.mjs";

test("候选提交必须显式指定哈希，不能默认 HEAD、分支或混入参数", () => {
  for (const args of [
    [],
    ["--commit", "HEAD"],
    ["--commit", "main"],
    ["--commit", "--help"],
    ["--commit", "abcdef0", "extra"],
  ])
    assert.throws(
      () => resolveCandidateCommit(process.cwd(), args),
      /显式指定候选提交/,
    );
  const head = execFileSync(
    "git",
    [
      "-c",
      `safe.directory=${process.cwd().replaceAll("\\", "/")}`,
      "rev-parse",
      "HEAD",
    ],
    {
      encoding: "utf8",
    },
  ).trim();
  assert.equal(resolveCandidateCommit(process.cwd(), ["--commit", head]), head);
  assert.equal(
    resolveCandidateCommit(process.cwd(), ["--commit", head.slice(0, 12)]),
    head,
  );
  assert.throws(() =>
    resolveCandidateCommit(process.cwd(), ["--commit", "0".repeat(40)]),
  );
});

test("当前依赖环境下，实际初始化/账号 CLI 和实例快照/校验可运行（不代表生产安装验收）", async () => {
  const tempRoot = realpathSync(os.tmpdir());
  const folder = mkdtempSync(path.join(tempRoot, "yanxi-cli-preparation-"));
  try {
    const result = await verifyAdminCli({
      dataDirectory: path.join(folder, "data"),
      snapshotDirectory: path.join(folder, "snapshot"),
      command: async (args, options) =>
        execFileSync(process.execPath, args, {
          ...options,
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 30000,
          windowsHide: true,
        }),
    });
    assert.deepEqual(result, {
      accountCli: "passed",
      instanceSnapshot: "passed",
      instanceVerify: "passed",
    });
  } finally {
    const actual = realpathSync(folder);
    assert.equal(path.dirname(actual), tempRoot);
    assert(path.basename(actual).startsWith("yanxi-cli-preparation-"));
    rmSync(actual, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 200,
    });
  }
});
