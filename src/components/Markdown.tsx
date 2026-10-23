"use client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
export function MD({ children }: { children?: string }) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { trust: false, strict: "ignore" }]]}
      >
        {children || "尚未填写"}
      </Markdown>
    </div>
  );
}
