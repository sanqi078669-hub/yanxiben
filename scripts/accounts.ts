export {};
if (!process.env.DATA_DIR) throw new Error("必须显式指定 DATA_DIR");
const { maintainAccount } = await import("../src/modules/auth/admin");
const { one, run } = await import("../src/lib/db");
const argv = process.argv.slice(2);
const [command, username = ""] = argv.filter((arg) => arg !== "--admin");

if (command === "promote") {
  const result = run("UPDATE users SET role = 'admin' WHERE username = ?", username);
  if (result.changes === 0) throw new Error("账号不存在");
  console.log("操作完成；账号已升级为管理员");
} else {
  const role = argv.includes("--admin") ? "admin" : "user";
  const result =
    command === "create"
      ? maintainAccount(command, username, process.env.INIT_PASSWORD, role)
      : maintainAccount(command, username, process.env.INIT_PASSWORD);
  if (command === "create" && role !== "admin") {
    const adminCount = one("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
    if (adminCount?.c === 0) {
      console.warn(
        "警告：当前数据库没有管理员账号。若这是初始化，请用\n" +
          `  node scripts/accounts.ts promote ${username}\n` +
          "（或直接 SQL UPDATE）将该账号升级为管理员，否则无人能访问后台。",
      );
    }
  }
  console.log(
    result.credential
      ? "操作完成；私有交付文件：" + result.credential
      : "操作完成；已有会话已撤销",
  );
}
