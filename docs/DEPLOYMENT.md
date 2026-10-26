# 受邀正式实例部署与运维

状态：可审查的部署材料；没有服务器、域名或公网发布授权，**尚未完成 Linux / HTTPS 正式环境验收**。用户确认正式数据全新，维护负责人为本人，AI 默认关闭，后续仅用户自带密钥。单实例 SQLite WAL，不引入外部数据库或队列。

`deploy/` 的 14 个配置模板和脚本建议随候选源码提交，统一标记为“待 Linux 实机验收”；提交不表示安装、启用服务或公网发布。本次 QA-001 准备仅更新脚本、配置模板和文档，未修改 CI、未运行生产安装或干净安装专项。

## 资源与职责

起步建议：Ubuntu 24.04 LTS x86_64，2 vCPU、4 GiB RAM、40 GiB 持久 SSD、公网 IP，允许出站 HTTPS，入站仅 80/443 和限制来源的 SSH。此为工程起步预算，不是性能保证；同机编译时建议 8 GiB 或先在同系统构建。需购买前自行比较区域、续费、带宽和备案要求；本文不绑定服务商、不授权购买。手机所在网络到服务器的实际延迟必须试用验证。

磁盘规划：系统/运行时/依赖/两代代码约 15 GiB；运行数据上限 1 GiB，快照和恢复预留 4 GiB；迁移快照暂留全部并每月检查；日志上限 200 MiB；至少保持 5 GiB 空闲且使用率 <80%。远端备份先预留 20 GiB；按实际增长再调整。7 日/4 周的去重结果不是固定 11 倍，但按 11 倍原始数据加余量规划更稳妥。不提供 5 GB 账号容量承诺。

“异地备份”是服务器整盘损坏时仍能取回的另一台机器或独立存储；本方案采用支持 SSH/SFTP 的私人备份空间，不能位于应用服务器的同一磁盘。“告警”是网站不可用、磁盘将满或备份失败时发送给维护人的通知。维护人提供一个 root 所有的 `/etc/yanxiben/notify` 可执行文件，参数为事件名，通过邮件或自己选定的 webhook 发送；真实地址和令牌不进入代码。需实际测试收到通知。agent 可以协助分析，但不能替代持续运行的定时器、独立外部探测和有人接收告警。

## 固定安装与目录

主要部署方式只有本机 systemd + Caddy + restic。固定应用运行时 Node **24.19.0**、npm **11.17.0**，Node 安装到 `/opt/node`，使用官方发布包并核验 SHASUMS。Caddy/restic 使用发行版或官方受信包，安装后记录 `caddy version`、`restic version`、`systemd --version` 和包版本，正式验收前验证模板语法。当前 Windows 未安装这三种服务，不能声称其配置已经实机测试。

由管理员执行（示例域名须替换，命令不包含真实秘密）：

```sh
useradd --system --home /var/lib/yanxiben --shell /usr/sbin/nologin yanxi
install -d -o root -g root -m 0755 /opt/yanxiben/releases
install -d -o yanxi -g yanxi -m 0700 /var/lib/yanxiben /var/lib/yanxiben/data
install -d -o root -g yanxi -m 0750 /etc/yanxiben /etc/yanxiben/secrets
```

代码放 `/opt/yanxiben/releases/版本号`，`/opt/yanxiben/current` 是指向候选版本的软链接。从经审核的源码树准备 release，不复制项目根的 data、data-_、.private-secrets、.env_、test-results、backups、日志或凭据。不要直接打包整个个人工作目录。使用 lockfile 安装：

```sh
export PATH=/opt/node/bin:$PATH
node --version; npm --version
npm ci
npm run build
npm run lint
npm run typecheck
npm test
npm run audit:production
npm prune --omit=dev
```

保留 `.next/`、`runtime/`、`public/`、`node_modules/`、package 文件、next.config.ts、scripts/、src/（运维 CLI 的依赖源）、deploy/。tsx 已纳入生产依赖，账号和实例 CLI 可在生产安装下运行。构建自动使用临时 DATA_DIR，不升级个人主库。生产服务不允许运行时写代码目录。

将 `deploy/app.env.example` 安装为 `/etc/yanxiben/app.env`（root:yanxi 0640）；生成高熵代理共享秘密，并写入此文件及 Caddy 私有环境文件。文件使用简单 `KEY=value`，含特殊字符时使用 shell 可安全读取的单引号。AI 主密钥位于 DATA_DIR 外 `/etc/yanxiben/secrets/ai-master.key`；即使暂时不用 AI，也预生成并独立托管，所有者 yanxi、0600，避免应用尝试在只读目录生成。session-secret 由 init 写在 DATA_DIR。配置不进发布包。AI密钥必须是32字节原始随机文件，不能是十六进制文本；可由管理员使用 Node crypto.randomBytes(32) 和 fs.writeFileSync(..., {flag: "wx", mode: 0o600}) 写入指定新文件，再核对所有者和独立托管。

```sh
cd /opt/yanxiben/current
sudo -u yanxi env DATA_DIR=/var/lib/yanxiben/data /opt/node/bin/node --import tsx scripts/init.ts
install -m 0644 deploy/yanxiben*.service deploy/yanxiben*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now yanxiben
curl --fail http://127.0.0.1:3000/api/v1/health
```

init 默认 student；生产可通过 INIT_USERNAME 指定第一位受邀用户，不存在特殊网页管理员。检查 `stat`/`namei -l`：DATA_DIR 0700、所有私有文件 0600、AI 目录和密钥不可被 caddy 或其他账号读取。必要时管理员在明确的全新目录修正权限；不得自动递归修改个人已有目录。应用 mode 告警不能代替实机权限核验。

## HTTPS 与代理边界

域名解析到服务器后，安装 `deploy/Caddyfile`，给 Caddy systemd drop-in 配置 EnvironmentFile，包含 `YANXI_DOMAIN` 和 `YANXI_PROXY_SECRET`，权限 root:caddy 0640。`PUBLIC_ORIGIN` 必须等于 HTTPS 地址（不带末尾 `/`）。执行 `caddy validate --config /etc/caddy/Caddyfile`，验证后重载。Caddy 自动申请并续期证书，持久保留其证书目录。参见 [Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)。没有额外 CDN/上游代理；增加代理层必须重新设计可信链，不能直接采用任意 X-Forwarded-For。

Caddy 覆盖私有 IP 头并注入共享秘密；应用仅在秘密匹配时接受该 IP，用于登录限流，忽略客户端 XFF。应用绑定 127.0.0.1，禁止公网直连 3000，不开放恢复端口。秘密不是用户凭据，不发送到浏览器，也不记录请求头。登录按 IP 30 次/15分钟限制请求（含成功），按 IP+账号组合最多 20 次失败/15分钟；组合键成功后清除，不再按用户名跨 IP 锁定。实例最多 8 个在途登录，完成或异常均释放槽位，不再使用全实例 15 分钟累计锁定。同出口用户仍共享 IP 预算，管理员重置密码不清该预算；重启不清持久预算。

正式模板必须保留 `YANXI_DEPLOYMENT=invited`。启动钩子在加载数据库清理模块前校验 HTTPS PUBLIC_ORIGIN、至少 32 字符 PROXY_SECRET、SECURE_COOKIES=1、CAPACITY_POLICY=invited、RESTORE_MODE=admin 及显式 AI_ENABLED=0/1；缺项或错误值拒绝启动。HTTPS 来源同时要求正式部署标记；本地 HTTP 保持可用，所有已填写的枚举配置仍校验拼写。此校验无法识别整份生产配置被全部移除的情况，仍需部署检查。模板显式关闭 Next 遥测并设置 HSTS，实际 Caddy 语法与 HTTPS 效果待目标机验证。

正式恢复禁用网页 ZIP 上传；代理正文上限 12MB 兼容 10 MiB 图片及 multipart，JSON 上限 1 MiB。导出是响应体，不受上传上限影响。附件 XHR 使用共享请求层的 180 秒总时长，AI 客户端 210 秒、导出 900 秒、worker 导出 120 秒；恢复启动客户端 90 秒。导出分块读取显示已接收字节/百分比，正文超时使用中文错误契约并保留原幂等键；浏览器最终仍组装 Blob，不支持断点续传。900 秒覆盖 120 秒生成加 80 MiB 在 1 Mbps 下约 671 秒传输，不保证任意慢网。代理响应头、后端读取及后端写入等待均为 240 秒，属于上游等待期限；真实弱网仍需验收。

按 [Caddy HTTP transport 官方说明](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#the-http-transport)，`write_timeout` 限制等待向后端下一次写入的时长，`read_timeout` 限制等待后端下一次读取的时长，二者均与浏览器请求总时长不同。模板 write_timeout 已由 60 秒提高到 240 秒；提交前核对 read_timeout 当前也是 240 秒，已高于附件客户端 180 秒总时长，因此无需再次调整。该值为后端图片处理和后续读取留出超过客户端时限的等待范围，但不是 10 MiB 图片处理时间保证，也不替代实际性能验收。较长停滞等待会延长连接、文件描述符及相关缓冲资源的占用；原正文上限和应用上传限制继续有效。本次没有新增并发或限流机制。**需 Linux 实机复验**：记录 Caddy 版本，执行配置适配/校验，验证真实 10 MiB 图片处理、HTTPS 慢上传、停滞、客户端取消后连接释放，并检查其他层超时与资源占用。当前未执行这些实机步骤。不要将 200 MiB 管理员 ZIP 恢复开放为公网大正文。

SECURE_COOKIES=1；同源检查使用 PUBLIC_ORIGIN；页面每请求动态渲染并生成新 nonce，不使用 CDN 页面缓存、ISR 或 PPR。脚本无 unsafe-inline / 生产 unsafe-eval；style-src 允许 unsafe-inline 以支持 KaTeX 和 React style 属性。API 不经过 Next Proxy，避免克隆缓冲大上传；附件自带 sandbox CSP。需浏览器确认公式、私有图片、动态脚本、blob 导出正常且无 CSP 拒绝。不得用配置文件存在代替浏览器证据。

## 账号维护与交付

所有操作均从当前 release 用受控本机 CLI 运行，显式 DATA_DIR，不开放注册或远程管理后台：

```sh
sudo -u yanxi env DATA_DIR=/var/lib/yanxiben/data /opt/node/bin/node --import tsx scripts/accounts.ts create alice
sudo -u yanxi env DATA_DIR=/var/lib/yanxiben/data /opt/node/bin/node --import tsx scripts/accounts.ts reset alice
sudo -u yanxi env DATA_DIR=/var/lib/yanxiben/data /opt/node/bin/node --import tsx scripts/accounts.ts disable alice
sudo -u yanxi env DATA_DIR=/var/lib/yanxiben/data /opt/node/bin/node --import tsx scripts/accounts.ts enable alice
sudo -u yanxi env DATA_DIR=/var/lib/yanxiben/data /opt/node/bin/node --import tsx scripts/accounts.ts revoke alice
```

创建/重置随机密码写 `DATA_DIR/credentials/随机UUID.txt`，独占新建，密码不打印到日志，也不覆盖原有 local-login.txt。CLI 只输出交付文件路径。管理员私下核对接收人，分渠道交付账号/密码，用户首次登录后改密，确认收到后删除对应单个文件；只在运维台账记录账号、日期、交付状态，不记录密码。重置/停用/启用/撤销均撤销会话和恢复授权；重置不重新启用已停用账号。未知旧凭据文件不自动删除。CLI 密码输入可通过短期环境变量，但优先随机生成，避免 shell 历史记录密码。

## 备份、保留与告警

学习 ZIP 只属于一个账号，不含登录认证或可解密 AI 配置。实例快照包含全部账号、密码哈希、会话密钥、数据库及其业务/历史/审核表、匹配附件、ai-private；不含交付凭据、导出缓存、迁移快照、恢复工作区。AI 主密钥和 app.env、代理秘密、restic 恢复密码及 SSH 身份必须单独加密托管到维护人的密码管理器/离线恢复介质，**不与实例备份共存**。丢失 AI 主密钥时核心学习可恢复，但已存 API Key 无法解密，需要重新输入。

安装 restic 后配置 `deploy/backup.env.example` 为 root-only `/etc/yanxiben/backup.env`，配置固定 SSH host key 和只供备份使用的 SSH identity。在私有 SFTP 位置 `restic init`，托管仓库密码。安装 root-only `/etc/yanxiben/notify` 并先做失败通知测试，再启用 backup/monitor timer。`deploy/backup.sh` 持有维护锁，停应用和所有人工 CLI 写入，SQLite VACUUM INTO 一致性快照（包含已提交 WAL），复制附件/AI 文件，校验摘要和外键，再启动服务；之后 restic 加密上传到独立故障位置。生成快照失败也尝试恢复服务。中间明文目录 root-only，EXIT 清理；主机断电留下的 snapshot.\* 需维护人核验无运行任务后清除。不能与发布、账号修改或维护 CLI 并行。

restic 只在上传成功后执行最近 7 日/4 周保留和 prune，再 check；保留语义见 [restic 保留规则](https://restic.readthedocs.io/en/stable/060_forget.html)。`check` 不等于下载恢复；每月执行一次下节完整恢复。先 `forget --dry-run` 核对生产保留分组；未通过恢复演练不删最后有效备份。备份成功时间超过 26 小时、服务探测失败、剩余磁盘 <5GiB 或使用率 >=80% 均触发监控。每次任务失败通过 OnFailure 通知；连续失败由 freshness 检查持续告警。再配置服务器外的 HTTPS 探测（5分钟间隔、连续两次失败通知），解决整机掉线时本机无法通知的问题。

```sh
systemctl start yanxiben-backup.service
systemctl status yanxiben-backup.service
systemctl enable --now yanxiben-backup.timer yanxiben-monitor.timer
systemctl list-timers 'yanxiben-*'
journalctl -u yanxiben -u yanxiben-backup --since today
```

安装 `deploy/journald.conf` 为 journald drop-in 并由管理员重启 journald；它影响主机 journal 总量。应用不记录请求正文、Cookie、API Key。错误日志限 14 天/200 MiB。探测返回仅状态、不提供账号或路径。静态资源只来自 public/.next，DATA_DIR 无反向代理 file_server 映射。

## 完整恢复与回退

先选择已知可恢复快照和相应代码版本。恢复到全新隔离机器/目录，绝不先覆盖在用 DATA_DIR：

```sh
restic snapshots --tag yanxiben-instance
restic restore SNAPSHOT_ID --target /var/lib/yanxiben/rehearsal
# 还原的目录通常为 rehearsal/var/lib/yanxiben/backup-current；检查实际路径
DATA_DIR=/var/lib/yanxiben/rehearsal/var/lib/yanxiben/backup-current \
 /opt/node/bin/node --import tsx scripts/instance.ts verify /var/lib/yanxiben/rehearsal/var/lib/yanxiben/backup-current
```

恢复独立托管的 AI 主密钥和配置，修正新目录所有者 yanxi、目录0700/文件0600。首次仅监听回环地址的备用端口，通过 SSH 隧道浏览器验收所有账号登录、抽样笔记、图片、关联、复习计划和日志、版本、AI 配置解密（不调用供应商）、导出。旧会话需要统一撤销时运行逐账号 revoke；AI 关闭时不调用真实付费服务。记录时间、表数量、附件摘要结果和代码版本；不记录私人内容。失败即停止候选服务，原服务和原目录保持不动。

仅在用户明确授权切换后：先停正式服务、保留当前实例独立备份，将 app.env 的 DATA_DIR 指向已验收的新目录，再启动并走 HTTPS 冒烟。目标 RPO<=24h、RTO<=4h；本机小样本耗时不能证明真实容量下达标。

单用户学习 ZIP 恢复：管理员将文件通过私密渠道接收，在全新 DATA_DIR 使用现有 `npm run restore -- 文件.zip`（RESTORE_USERNAME、RESTORE_PASSWORD 通过私密环境提供），不开临时公网端口。通过 SSH 隧道对隔离实例验收。该恢复产生独立实例，**不能自动并入现有多账号库**。若用户需要回到主站，先保存主站当前数据，另行批准受控账号数据迁移；本版不提供在线覆盖合并。网页用户只见管理员恢复说明。

## 发布与故障处理

每个新 release 在隔离环境 npm ci/build/全部检查，记录 Git revision、lockfile 摘要、Node/npm 和 Linux 包版本。`flock /run/yanxiben-maintenance.lock` 与备份串行化；备份完成后停止服务，保存 release 和数据恢复点，原子切换 current，启动健康检查和登录/保存/上传/复习/导出冒烟。发布不替换 `/var/lib/yanxiben`、`/etc/yanxiben` 或 Caddy 证书。先保留上一个 release，确认后清旧代码。

QA-001 第二步获准后，使用 `npm run test:clean -- --commit <候选提交哈希>`。该脚本要求显式提交哈希（可用唯一短哈希，解析为完整提交），导出该提交，不再默认导出 HEAD，也不导出工作区或未跟踪文件。确认该提交已包含修复、构建入口及专项脚本后再运行。它在导出目录中构建并调用生产专项，向后者传入候选提交号；报告记录提交和锁文件 SHA-256。单独运行生产专项时，不能仅凭环境变量中的提交号证明既有构建来自该提交，应先从同一候选源码重新构建。本准备阶段尚未运行上述专项，CI 接入另行授权。

当前 schema v10 在 v9 上增加 account_status，初始化产生升级前快照；正式采用全新数据，不迁移个人主库。迁移仍按本次合成 v3→当前测试验收。回退时新代码已迁移数据库，**不要假定旧代码兼容**：停服，将旧 release 与发布前整实例快照恢复至新目录，指向该目录重启；发布后写入需要另行保全，不可静默丢弃。若只是网络/配置问题，先检查 journal、磁盘、PUBLIC_ORIGIN、Cookie、代理秘密、健康检查与权限，不重置库或删除未知密钥。

## 容量与 AI 政策

CAPACITY_POLICY=invited 时账号按附件声明字节+各 owner 表序列化长度计量，60 MiB 预警、80 MiB 上限；HTTP 入口仍保留 2 MiB 余量检查。P1 对知识点合并在事务内先预估修订、事件快照等增长并检查，再在提交前核对实际总量；合并和撤销超限整体回滚。批量改标签逐条事务检查已提交数据加本条写入后的总量，记录、历史、派生数据及成功回执一同提交，第 N 条失败保留此前成功项；批量撤销也保持记录和回执一致。此保证针对上述业务，不代表所有写入已采用统一事务配额。实例数据库/WAL/SHM+附件1GiB、磁盘至少5GiB余量的既有检查继续保留；计量不是文件系统硬配额，PERF-001 的全量计量优化未实施。离线运维 CLI 不经过 HTTP 配额，必须先核算容量。200MiB ZIP、500MiB解压、单图10MiB仍为学习导出/恢复限制。

历史版本、复习幂等、AI审计初期保留全部；每月检查增长，接近60MiB时由用户导出并联系维护人。软删除不会释放容量，永久清理只能由维护人核对备份后通过 maintenance 执行，不能删除幂等/历史表来腾空间。迁移快照使用 `npm run maintenance:snapshots` 先预览，保最近3份/30天，明确 --apply 才清；已知恢复工作区由维护人检查生命周期后清理，不删未知引用。

P0 导出缓存独立设置以下预算；账号和实例限制同时检查。新任务在生成前预留，落盘前复核空间，失败释放预留；预算不足拒绝新任务，不删除有效旧键。启动钩子加载 `runtime/export-cleanup.mjs`，独立定时清理过期缓存，不依赖新导出。有效回执承诺 7 天重放，重放不计新任务频率；到期后同键按新任务重新检查。生产交付必须保留整个 `runtime/`。

| 环境变量                      | 默认值                 |
| ----------------------------- | ---------------------- |
| `EXPORT_CACHE_ACCOUNT_BYTES`  | 268435456（256 MiB）   |
| `EXPORT_CACHE_INSTANCE_BYTES` | 1879048192（1792 MiB） |
| `EXPORT_CACHE_ACCOUNT_FILES`  | 12                     |
| `EXPORT_CACHE_INSTANCE_FILES` | 84                     |
| `EXPORT_CACHE_RATE_COUNT`     | 3                      |
| `EXPORT_CACHE_RATE_WINDOW_MS` | 300000（5 分钟）       |
| `EXPORT_CACHE_MIN_FREE_BYTES` | 5368709120（5 GiB）    |
| `EXPORT_CACHE_CLEANUP_MS`     | 60000（1 分钟）        |

此方案采用单应用进程状态维护预留及频率，重启会重新开始频率计数，既有缓存仍计入预算。默认预算按七账号、每账号同时保留 BACKUP/MARKDOWN 各一份接近 80 MiB 的导出并留余量设置；有效旧键不淘汰，因此反复创建大快照仍可能用尽缓存，须重试原键或等待过期。实例预算等于 7×账号预算，文件数等于 7×12；旧 env 若显式指定旧值，升级时必须一并修改。大文件合成验收见 `tests/export-policy.test.ts`；真实浏览器弱网和目标机磁盘仍待验收。P0 的 SEC-001 异常影响行数注入未补测。

本地恢复模式限制每账号 2 个、实例 7 个工作区（含在途预览），按源 ZIP 加最大解压体积预留磁盘并保留 1 GiB 空闲。隔离服务使用自己的本机来源、非 Secure Cookie，移除代理秘密并关闭 AI 和嵌套网页恢复。未知或丢失令牌的活进程仍拒绝自动终止；维护人须先人工核实进程身份和目录，不能依据旧 PID 强制杀进程。

AI_ENABLED=0 拒绝 AI 写接口；核心流程不依赖 AI。启用前另行授权修改为1，仅用户自带密钥，沿用每账号并发1、每天默认100次和用户费用阈值、进程图片处理2槽；不以未知费用为0。服务商端应设置硬额度/余额，应用费用只是估算。截图识别发送用户选定图片，整理/点评/诊断发送对应材料与请求中的学习信息，使用前查看预览并同意。正式服务器只验证实际选择的一家供应商，用户明确授权后才调用；其他供应商不需真实验收。

## 最终上线闸门

服务器/域名、备份目标、告警收件人尚缺；购买/付费/DNS/公网发布均需用户授权。Linux 权限、Caddy语法/证书续期、停服备份/加密异地上传/保留/失败通知、系统重启/代码更新、电脑HTTPS和手机真机/弱网、7人同时HTTP及接近容量验收必须完成并回填上线清单，之后小范围试运行。当前材料不构成已上线证明。
