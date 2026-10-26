import { createHash } from "node:crypto";
import { one, run, transaction } from "../../lib/db";
import { assert } from "../entries/service";
import { clientIp } from "./login-boundary";

export function limitRegister(headers: Headers, now = Date.now()) {
  const ip = clientIp(headers);
  transaction(() => {
    run("DELETE FROM login_limits WHERE reset_at<?", now);
    const key = "@register-ip:" + createHash("sha256").update(ip).digest("hex");
    const row = one("SELECT count FROM login_limits WHERE key=?", key) as
      | { count: number }
      | undefined;
    assert(
      !row || row.count < 10,
      429,
      "RATE_LIMITED",
      "注册请求过于频繁，请 15 分钟后再试",
    );
    run(
      "INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
      key,
      now + 900000,
    );
  });
}
