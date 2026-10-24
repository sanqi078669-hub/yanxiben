import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const warned = new Set<string>();
export function warnPrivatePermissions(filename: string) {
  if (
    process.platform === "win32" ||
    warned.size >= 10 ||
    !existsSync(/* turbopackIgnore: true */ filename) ||
    warned.has(filename)
  )
    return;
  const info = lstatSync(/* turbopackIgnore: true */ filename);
  if (info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    warned.add(filename);
    console.warn(
      "PRIVATE_PERMISSIONS: 请核对私人文件/目录权限，程序未修改已有权限：",
      filename,
    );
    if (warned.size === 10)
      console.warn(
        "PRIVATE_PERMISSIONS: 仅显示前 10 处，请检查整个数据目录的权限。",
      );
  }
}
export function privateDirectory(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  warnPrivatePermissions(directory);
}
/** Reserve with 0600 before SQLite initializes its DB/WAL/SHM files. */
export function reservePrivateFile(filename: string) {
  try {
    writeFileSync(filename, "", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  warnPrivatePermissions(filename);
}
export function inspectPrivateDirectory(directory: string) {
  if (!existsSync(/* turbopackIgnore: true */ directory)) return;
  warnPrivatePermissions(directory);
  for (const name of readdirSync(/* turbopackIgnore: true */ directory))
    warnPrivatePermissions(path.join(directory, name));
}
