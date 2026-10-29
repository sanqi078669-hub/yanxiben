import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PasswordInput from "../src/components/PasswordInput";
import { defaults } from "../src/lib/model";

// SettingsPage 经恢复向导间接引用 CSS Module；渲染测试只忽略样式加载。
const cssModules = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".module.css")) {
      return {
        format: "module",
        source: "export default {};",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
const SettingsPage = (
  await import("../src/components/SettingsPage").finally(() =>
    cssModules.deregister(),
  )
).default;

test("密码框默认隐藏，显示按钮可访问且不会提交表单", () => {
  const html = renderToStaticMarkup(createElement(PasswordInput));
  const input = html.match(/<input\b[^>]*>/)?.[0] ?? "";
  const button = html.match(/<button\b[^>]*>/)?.[0] ?? "";
  assert.ok(input.includes('type="password"'));
  assert.ok(button.includes('type="button"'));
  assert.ok(button.includes('aria-label="显示密码"'));
  assert.ok(button.includes('aria-pressed="false"'));
  assert.ok(!button.includes('tabindex="-1"'));
  assert.ok(/<svg\b[^>]*width="16"[^>]*height="16"/.test(html));
});

test("密码框透传原生输入属性和受控值", () => {
  const value = "static-render-value";
  const html = renderToStaticMarkup(
    createElement(PasswordInput, {
      id: "confirm-password",
      name: "confirmPassword",
      value,
      onChange: () => {},
      autoComplete: "new-password",
      required: true,
      minLength: 12,
      "aria-describedby": "confirm-password-error",
    }),
  );
  const input = html.match(/<input\b[^>]*>/)?.[0] ?? "";
  for (const attribute of [
    'id="confirm-password"',
    'name="confirmPassword"',
    `value="${value}"`,
    'autoComplete="new-password"',
    'required=""',
    'minLength="12"',
    'aria-describedby="confirm-password-error"',
  ]) {
    assert.ok(input.includes(attribute), "密码框应保留传入的输入属性");
  }
});

test("登录和注册的所有密码框默认隐藏并提供独立显示按钮", () => {
  // CSS Module 由 Next 构建处理，tsx 测试不渲染这两个组件；
  // 密码框行为由上面的 PasswordInput 渲染测试覆盖。
  for (const [file, count, autoComplete] of [
    ["Login", 1, "current-password"],
    ["Register", 2, "new-password"],
  ] as const) {
    const source = readFileSync(
      new URL(`../src/components/${file}.tsx`, import.meta.url),
      "utf8",
    );
    assert.equal((source.match(/<PasswordInput\b/g) ?? []).length, count);
    assert.equal(
      (source.match(new RegExp(`autoComplete="${autoComplete}"`, "g")) ?? [])
        .length,
      count,
    );
    assert.ok(!source.includes('type="password"'));
  }
});

test("账号与安全包含确认新密码，三个密码框均使用显示按钮", () => {
  const html = renderToStaticMarkup(
    createElement(SettingsPage, {
      profile: defaults,
      onSave: () => {},
      notify: () => {},
    }),
  );
  const form = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].find(
    ([markup]) => markup.includes("<h2>账号与安全</h2>"),
  )?.[0];
  assert.ok(form, "设置页应包含账号与安全表单");
  assert.ok(form.includes("确认新密码"));
  assert.equal((form.match(/type="password"/g) ?? []).length, 3);
  assert.equal((form.match(/aria-label="显示密码"/g) ?? []).length, 3);
  assert.equal((form.match(/autoComplete="new-password"/g) ?? []).length, 2);
  assert.ok(/确认新密码[\s\S]*?<input\b[^>]*required=""/.test(form));
});
