# 贡献指南

使用 Node.js `>=24.19.0 <25` 和 npm `11.x`，运行 `npm ci` 安装依赖。启动步骤见 [README](README.md)。

## 开发与检查

代码放在 `src/`，测试放在 `tests/`，脚本放在 `scripts/`，文档放在 `docs/`。修改 Next.js 相关代码前，请阅读 [AGENTS.md](AGENTS.md) 和 `node_modules/next/dist/docs/` 中对应的指南。

提交前运行：

```sh
npm run lint
npm run format:check
npm run typecheck
npm run build
npm run test:coverage
npm run audit:production
```

覆盖率测试需先构建应用。测试使用独立临时数据和模拟 AI，无需真实密钥；界面变更请补充页面检查。

## 提交约定

- 每次提交聚焦一个改动，说明用途和验证结果；路径或命令变化时同步更新文档。
- 提交源码、文档和依赖锁文件，排除本地数据、密钥、备份和生成产物；截图需检查隐私。
- 自定义数据目录也应被忽略；`.gitignore` 不会取消已有文件的跟踪。
- 项目尚未指定开源许可证。

## Windows 仓库归属提示

遇到 `dubious ownership` 时，确认目录可信后，可对单次命令添加 `git -c safe.directory="项目绝对路径" status`。其他 Git 命令同理，不要设置 `safe.directory=*`。

CI 配置见 [.github/workflows/ci.yml](.github/workflows/ci.yml)，详细质量要求见 [质量门禁记录](docs/QUALITY-GATES.md)。
