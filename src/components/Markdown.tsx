"use client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
const attachmentImage =
  /^\/api\/v1\/attachments\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/content$/i;
export function MD({ children }: { children?: string }) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { trust: false, strict: "ignore" }]]}
        components={{
          img: ({ src, alt }) => {
            if (typeof src !== "string" || !attachmentImage.test(src))
              return (
                <span role="note">
                  [外部图片未加载{alt ? `：${alt}` : ""}，请先上传为附件]
                </span>
              );
            // Authenticated private images must use the browser's own session.
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={alt || "附件"}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            );
          },
        }}
      >
        {children || "尚未填写"}
      </Markdown>
    </div>
  );
}
