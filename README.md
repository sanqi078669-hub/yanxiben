# 研习本 · 本地试用版

根据[软件需求与设计说明书](docs/REQUIREMENTS.md)开发的私人考研学习应用。当前版本 0.1.0，先在本机使用，未部署公网。

## 项目结构

```text
.github/                 GitHub 检查流程、Issue 和 PR 模板
docs/                    需求、架构决策、验收报告与改进计划
scripts/                 初始化、启动、备份、维护和手动验证脚本
src/
  app/                   Next.js 页面入口、API 路由和样式
  components/            页面与 AI 交互组件
  lib/                   数据库和公共模型
  modules/               认证、记录、复习、备份和 AI 业务逻辑
tests/                   自动化单元与 HTTP 集成测试
README.md                项目说明和使用入口
CONTRIBUTING.md           开发与提交约定
SECURITY.md               安全问题报告与敏感文件说明
AGENTS.md                编码代理的项目约定
```

`data/`、`test-results/`、`backups/` 为本地私有数据或产物；`node_modules/`、`.next/` 为依赖与构建缓存，均不提交到 Git。框架与包管理配置保留在根目录。

详细资料见[文档索引](docs/README.md)，开发流程见[贡献说明](CONTRIBUTING.md)。项目尚未指定开源许可证；整理目录不代表授予开源使用许可。

若个人 Windows 终端出现 Git dubious ownership，按[仓库归属说明](CONTRIBUTING.md#windows-仓库归属提示)给每条命令加此项目的 `-c safe.directory=...`；尚未代为更改用户全局配置或 ACL。

## 启动

要求 Node.js >=24.19.0 且 <25、npm 11.x；已在 Node.js 24.19 / npm 11.17 验证。首次安装和初始化：

```powershell
npm ci
npm run init
npm run dev
```

Windows 用户也可在项目目录运行 `./scripts/start-local.ps1`。打开 <http://127.0.0.1:3000>。

初始化时生成私人账号，默认用户名 `student`，随机密码写入 `data/local-login.txt`，不会打印在终端。登录后可在“设置与数据”修改密码。已经初始化的账号不会被覆盖；缺少 session-secret 时再次运行 init 会补建密钥，并使旧会话失效。初始凭据文件不会随改密自动更新；确认记住新密码后可自行删除该文件。

为其他空白环境初始化，可先设置 `INIT_USERNAME`、`INIT_PASSWORD`（至少 12 位）和 `DATA_DIR`。默认不开放公开注册。

生产模式本地验证：

```powershell
npm run build
npm run start
```

开发和生产服务默认绑定 `127.0.0.1:3000`，仅本机可访问。手机跨设备访问和 HTTPS 部署尚未配置，不要直接将此开发服务暴露到公网。

## 使用流程

1. 在“收集一条”选择数学、408、生词或长难句，输入原文或上传题面图片后保存。
2. 在详情点击“继续整理”。已有记录停止输入约 1.5 秒后自动保存；新记录首次需要手动保存。
3. 可以填写专属分析、语境、来源、知识点、标签和错因。公式支持 `$...$` / `$$...$$`，代码支持 Markdown 围栏。Markdown 图片仅加载站内附件，外部图片显示占位；需要展示的图片请先上传为附件，避免材料或 AI 建议自动向第三方发起图片请求。
4. 保存后在详情中“加入复习”。已整理和已加入复习是独立状态。
5. 复习先显示原文与题面图片，点击展开后才显示分析和答案图片。使用提示后不能选择“熟练”。
6. 主动练习不改变计划；无计划记录会建立一个暂停的内部复习项用于保存历史，不自动加入到期队列。
7. 删除进入回收站，恢复保留附件与历史，计划保持暂停。到期后不会自动永久删除。

## 数据位置与安全

- `data/yanxiben.sqlite`：数据库，使用 WAL、事务和外键。
- `data/attachments/`：私有图片；浏览器访问必须登录并检查所有权。
- `data/session-secret`：iron-session 加密密钥，不能公开。
- 所有上述运行数据和凭据均被 `.gitignore` 排除。
- 新建私有目录/文件按 POSIX 0700/0600 创建；数据库先私有预留，SQLite 再初始化。已有权限过宽时在服务端告警，不自动修改；Windows 权限取决于父目录 ACL，mode 不代替 ACL。不要将 DATA_DIR 放在其他用户可访问的共享目录，复制/迁移后应重新核验访问权限。
- 会话由 iron-session 封装，并由数据库会话记录控制撤销。密码由 bcryptjs 哈希保存。
- 写请求强制 `X-Requested-With: yanxiben`；存在 Origin 时还要求同源，缺少 Origin 不单独拒绝。浏览器跨站请求无法绕过自定义头预检，服务端不开放跨站 CORS。接口限制图片为 JPEG、PNG、WebP，并通过 sharp 解码重编码、去除元数据。
- 附件使用 `private, no-cache` + ETag，每次重新鉴权后才允许 304；不允许共享缓存或免鉴权的短期缓存。
- 关闭浏览器前应等待“已保存”；编辑草稿和待确认复习保存在当前浏览器，错误时可重试。草稿不是服务端备份。

可选配置见 [.env.example](.env.example)。Next 加载 `.env.local`，初始化/备份等 tsx 脚本使用 PowerShell 环境变量；不默认加载 dotenv。`next-env.d.ts` 是本版本 Next 生成文件，保持忽略，`npm run typecheck` 会先运行 `next typegen`。

## 备份与阅读导出

设置页输入当前密码可下载完整备份 ZIP 或 Markdown 阅读 ZIP。两个导出都仅包含当前用户数据，不含密码哈希、会话与认证密钥。

ZIP 为明文，SHA-256 只校验完整性，不提供加密。异地或共享存储前请先放入可靠的加密归档或加密卷，勿直接上传明文学习 ZIP。恢复后“上次生成备份时间”重新计算；batch_edits 临时批量撤销回执与 backup_status 本机生成时间不进入学习备份，不能依靠学习 ZIP 延续旧批量撤销。

改密、导出和恢复预检共用按账号的失败退避（1 秒起，最高 15 分钟），并发验证先抢短期租约。恢复向导先验证密码，再用 120 秒一次性凭据上传 ZIP；API 客户端需先调用 POST /api/v1/auth/reauth（password、purpose=RESTORE），随后以 X-Restore-Authorization 请求头发起 restore-preview，凭据按账号且只能使用一次，不写入 URL 或学习备份。

`POST /api/v1/exports` 强制 8–200 字符 `Idempotency-Key`：同用户、同键、同类型在首次生成后 7 天内返回逐字节相同的 ZIP；不同类型返回 409，每次重试都重新验证当前密码。设置页失败后重试保留原键，下载成功后再次导出使用新键。缓存 ZIP 位于私有 `DATA_DIR/export-cache/`，到期后下次导出清理；7 天后同键可生成新快照。不保存密码或完整请求体；导出回执/缓存不进入学习备份。接口仍为同步下载，没有独立 GET 导出任务接口（见 ADR）。

当前备份格式为 v3，数据库迁移版本独立记录（当前 v9）。读取支持 v1/v2/v3；只转换明确支持的历史表/列默认值，随后完整校验，未知缺列和未来格式明确拒绝。数据库启动前按有序迁移升级，已有库升级前在 `DATA_DIR/migration-backups/` 留一致性快照；任意手改结构不在兼容承诺内。

命令行备份（单账号实例，拒绝覆盖已有文件）：

```powershell
npm run backup -- backups/yanxiben-2026-10-21.zip
```

备份包含 `manifest.json`（格式版本、时间、表计数、文件长度与 SHA-256）、`data.json`、附件目录。导出在 WAL 只读事务内取得快照，释放事务后压缩；维护清理时必须停止应用，避免附件被并发删除。网页导出使用编译的 runtime/export-worker.mjs 独立进程，完成后流式下载 ZIP；仍为单次 POST 等待结果，没有异步 GET 任务接口。每账号同时 1 个、每主服务同时 2 个，120 秒超时；失败可用原幂等键重试。

升级前快照同样包含私人数据，不应提交或公开。各项修复进度和验证记录见[代码审查修复计划](docs/CODE-REVIEW-REMEDIATION-PLAN.md)。

阅读导出包含每条记录的 Markdown、README 索引和相对路径图片，可离线阅读。它不是结构化恢复来源。

## 隔离恢复

不要覆盖现用目录。先关闭其他以目标 DATA_DIR 启动的服务，在新的空白目录恢复：

```powershell
$env:DATA_DIR = "$PWD/data-restored"
$env:RESTORE_USERNAME = "student"
$env:RESTORE_PASSWORD = Read-Host "新的恢复账号密码（至少 12 位）"
npm run restore -- backups/yanxiben-2026-10-21.zip
Remove-Item Env:RESTORE_PASSWORD
npm run dev -- --port 3001
```

访问 <http://127.0.0.1:3001> 检查记录、附件、关系和历史。恢复使用新账号凭据与新会话密钥，原会话不会恢复。不同本地端口共享 Cookie 名，切换环境时重新登录即可。完成验证后关闭该服务，清除 `DATA_DIR` 环境变量即可回到原数据目录：

```powershell
Remove-Item Env:DATA_DIR
Remove-Item Env:RESTORE_USERNAME
```

恢复拒绝非空数据库、不兼容版本、摘要不匹配、非法归档路径、外键破损或所有权不一致。失败环境不应投入使用，应换一个新空目录重试。

本地同步 ZIP 备份面向试用数据量，恢复限制压缩包 200 MiB、解压总量 500 MiB。正式版 5 GB 附件目标需要流式归档与后台导出，当前不承诺这一容量目标。

上传同时校验原文件和重编码成品不超过 10 MiB。导出会预检记录/附件容量，并检查包括 manifest 在内的解压总量及最终 ZIP 大小；超出同一恢复上限返回 413，不提示导出成功。旧导出缓存也按此契约检查。20 张合法图片已验证可往返，但 20 张接近上限的图片仍可能超过整个 ZIP 上限，需要先减少容量。

同一账号同时仅接收 1 个图片上传，每分钟最多 30 次（含失败尝试）；主服务同时最多处理 2 个图片任务，忙时返回 429。AI 提取的限流覆盖预处理全过程，预处理失败不等于服务商已经计费。这些并发/分钟闸门按单个主服务进程执行。

JSON API 要求 Content-Type: application/json（允许 charset 参数），multipart 上传接口单独处理。浏览器共享请求默认 30 秒超时；AI 210 秒、恢复上传校验 180 秒、导出 150 秒。超时表示结果尚未确认，不会自动重发写请求；复习与导出继续使用原幂等键核对和重试。调用方传入的取消信号与期限合并，未声明组件级取消的请求仍受默认期限约束。

## 维护

当前不自动删除 revisions、复习幂等记录或 AI 审计。清除它们会影响版本回溯、旧请求去重或 AI 记录查看；按时间/条数归档仍待专项实施。容量检查会拒绝超过可恢复上限的备份，但不能代替历史保留策略。不要直接执行 SQL 删除这些表来绕过容量上限。

先停止应用并备份，然后清理超过 24 小时、且未被当前记录或历史快照引用的临时图片：

```powershell
npm run maintenance -- cleanup
```

迁移快照单独管理，不随附件清理删除。`npm run maintenance:snapshots` 默认只预览，保留最近 3 份及未满 30 天的快照；至少保留 1 份。需要调整时先停止应用、核对预览并保存离线备份，再手动运行 `npm run maintenance:snapshots -- --keep 3 --days 30 --apply`。该命令不加载数据库，不会为了预览触发主库迁移。快照含私人数据，应与数据目录同样私有；Windows 权限继承父目录 ACL，Git 忽略不代替访问控制。

升级前可执行 `node --import tsx scripts/rehearse-upgrade.ts --source-data data`：对只读源库取得一致性副本，在私有 test-results 内升级、核对旧表摘要、查询和逐账号导出恢复；仅输出数量和状态。原库保持不变，副本及 ZIP 含私人数据，应妥善保管。真正升级主库仍由正常启动执行。

永久清理仅支持已在回收站中的指定记录；命令带明确确认参数，不提供自动到期销毁：

```powershell
npm run maintenance -- purge <记录UUID> --confirm
```

永久清理会删除记录的历史、复习与关联，不可通过回收站撤销。存在其他生词语境引用时会拒绝，需要先解除引用。

## 检查

```powershell
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run test:coverage
npm run audit:production
npm run test:production
```

从已提交源码验证完整新安装（使用 npm 离线缓存，不包含未提交修改）：`npm run test:clean`。分项证据见[审查修复计划](docs/CODE-REVIEW-REMEDIATION-PLAN.md)。

测试使用系统临时目录的独立数据库；HTTP 集成测试启动 `127.0.0.1:3127` 的生产服务并在结束后关闭，因此运行测试前必须先构建。不会写入默认 `data/`。

直接运行 `npm test` 会先构建，干净目录可直接验收；`test:coverage` 仍供已有构建或 CI 分步运行。涉及 AI 配置的自动化测试使用独立临时 AI_KEY_FILE，结束后清理，不使用真实主密钥。已有 `.private-secrets/` 仍必须私有；复制整个项目时应单独排除它，不可仅凭文件年龄删除可能仍被 key-reference 引用的旧密钥。

## 实施范围

已实现四类材料收集、结构化编辑、自动保存和冲突提示、公式与代码展示、图片、分类搜索、知识树、标签与关联、计划/主动复习、历史与内容快照、回收站、设置、备份恢复、Markdown 导出。

本地技术方案是 Next.js 16.4.2 / React / TypeScript + Node SQLite。与文档建议的 PostgreSQL / Prisma 方案有明确差异，详见 [本地实施决策](docs/ADR-001-local.md)。当前不是正式上线验收版：尚未完成手机真机兼容、设计容量压测、异地自动备份、正式部署与恢复时效验收。AI 功能现已按追加需求实现，总结卡片仍未实现。

浏览器走查使用的数学记录标题标有“【示例】”，可以编辑学习或移入回收站。

## AI 使用

在「设置与数据 → AI 模型与服务」添加配置，填写 HTTPS 基础地址、模型 ID、API Key、图片能力与输出长度参数，然后在「当前模型」切换并测试连接。支持保存最多 10 个 OpenAI Chat Completions 兼容配置；非兼容原生协议需要另行适配。选择「关闭 AI」后不会进行 AI 调用。

DeepSeek 示例：基础地址 `https://api.deepseek.com`，模型 `deepseek-flash`，图片能力开启，输出参数 `max_tokens`。服务商的模型能力可能变化，应以当前官方文档和连接测试为准。OpenAI 新模型通常选择 `max_completion_tokens`，其他服务按其兼容接口文档填写。

- 新建/编辑：截图识别、辅助整理、错因分析；生词/长难句还提供英语语境解析。
- 详情：分步提示、变式练习、相似错题比较与确认关联。
- 复习：解析前分级提示，解析后对本次作答进行点评。AI 评分需主动采纳，复习仍手动提交。
- 知识地图：从最近 200 次练习统计生成学习诊断，最多分析 20 条记录。

每次调用都有发送范围和确认选项。AI 结果只作为建议；确认后才写入记录或另存变式。截图最多 3 张且仅发送题面图，文本助手不发送附件。相似题支持最多 8 条基础候选或最多 40 条同科目记录的语言模型语义比较，发送前展示摘录；基础检索可独立使用，不保证窗口外召回。

模型密钥的密文保存在 `DATA_DIR/ai-private/`，主密钥默认独立放在 `.private-secrets/`，也可用 DATA_DIR 外的 `AI_KEY_FILE`；不回传浏览器、不写入日志、不包含在学习 ZIP 备份中。首次读取旧配置会校验并迁移旧主密钥，缺失或冲突明确报错。恢复学习备份后需重新配置模型。输出上限可选 4,000/8,000/16,000，分别使用 45/90/180 秒期限；单账号同一时间一个请求、每分钟最多 10 次，不自动重试。每日次数/费用阈值及未知价格行为见 [AI 配置边界](docs/AI-CONFIGURATION-BOUNDARIES.md)，生产/开发依赖审计限制见 [质量门禁](docs/QUALITY-GATES.md)。

自动化测试使用模拟传输，不产生 API 费用。`scripts/ai-*-smoke.ts --live` 为明确启用的真实调用脚本，只发送合成样例，但会使用当前本地账号的服务配置并可能产生 API 费用。功能验证记录见 [AI 验收报告](docs/AI-ACCEPTANCE.md)。

## 本轮改进与验收

改进清单已按本次确认范围实施，详见 [改进清单](docs/IMPROVEMENT-PLAN.md) 和 [测试报告](docs/TEST-REPORT.md)。设置页新增备份生成提醒、隔离恢复向导、AI 调用历史与费用估算单价；资料库支持当前页批量加标签和暂停计划及撤销。复习支持本次错因自评与按月统计。

恢复向导先在独立目录校验恢复，再确认启动独立本地端口；原数据保留，可返回原标签页回退。需要生产构建及 `runtime/restore-worker.mjs`，网页恢复不依赖 tsx。设置页可管理工作区；主服务重启后可核验身份、重连并停止隔离服务。未启动的预览在下次校验时清理超过 7 天的目录，启动过的空间仅手动删除。学习 ZIP 包含 AI 建议、反馈、费用快照、提示使用记录及知识点合并日志，但不含模型密钥、当前价格配置或临时批量撤销回执。旧备份兼容范围见备份章节。费用按用户提供的标准单价估算，不含缓存折扣等优惠，账单为准。

本次真实模型验收仅 DeepSeek；其他供应商真实调用、手机真机和真实浏览器 200% 缩放未实测。已完成 390 像素和等效 640 CSS 像素重排检查。
