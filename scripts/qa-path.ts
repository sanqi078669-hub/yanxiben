import path from "node:path";
import { realpathSync } from "node:fs";

export function assertQaPath(target: string | undefined, root = process.cwd()) {
  if (!target) throw new Error("只能写入 test-results 中的隔离测试目录");
  const base = path.join(realpathSync(root), "test-results");
  const resolved = path.resolve(target);
  const inside = (value: string) => {
    const relative = path.relative(base, value);
    return (
      relative !== "" &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    );
  };
  if (!inside(resolved))
    throw new Error("只能写入 test-results 中的隔离测试目录");
  // Resolve existing ancestors too: a junction inside test-results must not escape it.
  let ancestor = resolved;
  const missing: string[] = [];
  while (true) {
    try {
      const actual = path.join(realpathSync(ancestor), ...missing);
      if (!inside(actual)) throw new Error("测试路径越界");
      return resolved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
}
