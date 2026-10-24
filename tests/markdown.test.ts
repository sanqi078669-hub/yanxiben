import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MD } from "../src/components/Markdown";

test("实际 Markdown/rehype/KaTeX 组合渲染行内、块级及复杂公式", () => {
  const inline = renderToStaticMarkup(
    createElement(MD, null, "求导 $f(x)=x^2$，结果为 $2x$。"),
  );
  assert.match(inline, /class="katex"/);
  assert.match(inline, /<math/);
  assert.match(inline, /<msup>/);
  const block = renderToStaticMarkup(
    createElement(MD, null, "$$\n\\int_0^1 x^2\\,dx=\\frac{1}{3}\n$$"),
  );
  assert.match(block, /katex-display/);
  assert.match(block, /<mfrac>/);
  const matrix = renderToStaticMarkup(
    createElement(
      MD,
      null,
      "$$\n\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\\begin{cases}x^2&x>0\\\\0&x\\le0\\end{cases}\n$$",
    ),
  );
  assert.match(matrix, /<mtable(?:\s|>)/);
  assert(!matrix.includes("katex-error"));
});

test("非法公式局部显示错误；不可信 HTML 与公式命令不能生成可执行内容", () => {
  const invalid = renderToStaticMarkup(
    createElement(MD, null, "之前 $\\frac{1}{$ 之后"),
  );
  assert.match(invalid, /之前/);
  assert.match(invalid, /之后/);
  assert.match(invalid, /katex-error/);
  const untrusted = renderToStaticMarkup(
    createElement(
      MD,
      null,
      "<script>alert(1)</script>\n\n$\\href{javascript:alert(1)}{点击}$\n\n$\\htmlClass{injected}{x}$",
    ),
  );
  assert(!untrusted.includes("<script>"));
  assert(!/href=["']javascript:/.test(untrusted));
  assert(!/class=["']injected/.test(untrusted));
});
