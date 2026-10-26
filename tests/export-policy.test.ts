import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import bcrypt from "bcryptjs";
import { unzipSync } from "fflate";
process.env.DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-export-policy-"),
);
const { run, dataDir, db } = await import("../src/lib/db");
const { defaults } = await import("../src/lib/model");
const { createEntry } = await import("../src/modules/entries/service");
const { accountUsage } = await import("../src/modules/data-management/quota");
test(
  "默认预算下 60/64/70/80 MiB 和七账号 HTTP 双格式导出均可解压",
  { timeout: 600000 },
  async (t) => {
    const password = randomBytes(18).toString("hex"),
      base = "http://127.0.0.1:3165";
    writeFileSync(
      path.join(dataDir, "session-secret"),
      randomBytes(48).toString("hex"),
    );
    const sizes = [60, 64, 70, 80, 80, 80, 80];
    const fixtures = sizes.map((mib, index) => {
      const owner = randomUUID(),
        username = `capacity${index}`;
      run(
        "INSERT INTO users (id, username, password, settings, role) VALUES(?,?,?,?,?)",
        owner,
        username,
        bcrypt.hashSync(password, 4),
        JSON.stringify(defaults),
        "user",
      );
      const ids: string[] = [];
      // Leave metadata headroom: account usage stays below the actual 80 MiB limit.
      let remaining = mib * 1024 ** 2 - 65536;
      while (remaining > 0) {
        const id = randomUUID(),
          bytes = randomBytes(Math.min(remaining, 10 * 1024 ** 2));
        writeFileSync(path.join(dataDir, "attachments", id), bytes);
        run(
          "INSERT INTO attachments VALUES(?,?,?,?,?,?,?)",
          id,
          owner,
          "synthetic.png",
          "image/png",
          bytes.length,
          createHash("sha256").update(bytes).digest("hex"),
          new Date().toISOString(),
        );
        ids.push(id);
        remaining -= bytes.length;
      }
      createEntry(owner, {
        type: "MATH",
        subject: "高等数学",
        title: "容量边界",
        body: "synthetic",
        attachments: ids.map((id) => ({ id, role: "PROMPT" })),
      });
      assert(accountUsage(owner).bytes <= 80 * 1024 ** 2);
      return { username, ids, mib };
    });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      EXPORT_CACHE_MIN_FREE_BYTES: "1",
    };
    for (const name of [
      "ACCOUNT_BYTES",
      "INSTANCE_BYTES",
      "ACCOUNT_FILES",
      "INSTANCE_FILES",
    ])
      delete env["EXPORT_CACHE_" + name];
    const server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3165",
      ],
      { env, windowsHide: true, stdio: "ignore" },
    );
    t.after(async () => {
      if (server.exitCode === null) {
        const closed = new Promise((resolve) => server.once("close", resolve));
        server.kill();
        await closed;
      }
      db.close();
      const target = path.resolve(dataDir);
      assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
      assert(path.basename(target).startsWith("yanxi-export-policy-"));
      rmSync(target, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    });
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try {
        if ((await fetch(base + "/api/v1/health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, "production server did not start");
    for (const fixture of fixtures) {
      const headers = {
        "Content-Type": "application/json",
        "X-Requested-With": "yanxiben",
        Origin: base,
      };
      const login = await fetch(base + "/api/v1/auth/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ username: fixture.username, password }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      for (const type of ["BACKUP", "MARKDOWN"]) {
        const response = await fetch(base + "/api/v1/exports", {
          method: "POST",
          headers: {
            ...headers,
            Cookie: cookie,
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({ type, password }),
        });
        assert.equal(response.status, 200, `${fixture.mib} MiB ${type}`);
        const bytes = new Uint8Array(await response.arrayBuffer()),
          files = unzipSync(bytes);
        assert(bytes.length > (fixture.mib - 1) * 1024 ** 2);
        assert.equal(
          Object.keys(files).filter((name) => name.startsWith("attachments/"))
            .length,
          fixture.ids.length,
        );
        t.diagnostic(
          `${fixture.username} ${fixture.mib} MiB ${type}: HTTP 200, ${bytes.length} ZIP bytes, unzip passed`,
        );
      }
    }
  },
);
