import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { AppError } from "../entries/service";

const unavailable = () =>
  new AppError(
    503,
    "AI_KEY_UNAVAILABLE",
    "AI 加密主密钥不可用。请恢复独立保存的主密钥，或移除旧模型配置后重新填写服务商密钥",
  );
export function decryptWithKey(value: string, key: Buffer) {
  const bytes = Buffer.from(value, "base64"),
    cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    cipher.update(bytes.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
/** The data directory keeps only a reference, never the new master secret. */
export function masterKey(dataDirectory: string, create: boolean) {
  const directory = path.join(dataDirectory, "ai-private");
  mkdirSync(directory, { recursive: true });
  const legacy = path.join(directory, "encryption-key"),
    reference = path.join(directory, "key-reference");
  let keyFile = process.env.AI_KEY_FILE
    ? path.resolve(process.env.AI_KEY_FILE)
    : "";
  if (!keyFile) {
    if (!existsSync(reference)) {
      try {
        writeFileSync(reference, randomUUID(), { flag: "wx", mode: 0o600 });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
    const id = readFileSync(reference, "utf8").trim();
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw unavailable();
    keyFile = path.resolve(process.cwd(), ".private-secrets", id + ".key");
  }
  const relative = path.relative(path.resolve(dataDirectory), keyFile);
  if (
    !relative ||
    (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
  )
    throw new AppError(
      503,
      "AI_KEY_LOCATION",
      "AI_KEY_FILE 必须位于 DATA_DIR 之外",
    );
  const encrypted = readdirSync(directory)
    .filter((f) => /^[a-f0-9-]{36}\.json$/i.test(f))
    .flatMap((file) => {
      const value = JSON.parse(
        readFileSync(path.join(directory, file), "utf8"),
      );
      return (value.profiles || []).map(
        (p: { encrypted: string }) => p.encrypted,
      );
    }) as string[];
  const verify = (key: Buffer) => {
    try {
      if (key.length !== 32) throw unavailable();
      for (const cipher of encrypted) decryptWithKey(cipher, key);
    } catch {
      throw unavailable();
    }
  };
  if (existsSync(legacy)) {
    const key = readFileSync(legacy);
    verify(key);
    mkdirSync(path.dirname(keyFile), { recursive: true });
    try {
      writeFileSync(keyFile, key, { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const copied = readFileSync(/* turbopackIgnore: true */ keyFile);
    if (!copied.equals(key)) throw unavailable();
    verify(copied);
    unlinkSync(legacy);
    return copied;
  }
  if (!existsSync(/* turbopackIgnore: true */ keyFile)) {
    if (!create || encrypted.length) throw unavailable();
    mkdirSync(path.dirname(keyFile), { recursive: true });
    try {
      writeFileSync(keyFile, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  const key = readFileSync(/* turbopackIgnore: true */ keyFile);
  verify(key);
  return key;
}
