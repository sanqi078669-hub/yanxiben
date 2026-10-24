import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

/** Resolve an explicit commit before creating a workspace or running installation. */
export function resolveCandidateCommit(source, args) {
  assert(
    args.length === 2 &&
      args[0] === "--commit" &&
      /^[0-9a-f]{7,64}$/i.test(args[1]),
    "请显式指定候选提交：npm run test:clean -- --commit <提交哈希>；不默认使用 HEAD 或工作区",
  );
  return execFileSync(
    "git",
    [
      "-c",
      `safe.directory=${source.replaceAll("\\", "/")}`,
      "rev-parse",
      "--verify",
      `${args[1]}^{commit}`,
    ],
    { cwd: source, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

/** Exercise actual administrative entry points using only isolated synthetic data. */
export async function verifyAdminCli({
  dataDirectory,
  snapshotDirectory,
  command,
}) {
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (/^(AI_|SESSION_|RESTORE_|INIT_)/.test(name)) delete env[name];
  Object.assign(env, {
    DATA_DIR: dataDirectory,
    INIT_USERNAME: "production-cli-fixture",
    INIT_PASSWORD: randomBytes(18).toString("base64url"),
  });
  const options = { env, stdio: ["ignore", "pipe", "pipe"] };
  await command(["--import", "tsx", "scripts/init.ts"], options);
  for (const action of ["disable", "enable"])
    assert.match(
      await command(
        ["--import", "tsx", "scripts/accounts.ts", action, env.INIT_USERNAME],
        options,
      ),
      /操作完成/,
    );
  const snapshot = JSON.parse(
    await command(
      [
        "--import",
        "tsx",
        "scripts/instance.ts",
        "snapshot",
        snapshotDirectory,
        "--offline",
      ],
      options,
    ),
  );
  assert.equal(snapshot.status, "verified");
  assert.equal(snapshot.counts.users, 1);
  const verified = JSON.parse(
    await command(
      ["--import", "tsx", "scripts/instance.ts", "verify", snapshotDirectory],
      options,
    ),
  );
  assert.equal(verified.status, "verified");
  assert.deepEqual(verified.counts, snapshot.counts);
  return {
    accountCli: "passed",
    instanceSnapshot: "passed",
    instanceVerify: "passed",
  };
}
