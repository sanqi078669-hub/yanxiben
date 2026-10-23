import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dataDir, one } from "../../lib/db";
import { assert, AppError } from "../entries/service";
export async function session() {
  let password = process.env.SESSION_SECRET;
  if (!password) {
    try {
      password = readFileSync(path.join(dataDir, "session-secret"), "utf8");
    } catch {
      throw new AppError(
        503,
        "NOT_INITIALIZED",
        "请先运行 npm run init 初始化私人账号或补建会话密钥",
      );
    }
  }
  assert(
    password.length >= 32,
    503,
    "NOT_INITIALIZED",
    "会话密钥无效，请检查 SESSION_SECRET 或本地 session-secret 配置",
  );
  return getIronSession<{ sid?: string }>(await cookies(), {
    password,
    cookieName: process.env.SESSION_COOKIE_NAME || "yanxi_session",
    ttl: 604800,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.SECURE_COOKIES === "1",
      path: "/",
    },
  });
}
export async function authenticated() {
  const s = await session();
  const row = s.sid
    ? one(
        "SELECT owner FROM sessions WHERE id=? AND expires>?",
        s.sid,
        Date.now(),
      )
    : null;
  assert(row, 401, "UNAUTHENTICATED", "请先登录");
  return { owner: row.owner as string, session: s };
}
