# QA-001 准备报告与候选提交范围（已批准）

日期：2026-10-24。项目：`C:\Users\24505\Desktop\Mistake notebook`。

准备阶段仅修改脚本、文档及 Caddy 模板；未修改应用代码、CI workflow 或审核报告；未运行 test:production / test:clean。用户随后批准原 73 文件加原样审核报告，共 74 文件，并批准分支和提交信息。以下验证结果采集于准备阶段；本文件记录提交前的批准状态，实际提交哈希和最终状态以 Git 历史及提交后输出为准。

## 候选范围方案

用户已批准从当前工作区新建分支 `codex/qa001-candidate`，使用一个候选快照提交，包含下列清单，不按整目录盲目暂存。原因：P0/P1 修改建立在此前账号、代理、容量及部署准备上，当前未提交内容交织，单一候选快照可避免拆出缺依赖的中间版本。此方案不改写历史，也不表示已经具备正式发布条件。

已批准的提交标题及补充正文：

```text
fix(release): prepare audited candidate and release verification

SEC-001: Recheck credentials/session/account state transactionally before password changes.
REL-001: Bound export cache bytes/files/rate, reserve capacity, and clean expired artifacts.
SEC-002: Enforce UTF-8 new-password limits while preserving legacy login compatibility.
REL-002: Check transactional capacity and retain per-item batch success receipts.
REL-003: Share upload deadlines and settle cancellation/unmount exactly once.

Validation recorded at the P1 stage: 211 tests, 210 passed, 1 platform skip;
browser suite 5 passed (included in the full suite); lint, types and build passed.
Preparation checks: script syntax, 2 preparation tests, lint, format and types passed.

Not run: test:production / test:clean; Linux/HTTPS/offsite-restore field acceptance.
deploy/ contains 14 templates/scripts pending Linux field acceptance.
The unchanged audit report is historical evidence, not candidate acceptance.
Browser tests are non-blocking; explicit CI skip warnings remain next-step work.
CI workflow unchanged; no remote push.
```

### A：已跟踪文件中的 P0/P1 修复（含与 B 重叠者）

以下 18 个文件建议全部纳入；其中 4 个原有改动叠加修复者标为 A+B。

| 文件                                         | 来源  |
| -------------------------------------------- | ----- |
| .env.example                                 | A+B   |
| scripts/build-workers.mjs                    | P0    |
| scripts/data.ts                              | P1    |
| scripts/export-isolated.ts                   | P0    |
| src/components/Editor.tsx                    | P1    |
| src/components/SettingsPage.tsx              | A+B   |
| src/lib/request.ts                           | P1    |
| src/modules/auth/reauth.ts                   | P0/P1 |
| src/modules/data-management/export-worker.ts | P0    |
| src/modules/data-management/exports.ts       | P0    |
| src/modules/entries/batch.ts                 | P1    |
| src/modules/entries/knowledge.ts             | P1    |
| src/modules/entries/service.ts               | P1    |
| src/modules/http/handlers/account.ts         | P0/P1 |
| src/modules/http/handlers/data.ts            | A+B   |
| src/modules/http/handlers/login.ts           | A+B   |
| tests/http.test.ts                           | P0/P1 |
| tests/reauth.test.ts                         | P0    |

### B：P0/P1 之前已存在的已跟踪改动

除 A+B 已在上表列出外，以下建议纳入，保留历史来源；本阶段更新了其中的专项脚本及脚本说明。

- README.md
- docs/README.md
- docs/USAGE.md
- package.json
- package-lock.json
- scripts/README.md
- scripts/init.ts
- scripts/start-local.ps1
- scripts/verify-production-restore.mjs
- src/app/layout.tsx
- src/components/Login.tsx
- src/lib/migrations.ts
- src/modules/auth/session.ts
- src/modules/http/handler.ts
- src/modules/http/handlers/attachments.ts
- src/modules/http/middleware.ts

本阶段新增修改的已跟踪文件另列：`scripts/verify-clean-install.mjs`（准备前未修改，不冒充此前遗留）。

A 的 18 个已跟踪文件、B 的 16 个已跟踪文件、本阶段新增修改的 1 个已跟踪文件，加上 C 中批准纳入的 39 个文件，共 74 个候选文件。该计数展开 deploy/，原样包含审核报告和本准备报告；不是提交已经发生的证明。

### C：未跟踪文件

以下均已批准纳入候选源码；部署目录逐文件列出，真实环境配置不在范围中。

| 文件                                        | 用途/来源                 | 建议                                              |
| ------------------------------------------- | ------------------------- | ------------------------------------------------- |
| .node-version                               | B，版本提示               | 纳入                                              |
| deploy/app.env.example                      | B，配置模板               | 纳入，待实机验收                                  |
| deploy/backup.env.example                   | B，备份配置模板           | 纳入，待实机验收                                  |
| deploy/backup.sh                            | B，备份脚本               | 纳入，待实机验收                                  |
| deploy/caddy.env.example                    | B，代理配置模板           | 纳入，待实机验收                                  |
| deploy/caddy.service.conf                   | B，Caddy drop-in          | 纳入，待实机验收                                  |
| deploy/Caddyfile                            | B，本阶段调整后端写入等待 | 纳入，待实机验收                                  |
| deploy/journald.conf                        | B，主机日志模板           | 纳入，待实机验收                                  |
| deploy/monitor.sh                           | B，监控脚本               | 纳入，待实机验收                                  |
| deploy/yanxiben-alert@.service              | B，告警入口               | 纳入，待实机验收                                  |
| deploy/yanxiben-backup.service              | B，备份服务               | 纳入，待实机验收                                  |
| deploy/yanxiben-backup.timer                | B，备份定时器             | 纳入，待实机验收                                  |
| deploy/yanxiben-monitor.service             | B，监控服务               | 纳入，待实机验收                                  |
| deploy/yanxiben-monitor.timer               | B，监控定时器             | 纳入，待实机验收                                  |
| deploy/yanxiben.service                     | B，应用服务               | 纳入，待实机验收                                  |
| docs/CODE-AUDIT-20261024.md                 | 历史审核报告              | 原样纳入；历史审核证据，不替代候选提交验收        |
| docs/DEPLOYMENT.md                          | B，本阶段对齐政策         | 纳入                                              |
| docs/LAUNCH-CHECKLIST.md                    | B，本阶段追加准备清单     | 纳入                                              |
| docs/LAUNCH-VERIFICATION-20261024.md        | B，历史验收               | 原样纳入历史记录，不作为本候选通过证据            |
| docs/QA001-PREPARATION-20261024.md          | 本阶段清单及准备报告      | 纳入                                              |
| scripts/accounts.ts                         | B，账号 CLI               | 纳入                                              |
| scripts/export-cleanup.ts                   | P0，定时清理入口          | 纳入                                              |
| scripts/instance.ts                         | B，实例 CLI               | 纳入                                              |
| scripts/release-verification.mjs            | 本阶段，共享专项辅助      | 纳入                                              |
| scripts/release-verification.test.mjs       | 本阶段，准备级测试        | 纳入                                              |
| src/instrumentation.ts                      | P0，启动清理钩子          | 纳入                                              |
| src/lib/password-policy.ts                  | P1，密码契约              | 纳入                                              |
| src/modules/auth/admin.ts                   | B+P1，账号维护/密码规则   | 纳入                                              |
| src/modules/auth/login-boundary.ts          | B，代理/限流              | 纳入                                              |
| src/modules/data-management/export-cache.ts | P0，缓存政策              | 纳入                                              |
| src/modules/data-management/quota.ts        | B+P1，容量检查            | 纳入                                              |
| src/proxy.ts                                | B，页面 CSP               | 纳入                                              |
| tests/export-cache-http.test.ts             | P0，HTTP 回归             | 纳入                                              |
| tests/export-cache.test.ts                  | P0，缓存回归              | 纳入                                              |
| tests/launch.test.ts                        | B，部署准备回归           | 纳入                                              |
| tests/password-policy.test.ts               | P1，密码回归              | 纳入                                              |
| tests/quota-transactions.test.ts            | P1，事务回归              | 纳入                                              |
| tests/upload-browser.test.ts                | P1，浏览器回归            | 纳入，非强制门禁；人工检查，CI 跳过警告留待下一步 |
| tests/upload-request.test.ts                | P1，XHR 回归              | 纳入                                              |

`.env.example` 是已跟踪的无真实秘密示例，属于 A；不能因排除真实 `.env` 而遗漏它。真实 `.env/.env.local`、私钥、凭据、数据、日志、test-results/、构建缓存、生成的 runtime/、.next/、node_modules/ 不提交。runtime/ 和 .next/ 应在候选构建时生成并按运行包规则保留，不能把“不提交”误解为“运行包不需要”。本轮未打开私人运行文件。

## 四项专项差异

1. 干净安装：要求 `--commit <哈希>` 并解析为完整提交后导出；不默认 HEAD、不包含工作区。报告记录提交和导出锁文件摘要，下游生产专项接收同一候选号。当前旧 HEAD 不包含这些准备变更，应在批准后的新候选提交上运行。
2. 安装证据：生产专项从临时安装目录检测 tsx/esbuild/eslint/TypeScript，JSON 使用同一检测结果。断言 tsx 存在、eslint/TypeScript 不存在，不再错误假设 esbuild 不可能作为生产传递依赖存在。
3. 运维 CLI：临时目录复制 src/ 及 init/accounts/instance 脚本；在独立合成数据目录实际初始化、停用/启用、快照和校验。准备级测试仅使用当前开发依赖，不代表生产安装通过。
4. 文档：部署手册和上线清单对齐 P0 缓存预算、P1 新密码规则、180 秒附件总时长及业务事务容量检查；保留历史验收的原时点含义。

## Caddy 超时契约

按官方 HTTP transport 文档，原 write_timeout=60s 是等待向后端下一次写入的时长，不是浏览器总时长。模板提高为 240s（客户端附件仍为 180s），与已有代理读取及响应头等待数值一致。更长等待会延长停滞连接及相关资源占用；本轮未新增并发或限流机制。需要 Linux/Caddy 实机配置校验、HTTPS 慢上传、停滞、取消释放和资源观察；当前未验证。

提交前确认 read_timeout=240s，含义是等待后端下一次读取的时长；已高于客户端附件 180s 总时长，因此不再调整配置。当前没有 10 MiB 图片处理耗时超过 240s 的实机证据；不能把此值视为处理时间保证，Linux 上仍需验证真实图片处理、慢上传与取消释放。本次仅补充文档，不改应用代码或 Caddy 现有数值。

依据：https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#the-http-transport

## 验证与状态

准备级验证结果：

| 命令/检查                                            | 结果                                               |
| ---------------------------------------------------- | -------------------------------------------------- |
| `node --check scripts/verify-clean-install.mjs`      | 通过，仅解析不执行                                 |
| `node --check scripts/verify-production-restore.mjs` | 通过，仅解析不执行                                 |
| `node --check scripts/release-verification.mjs`      | 通过                                               |
| `node --check scripts/release-verification.test.mjs` | 通过；测试也实际运行                               |
| `node --test scripts/release-verification.test.mjs`  | 2 项通过：候选参数及当前依赖环境中的隔离 CLI smoke |
| `npm run lint`                                       | 通过                                               |
| `npm run format:check`                               | 通过                                               |
| `npm run typecheck`                                  | 通过                                               |
| `git diff --check`                                   | 通过；既有 .env.example 有 CRLF 规范化提示         |
| 候选清单与当前改动逐路径比较                         | 准备时 73 个，批准后加原样审核报告为 74 个         |

首次准备级测试因测试读取 HEAD 时缺少单次 safe.directory 参数失败；补齐后 2 项通过，没有修改全局 Git 配置。CLI smoke 使用当前开发依赖，不证明纯生产依赖安装已通过。两个专项、CI、Linux 实机验收均未执行。

此前准备阶段前后状态为已修改已跟踪文件 34→35、未跟踪状态条目 23→26；deploy/ 当时是一个未跟踪目录条目，实际含 14 个文件。新增修改状态为 verify-clean-install.mjs，新增未跟踪文件为共享辅助脚本、准备级测试和本报告；其他准备改动追加在原有脚本/文档/模板上。当时未暂存，未创建分支或提交；本次已获准提交，结果以 Git 历史为准。

## 批准记录与后续边界

1. 已批准原 73 文件加原样审核报告，共 74 文件；deploy/ 的 14 个文件均为“待 Linux 实机验收”材料。
2. 已批准分支 codex/qa001-candidate、提交标题及包含五项 ID、验证状态和验收边界的正文。
3. 审核报告原样纳入，标注“历史审核证据，不替代候选提交验收”；标注置于本报告和上线清单，不修改审核报告原文。
4. 浏览器测试不设强制门禁，已列人工检查项；后续 CI 须显式输出跳过警告。本轮不修改 workflow，不实现 CI 接入。
5. 不运行两个专项，不做 Linux/HTTPS/异地恢复实机验收，不推送；候选提交完成即停止。
