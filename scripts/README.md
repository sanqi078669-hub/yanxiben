# 工具脚本

除 PowerShell 启动脚本会自行定位项目根目录外，以下命令均从项目根目录执行。

`build-workers.mjs` 同时生成 runtime/restore-worker.mjs 和 runtime/export-worker.mjs；生产交付应保留整个 runtime/。网页导出/恢复均使用普通 Node，不依赖 tsx；命令行维护脚本仍需要开发依赖。

追加维护：`node --import tsx scripts/rehearse-upgrade.ts --source-data data` 只在私有副本演练迁移、查询、导出恢复，原库不升级；`npm run maintenance:snapshots` 默认预览保留策略，`--keep 3 --days 30 --apply` 才执行清理，至少保留一份，先停止应用并核对离线备份。两个工具均不会把题目正文或凭据打印到终端；演练目录与 ZIP 含私人数据，不能公开。

`qa-seed.ts` 仅接受项目 `test-results/` 内的子目录（不接受该目录本身、相似名称或指向外部的 junction），路径检查发生在导入数据库模块前。`qa-path.ts` 是共用守卫，不是独立运行命令。生成的登录信息保留在私有测试目录，不能提交。

| 脚本                            | 用途与命令                                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start-local.ps1`               | Windows 一键启动：`./scripts/start-local.ps1`                                                                                                                           |
| `init.ts`                       | 初始化本地账号：`npm run init`                                                                                                                                          |
| `data.ts`                       | 备份/隔离恢复：`npm run backup -- <文件>`、`npm run restore -- <文件>`                                                                                                  |
| `maintenance.ts`                | 清理与维护：`npm run maintenance -- <操作>`                                                                                                                             |
| `build-workers.mjs`             | 编译独立恢复 worker，dev/build 自动执行；生产运行保留生成的 `runtime/`                                                                                                  |
| `build.mjs`                     | 在临时 DATA_DIR 中运行 Next 生产构建，避免收集页面数据时触发真实数据库迁移                                                                                              |
| `client-asset-probe.mjs`        | 隔离服务 3128 启动后运行 `node scripts/client-asset-probe.mjs`，浏览器经 3130 验收分包；仅记录静态资源路径/响应体字节到 test-results，退出 Ctrl+C                       |
| `verify-production-restore.mjs` | 构建后 `npm run test:production`：隔离生产安装、恢复、重启、停止及清理验收，使用 npm 离线缓存                                                                           |
| `qa-seed.ts`                    | 在 `test-results/` 下指定的独立 DATA_DIR 中生成测试数据：`npx tsx scripts/qa-seed.ts`                                                                                   |
| `benchmark.ts`                  | 独立临时数据库性能检查：`npx tsx scripts/benchmark.ts`                                                                                                                  |
| `ai-smoke.ts`                   | AI 真实连接与图片识别验证                                                                                                                                               |
| `ai-study-smoke.ts`             | 整理、错因、提示、点评、英语、变式的真实调用验证                                                                                                                        |
| `ai-related-smoke.ts`           | 相似题真实调用验证                                                                                                                                                      |
| `ai-diagnosis-smoke.ts`         | 学习诊断真实调用验证                                                                                                                                                    |
| `verify-ai-boundaries.ts`       | `node --import tsx scripts/verify-ai-boundaries.ts --source-data test-results/qa-interactive --live`，克隆旧隔离配置，DeepSeek 长输出/截断/预算验收；会产生真实调用费用 |

AI 脚本使用 `npx tsx scripts/<脚本名>.ts --live` 显式启用真实调用，使用本机账号已配置的模型并可能产生费用。学习助手可额外传 `--action organize|analyze|hint|feedback|english|variant`（选择其中一个值）。CI 不运行真实调用脚本。

提示实测另需 `--entry-id <本人已保存记录ID>`，应使用隔离 DATA_DIR；服务端会记录该轮提示使用。生产安装可在构建环境生成 `.next/` 和 `runtime/` 后，连同配置与依赖锁文件交付，目标环境 `npm ci --omit=dev`；设置页恢复不再依赖 tsx。初始化、命令行维护等 TypeScript 开发脚本仍需开发依赖，不要把它们与网页恢复 worker 的运行条件混淆。

备份、恢复、维护的完整前置条件见[项目说明](../README.md)，执行前不要省略数据隔离与备份步骤。脚本输出、临时凭据和报告产物放入已忽略的 `test-results/`，不要提交。

`check-coverage.mjs` 由 `npm run test:coverage` 自动执行，检查整体及关键文件基线，报告位于 coverage/。`client-asset-probe.mjs` 可在隔离测试时设置 `PROBE_PORT`；`PROBE_FAIL_ATTEMPTS=1` 只注入一次复习提交 503，用于验证刷新重试，默认关闭。该代理不能替代正式服务，也不记录答案、Cookie 或原始幂等键。

`npm run test:clean` 执行 `verify-clean-install.mjs`：从当前 Git HEAD 导出已提交源码（不包含未提交修改、运行数据或 .env），在系统临时目录离线 npm ci，再检查初始化/补密钥、lint/格式、首次构建前类型生成、构建、完整覆盖率和生产恢复。依赖离线缓存必须齐全；首次下载依赖可先在项目执行 npm ci。记录提交号及每条命令的退出状态到 test-results/clean-install-acceptance.json；关闭生产测试进程后按已验证的边界清理自身临时目录。远端 CI 仍需另行推送后执行。
