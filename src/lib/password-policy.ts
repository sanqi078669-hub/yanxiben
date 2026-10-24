import { z } from "zod";

export const newPasswordHint =
  "新密码至少 12 位，按 UTF-8 编码最多 72 字节（不是 72 个字符）；中文通常占 3 字节，emoji 通常占 4 字节";
export const passwordBytes = (password: string) =>
  new TextEncoder().encode(password).byteLength;
export const newPasswordSchema = z
  .string()
  .min(12, newPasswordHint)
  .refine((password) => passwordBytes(password) <= 72, newPasswordHint);
