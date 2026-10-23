import { z } from "zod";
import { randomBytes, createCipheriv } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { dataDir } from "../../lib/db";
import { assert } from "../entries/service";
import { publicTarget } from "./network";
import { masterKey, decryptWithKey } from "./master-key";
import { aiLimitsSchema, defaultAiLimits } from "../../lib/ai-limits";

const profileSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
    base: z
      .string()
      .url()
      .max(300)
      .refine((v) => {
        const u = new URL(v);
        return (
          u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash
        );
      }, "接口地址必须为不含账号、查询参数的 HTTPS 地址"),
    model: z.string().trim().min(1).max(120),
    vision: z.boolean(),
    tokenParameter: z
      .enum(["max_tokens", "max_completion_tokens"])
      .default("max_tokens"),
    maxOutputTokens: z
      .union([z.literal(4000), z.literal(8000), z.literal(16000)])
      .default(4000),
    key: z.string().trim().max(500).optional(),
  })
  .strict();
export type Profile = z.infer<typeof profileSchema>;
const storedConfigSchema = z
  .object({
    activeId: z.string().uuid().nullable(),
    profiles: z
      .array(
        profileSchema
          .omit({ key: true })
          .extend({ encrypted: z.string().min(1) }),
      )
      .max(10),
    limits: aiLimitsSchema.default(defaultAiLimits),
  })
  .strict();
type Config = z.infer<typeof storedConfigSchema>;
const directory = path.join(dataDir, "ai-private");
function filename(owner: string) {
  return path.join(directory, z.string().uuid().parse(owner) + ".json");
}
function read(owner: string): Config {
  const file = filename(owner);
  return existsSync(file)
    ? storedConfigSchema.parse(JSON.parse(readFileSync(file, "utf8")))
    : { activeId: null, profiles: [], limits: { ...defaultAiLimits } };
}
function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", masterKey(dataDir, true), iv);
  const content = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), content]).toString("base64");
}
function decrypt(value: string) {
  return decryptWithKey(value, masterKey(dataDir, false));
}
export function configuredLimits(owner: string) {
  return read(owner).limits;
}
export function publicConfig(owner: string) {
  const c = read(owner);
  return {
    activeId: c.activeId,
    limits: c.limits,
    profiles: c.profiles.map(({ encrypted, ...p }) => ({
      ...p,
      hasKey: !!encrypted,
    })),
  };
}
export function activeConfig(owner: string) {
  const c = read(owner),
    p = c.profiles.find((p) => p.id === c.activeId);
  if (!p) return null;
  return {
    base: p.base,
    model: p.model,
    key: decrypt(p.encrypted),
    ready: true,
    vision: p.vision,
    host: new URL(p.base).host,
    tokenParameter: p.tokenParameter,
    maxOutputTokens: p.maxOutputTokens,
  };
}
export function saveConfig(owner: string, raw: unknown) {
  const command = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("save"), profile: profileSchema }).strict(),
      z
        .object({
          action: z.literal("activate"),
          id: z.string().uuid().nullable(),
        })
        .strict(),
      z.object({ action: z.literal("remove"), id: z.string().uuid() }).strict(),
      z
        .object({ action: z.literal("limits"), limits: aiLimitsSchema })
        .strict(),
    ])
    .parse(raw);
  const c = read(owner);
  if (command.action === "save") {
    const { key, ...p } = command.profile,
      old = c.profiles.find((v) => v.id === p.id);
    publicTarget(p.base);
    assert(
      key || (old && old.base === p.base),
      400,
      "AI_KEY_REQUIRED",
      "新配置或更换接口地址时必须重新填写密钥",
    );
    assert(
      old || c.profiles.length < 10,
      400,
      "AI_CONFIG_LIMIT",
      "最多保存 10 个模型配置",
    );
    const next = { ...p, encrypted: key ? encrypt(key) : old!.encrypted };
    c.profiles = c.profiles.filter((v) => v.id !== p.id).concat(next);
  } else if (command.action === "activate") {
    assert(
      command.id === null || c.profiles.some((p) => p.id === command.id),
      404,
      "NOT_FOUND",
      "模型配置不存在",
    );
    c.activeId = command.id;
  } else if (command.action === "limits") {
    c.limits = command.limits;
  } else {
    c.profiles = c.profiles.filter((v) => v.id !== command.id);
    if (c.activeId === command.id) c.activeId = null;
  }
  mkdirSync(directory, { recursive: true });
  const file = filename(owner);
  writeFileSync(file + ".tmp", JSON.stringify(c), { mode: 0o600 });
  renameSync(file + ".tmp", file);
  return publicConfig(owner);
}
