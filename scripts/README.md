# 工具脚本

除 PowerShell 启动脚本会自行定位项目根目录外，以下命令均从项目根目录执行。

`build-workers.mjs` 生成 runtime/restore-worker.mjs、runtime/export-worker.mjs 和 runtime/export-cleanup.mjs；生产交付应保留整个 runtime/。网页导出/恢复及定时清理使用普通 Node；账号、实例和初始化 CLI 使用已列入生产依赖的 tsx。

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

提示实测另需 `--entry-id <本人已保存记录ID>`，应使用隔离 DATA_DIR；服务端会记录该轮提示使用。生产安装可在构建环境生成 `.next/` 和 `runtime/` 后，连同配置示例、运维源码与依赖锁文件交付，目标环境 `npm ci --omit=dev`；设置页恢复不依赖 tsx。账号、实例及初始化 CLI 的 tsx 已纳入生产依赖，不能因此声称 eslint/TypeScript 等开发检查工具也会安装。

备份、恢复、维护的完整前置条件见[项目说明](../README.md)，执行前不要省略数据隔离与备份步骤。脚本输出、临时凭据和报告产物放入已忽略的 `test-results/`，不要提交。

`check-coverage.mjs` 由 `npm run test:coverage` 自动执行，检查整体及关键文件基线，报告位于 coverage/。`client-asset-probe.mjs` 可在隔离测试时设置 `PROBE_PORT`；`PROBE_FAIL_ATTEMPTS=1` 只注入一次复习提交 503，用于验证刷新重试，默认关闭。该代理不能替代正式服务，也不记录答案、Cookie 或原始幂等键。

`npm run test:clean -- --commit <候选提交哈希>` 执行 `verify-clean-install.mjs`，必须显式指定已批准的提交哈希，不再默认 HEAD。脚本解析为完整提交并导出该源码（不包含未提交修改、运行数据或 .env），在系统临时目录离线 npm ci，再检查初始化/补密钥、lint/格式、首次构建前类型生成、构建、完整覆盖率和生产恢复。导出目录中的专项通过 CANDIDATE_COMMIT 记录同一提交号；记录锁文件 SHA-256 与每条命令结果。依赖离线缓存必须齐全；结果写入 test-results/clean-install-acceptance.json，关闭测试进程后清理自身临时目录。CI 接入另行批准。本准备阶段未执行两个专项。

生产专项复制 src/ 以及 init/accounts/instance CLI 到临时生产安装目录；实际初始化合成账号、停用/启用、离线快照并校验，不能只靠 tsx 可导入判断。报告中的 tsx/esbuild/eslint/TypeScript 安装字段均读取实际文件状态，断言 tsx 存在且 eslint/TypeScript 不存在；esbuild 可作为 tsx 的传递生产依赖存在，不硬编码为未安装。其命令仅在第二步获准后运行。

准备阶段可单独运行 `node --test scripts/release-verification.test.mjs`：检查候选参数解析，并在当前依赖环境对临时合成数据执行 CLI smoke；它不会运行 npm 安装、构建、生产服务或两个专项，不代表纯生产依赖安装已经通过。

正式账号维护：npm run accounts -- create|reset|disable|enable|revoke 用户名，必须显式设置 DATA_DIR。全实例快照：npm run instance -- snapshot 全新目录 --offline（先停止所有写入）；校验：npm run instance -- verify 快照目录。加密异地定时任务与完整恢复见 docs/DEPLOYMENT.md。旧 backup/restore 命令是单用户学习ZIP操作，不是多账号实例备份。
