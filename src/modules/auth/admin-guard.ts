import { one } from "../../lib/db";
import { assert } from "../entries/service";

export function requireAdmin(owner: string): void {
  const row = one("SELECT role FROM users WHERE id = ?", owner) as
    | { role: "user" | "admin" }
    | undefined;
  assert(row?.role === "admin", 403, "FORBIDDEN", "无权访问管理员功能");
}
