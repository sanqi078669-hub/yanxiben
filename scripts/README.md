# 工具脚本

除 PowerShell 启动脚本会自行定位项目根目录外，以下命令均从项目根目录执行。

| 脚本 | 用途与命令 |
| --- | --- |
| `start-local.ps1` | Windows 一键启动：`./scripts/start-local.ps1` |
| `init.ts` | 初始化本地账号：`npm run init` |
| `data.ts` | 备份/隔离恢复：`npm run backup -- <文件>`、`npm run restore -- <文件>` |
| `maintenance.ts` | 清理与维护：`npm run maintenance -- <操作>` |
| `build-workers.mjs` | 编译独立恢复 worker，dev/build 自动执行；生产运行保留生成的 `runtime/` |
| `build.mjs` | 在临时 DATA_DIR 中运行 Next 生产构建，避免收集页面数据时触发真实数据库迁移 |
| `verify-production-restore.mjs` | 构建后 `npm run test:production`：隔离生产安装、恢复、重启、停止及清理验收，使用 npm 离线缓存 |
| `qa-seed.ts` | 在 `test-results/` 下指定的独立 DATA_DIR 中生成测试数据：`npx tsx scripts/qa-seed.ts` |
| `benchmark.ts` | 独立临时数据库性能检查：`npx tsx scripts/benchmark.ts` |
| `ai-smoke.ts` | AI 真实连接与图片识别验证 |
| `ai-study-smoke.ts` | 整理、错因、提示、点评、英语、变式的真实调用验证 |
| `ai-related-smoke.ts` | 相似题真实调用验证 |
| `ai-diagnosis-smoke.ts` | 学习诊断真实调用验证 |
| `verify-ai-boundaries.ts` | `node --import tsx scripts/verify-ai-boundaries.ts --source-data test-results/qa-interactive --live`，克隆旧隔离配置，DeepSeek 长输出/截断/预算验收；会产生真实调用费用 |

AI 脚本使用 `npx tsx scripts/<脚本名>.ts --live` 显式启用真实调用，使用本机账号已配置的模型并可能产生费用。学习助手可额外传 `--action organize|analyze|hint|feedback|english|variant`（选择其中一个值）。CI 不运行真实调用脚本。

提示实测另需 `--entry-id <本人已保存记录ID>`，应使用隔离 DATA_DIR；服务端会记录该轮提示使用。生产安装可在构建环境生成 `.next/` 和 `runtime/` 后，连同配置与依赖锁文件交付，目标环境 `npm ci --omit=dev`；设置页恢复不再依赖 tsx。初始化、命令行维护等 TypeScript 开发脚本仍需开发依赖，不要把它们与网页恢复 worker 的运行条件混淆。

备份、恢复、维护的完整前置条件见[项目说明](../README.md)，执行前不要省略数据隔离与备份步骤。脚本输出、临时凭据和报告产物放入已忽略的 `test-results/`，不要提交。
