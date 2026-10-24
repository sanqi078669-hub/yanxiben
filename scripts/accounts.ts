export {};
if (!process.env.DATA_DIR) throw new Error("必须显式指定 DATA_DIR");
const { maintainAccount } = await import("../src/modules/auth/admin");
const [command, username] = process.argv.slice(2);
const result = maintainAccount(
  command,
  username || "",
  process.env.INIT_PASSWORD,
);
console.log(
  result.credential
    ? "操作完成；私有交付文件：" + result.credential
    : "操作完成；已有会话已撤销",
);
