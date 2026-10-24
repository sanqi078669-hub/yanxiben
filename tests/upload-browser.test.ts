import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";

// Optional local runner: BROWSER_TEST_MODULE points to an installed Playwright entry.
// No dependency installation or browser download is performed by this test.
test("真实浏览器：上传停滞、中断、取消及离开页面不丢未保存文字", async (t) => {
  if (!process.env.BROWSER_TEST_MODULE) {
    t.skip("未配置 BROWSER_TEST_MODULE；真实浏览器上传生命周期未验证");
    return;
  }
  const { chromium } = await import(process.env.BROWSER_TEST_MODULE);
  process.env.DATA_DIR = mkdtempSync(
    path.join(os.tmpdir(), "yanxi-upload-browser-"),
  );
  const { run, dataDir } = await import("../src/lib/db");
  const { defaults } = await import("../src/lib/model");
  const owner = randomUUID(),
    password = "synthetic-browser-password";
  run(
    "INSERT INTO users VALUES(?,?,?,?)",
    owner,
    owner,
    bcrypt.hashSync(password, 4),
    JSON.stringify(defaults),
  );
  writeFileSync(
    path.join(dataDir, "session-secret"),
    randomBytes(48).toString("hex"),
  );
  const base = "http://127.0.0.1:3143";
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3143",
    ],
    {
      env: { ...process.env, CAPACITY_POLICY: "" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  server.stdout.on("data", (value) => (output += value));
  server.stderr.on("data", (value) => (output += value));
  t.after(() => server.kill());
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + "/api/v1/settings")).status === 401) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, output);
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  t.after(() => browser.close());
  for (const mode of ["timeout", "network", "cancel", "leave"]) {
    await t.test(mode, async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const held: any[] = [];
      try {
        const login = await context.request.post(base + "/api/v1/auth/login", {
          headers: { "X-Requested-With": "yanxiben", Origin: base },
          data: { username: owner, password },
        });
        assert.equal(login.status(), 200);
        // Accelerate native total-timeout firing without changing the application policy.
        await page.addInitScript(
          ({ mode }: { mode: string }) => {
            const state = window as any;
            state.uploadAborts = 0;
            const descriptor = Object.getOwnPropertyDescriptor(
              XMLHttpRequest.prototype,
              "timeout",
            )!;
            Object.defineProperty(XMLHttpRequest.prototype, "timeout", {
              get: descriptor.get,
              set(value: number) {
                state.uploadDeadline = value;
                descriptor.set!.call(this, mode === "timeout" ? 150 : value);
              },
            });
            const original = XMLHttpRequest.prototype.abort;
            XMLHttpRequest.prototype.abort = function () {
              state.uploadAborts++;
              return original.call(this);
            };
          },
          { mode },
        );
        let seen!: () => void;
        const requested = new Promise<void>((resolve) => (seen = resolve));
        await page.route("**/api/v1/attachments", async (route: any) => {
          seen();
          if (mode === "network") await route.abort("failed");
          else held.push(route);
        });
        await page.goto(base + "/entries/new");
        const text = "未保存的合成题目：上传异常后必须保留 " + mode;
        await page.locator("textarea.body-editor").fill(text);
        await page.getByText(/已暂存本浏览器草稿/).waitFor();
        await page.locator('input[type="file"]').setInputFiles({
          name: "synthetic.png",
          mimeType: "image/png",
          buffer: Buffer.from("synthetic-image"),
        });
        await requested;
        if (mode === "cancel")
          await page
            .getByRole("button", { name: "取消上传", exact: true })
            .click();
        if (mode === "leave") {
          page.on("dialog", (dialog: any) => dialog.accept());
          await page.locator('a[href="/library"]').first().click();
          await page.waitForURL("**/library");
          assert.equal(
            await page.evaluate(() => (window as any).uploadAborts),
            1,
          );
          await page.goto(base + "/entries/new");
          await page
            .getByRole("button", { name: "恢复此草稿", exact: true })
            .click();
        } else {
          await page
            .locator("#editor-error")
            .filter({
              hasText:
                mode === "timeout"
                  ? "超时"
                  : mode === "network"
                    ? "连接中断"
                    : "已取消",
            })
            .waitFor();
          assert.equal(
            await page.locator('input[type="file"]').isEnabled(),
            true,
          );
          assert.equal(
            await page
              .getByRole("button", { name: "核对后保存", exact: true })
              .isEnabled(),
            true,
          );
          assert.equal(
            await page.evaluate(() => (window as any).uploadDeadline),
            180000,
          );
          if (mode === "cancel")
            assert.equal(
              await page.evaluate(() => (window as any).uploadAborts),
              1,
            );
        }
        assert.equal(
          await page.locator("textarea.body-editor").inputValue(),
          text,
        );
        const drafts = await page.evaluate(() =>
          Object.entries(localStorage)
            .filter(([key]) => key.startsWith("yanxi-draft-v1:"))
            .map(([, value]) => JSON.parse(value).entry.body),
        );
        assert(drafts.includes(text));
      } finally {
        for (const route of held) await route.abort().catch(() => {});
        await context.close();
      }
    });
  }
});
