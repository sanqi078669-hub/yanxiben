import type { Metadata } from "next";
import "./globals.css";
import { connection } from "next/server";
export const metadata: Metadata = {
  title: "研习本 · 把每一次思考留下来",
  description: "个人考研错题、英语学习与复习空间",
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
