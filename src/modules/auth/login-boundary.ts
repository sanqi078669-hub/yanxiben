import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { one, run, transaction } from "../../lib/db";
import { assert } from "../entries/service";

export function clientIp(headers: Headers) {
  const secret = process.env.PROXY_SECRET;
  const supplied = headers.get("x-yanxi-proxy") || "";
  if (!secret) return "direct";
  const a = Buffer.from(secret),
    b = Buffer.from(supplied);
  assert(
    a.length >= 32 && a.length === b.length && timingSafeEqual(a, b),
    403,
    "UNTRUSTED_PROXY",
    "请通过正式入口访问",
  );
  const ip = headers.get("x-yanxi-client-ip") || "";
  assert(isIP(ip), 403, "UNTRUSTED_PROXY", "代理地址无效");
  return ip;
}

const loginState = globalThis as typeof globalThis & {
  yanxiLoginActive?: number;
};
export function loginFailureKey(headers: Headers, username: string) {
  return (
    "pair:" +
    createHash("sha256")
      .update(JSON.stringify([clientIp(headers), username.toLowerCase()]))
      .digest("hex")
  );
}
/** Reserve only after reading JSON, so a stalled body cannot occupy a bcrypt slot. */
export function acquireLoginSlot() {
  assert(
    (loginState.yanxiLoginActive || 0) < 8,
    429,
    "RATE_LIMITED",
    "登录繁忙，请稍后重试",
  );
  loginState.yanxiLoginActive = (loginState.yanxiLoginActive || 0) + 1;
  let released = false;
  return () => {
    if (!released) loginState.yanxiLoginActive!--;
    released = true;
  };
}
/** Count requests before reading JSON; malformed requests consume the IP budget. */
export function limitLogin(headers: Headers, now = Date.now()) {
  const ip = clientIp(headers);
  transaction(() => {
    run("DELETE FROM login_limits WHERE reset_at<?", now);
    for (const [key, maximum] of [
      ["@ip:" + createHash("sha256").update(ip).digest("hex"), 30],
    ] as const) {
      const row = one("SELECT count FROM login_limits WHERE key=?", key);
      assert(
        !row || row.count < maximum,
        429,
        "RATE_LIMITED",
        "登录尝试过多，请稍后重试",
      );
      run(
        "INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
        key,
        now + 900000,
      );
    }
  });
}
