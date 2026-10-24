# 开发与贡献

## 环境与目录

使用 Node.js 24 和 npm，运行 `npm ci` 安装锁定依赖。本地使用需按 [README](README.md) 初始化账号。代码放在 `src/`，测试放在 `tests/`，工具放在 `scripts/`，说明文档放在 `docs/`。

本项目安装的 Next.js 版本有特定约定。修改框架相关代码前阅读 `AGENTS.md` 以及 `node_modules/next/dist/docs/` 中相应指南。

## 变更与验证

一次提交聚焦一个可验证的改动。修复问题时描述复现条件、变更后的行为和验证结果；修改文件路径或命令时同步更新文档引用。

```sh
npm run lint
npm run format:check
npm run typecheck
npm run build
npm run test:coverage
npm run audit:production
```

构建成功后再运行测试：HTTP 集成测试使用生产构建并占用本机 3127 端口。自动化测试使用独立临时数据库与模拟 AI 传输，不需要真实密钥。真实 AI 调用须单独显式启用，不纳入默认 CI。

新功能先完成针对性验证，再进入下一项。UI 改动补充实际页面检查，测试结果如实注明尚未覆盖的设备和供应商。

## 提交前检查

- 提交源代码、文档和 `package-lock.json`，不提交依赖目录或构建产物。
- 不提交数据库、附件、备份、登录文件、环境密钥、AI 私有配置或包含这些内容的截图。
- 自定义 `DATA_DIR` 若放在项目内，须确保被忽略；`.gitignore` 不能保护已被跟踪的文件。
- 仓库尚未指定开源许可证，不要擅自添加许可授权或虚构项目地址、维护者信息。

GitHub 工作流将质量/审计、类型检查、构建/覆盖率测试分为独立任务。该工作流需上传到 GitHub 后才会运行，本地通过不代表云端已验证。覆盖范围、门槛和明确保留的开发依赖风险见 [质量门禁记录](docs/QUALITY-GATES.md)。
