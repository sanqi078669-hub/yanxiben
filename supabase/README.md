# Step 1：Supabase 数据库与权限

> 注：本目录下的 SQL 迁移（001~004）与 Supabase 项目相关，
> 与生产库使用的 SQLite 迁移（src/lib/migrations.ts 版本 1~11）
> 是完全独立的两个体系。路线 1 决策后，生产库不使用 Supabase，
> 本目录迁移仅作历史记录保留。

本目录为当前项目新增的 Supabase 认证基础。现有应用仍使用 SQLite / iron-session；本步骤不会切换现有登录、迁移旧数据或创建页面。仓库实际安装 Next.js 16.4.2，后续页面应按本地版本文档实现。

## 计数规则

- 最多同时存在 7 条 `auth.users` 记录，包含管理员、未验证邮箱账号、邀请账号和通过 Auth 管理接口创建的账号。
- 重复登录和针对已有账号的注册重试不会新增名额。
- 真正删除 Auth 账号后释放名额；软删除、禁用、退出登录不会释放。
- 这不是“历史累计只能注册 7 次”。如需累计限制，应先调整此规则。
- 应使用独立的 Supabase 项目，不能与其他应用共享 Auth 用户池。

## 执行迁移

1. 创建 Supabase 项目；先保持注册关闭，或在正式开放注册前应用迁移。
2. 在 Dashboard → SQL Editor 中以 `postgres` 角色执行 `migrations/202610260001_seven_user_auth.sql` 全文一次。也可由配置好的 Supabase CLI 执行 `supabase db push`。
3. 若已有超过 7 个账号，初始化计数的 CHECK 约束会令整个事务失败，不会静默接受超额数据。已有 0–7 个账号会回填资料和计数。
4. 在 Authentication 配置中启用邮箱/密码注册，按需启用邮箱确认；设置网站 URL 和后续邮件回调 URL。

该迁移为一次性版本迁移，不要反复在 SQL Editor 执行。不要手工修改计数、禁用触发器或 TRUNCATE `auth.users`。账号删除应走 Supabase Auth 管理接口；数据库所有者始终拥有修改数据库规则的能力。

## 数据与权限

| 对象 | 用途 | 普通登录用户 | 管理员 |
| --- | --- | --- | --- |
| `public.profiles` | UUID、邮箱、昵称、创建时间 | 读取自己；仅可更新自己的昵称 | 读取全部；仅可更新自己的昵称 |
| `app_private.administrators` | 管理员成员表 | 无表权限 | 无表权限 |
| `app_private.registration_capacity` | 7 人名额计数 | 无表权限 | 无表权限 |

匿名请求无资料读取权限。管理员页面将使用登录用户的 JWT 与普通 publishable key 查询 `profiles`，由 RLS 判断是否能读取全部行，不使用 service role。此处“全部用户数据”指应用公开的用户资料，不包括密码哈希、令牌等 `auth.users` 内部字段。现有 SQLite 业务表尚未接入 Supabase，不能声称已受这些 RLS 策略保护。

`is_administrator()` 仅查询独立成员表，不读取 profiles，避免 RLS 递归。所有 SECURITY DEFINER 函数固定空 search_path，并使用完整限定表名。注册 metadata 不作为权限依据。`app_private` 不应加入 Supabase Data API 的 Exposed schemas。

## 指定首位管理员

先正常注册一个账号，然后在 SQL Editor 以 `postgres` 执行以下语句，将 UUID 替换为 Authentication → Users 中核对的用户 UUID：

```sql
insert into app_private.administrators (user_id)
values ('替换为已注册用户的UUID'::uuid);
```

首个注册用户不会自动成为管理员。撤销权限：

```sql
delete from app_private.administrators
where user_id = '替换为用户UUID'::uuid;
```

## 环境变量

项目根目录的 `.env.local` 已添加两个待填写项；Next.js 会自动读取，且此文件已被 gitignore 忽略：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

从 Supabase Dashboard 的项目连接/API 配置复制真实值。这里没有真实凭据，不需要 service role key。不要在浏览器公开数据库连接串或 secret/service role key。

## 并发与错误

Auth 新增记录后的触发器执行 `UPDATE ... SET used = used + 1 WHERE used < 7`。竞争请求在同一计数行上串行更新；成功事务占用一个名额，失败事务连同 Auth 记录与资料一起回滚。计数本身还有 `0 <= used <= 7` 的 CHECK 约束。相比锁后简单 COUNT 的方案，这不依赖请求看到的计数快照。

满员时数据库异常为 `23514 / REGISTRATION_LIMIT_REACHED`。Supabase Auth 可能将触发器异常包装成通用 `Database error saving new user`；后续页面不能假设能读到原始数据库异常，也不能把所有注册失败都误报为满员。触发器按 Supabase 官方的用户资料同步方式工作：

- [用户资料与 Auth 触发器](https://supabase.com/docs/guides/auth/managing-user-data)
- [RLS 与 SECURITY DEFINER](https://supabase.com/docs/guides/database/postgres/row-level-security)

## 当前验证状态

本机没有 PostgreSQL、Supabase CLI 或 Docker，也尚未提供 Supabase 项目凭据，因此本步骤只完成迁移实现与静态检查，尚未在真实 Supabase 执行。正式联调、并发注册、第 8 个不同邮箱注册被拒绝、删除释放名额、事务回滚和 RLS 越权验证留在 Step 4；执行成功前不能视为已通过数据库实测。

## 运维手册与已知问题

以下内容适用于当前采用 iron-session + SQLite 的应用；上文 Supabase 方案保留为历史记录。

### 运维操作

在项目根目录执行。现有 CLI 要求显式设置 `DATA_DIR`；以下 Bash 示例将其指向本机 `data/`，生产环境须替换为实际数据目录。使用 `tsx` 加载项目 TypeScript，才可直接运行下方的 `node scripts/accounts.ts` 命令：

```bash
export DATA_DIR="$(pwd)/data"
export NODE_OPTIONS="--import=tsx"
```

```bash
# 重置密码（会撤销该用户所有活跃会话）
node scripts/accounts.ts reset <username>

# 创建管理员账号（仅限第一次初始化或紧急情况）
node scripts/accounts.ts create <username> --admin

# 将现有账号提升为管理员
node scripts/accounts.ts promote <username>

# 撤销会话（不删账号）
node scripts/accounts.ts revoke <username>
```

将 `<username>` 替换为实际账号名，不保留尖括号。未设置进程环境变量 `INIT_PASSWORD` 时，创建或重置操作生成随机密码，写入 `DATA_DIR/credentials/` 下的新私有凭据文件；CLI 仅输出文件路径。密码不是位置参数，也不会由此 CLI 自动从 `.env.local` 加载。不要把密码或凭据文件内容写入文档、日志或 Git。重置和撤销会话也会清除该用户的重新认证授权。

上述命令没有删除账号功能：`revoke` 不删除用户、不释放注册名额。账号删除通过管理员后台执行，数据库关联记录在事务内清理，删除成功后释放一个名额；不要仅对有学习数据的账号直接执行 `DELETE FROM users`。

### 已知问题

- `admin` 资源未在 `router.ts` 的 `resourceHandlers` 中登记，而是在 `handler.ts` 的分派处局部合并 `admin: adminHandler`。功能等价，但破坏“资源列表单一来源”惯例，后续可迁回 `router.ts`。
- dev 最终 HTTP 响应的 `Cache-Control` 实测为 `no-store`；Proxy 自身和生产模式实测为 `private, no-store`。
- 删除账号只清理数据库记录，不删除附件文件、AI 私有配置和导出缓存。文件资源彻底清理属于后续独立工作，当前不执行。
- **Supabase SDK 依赖已清理**（2026-10-26）：`@supabase/ssr` 和 `@supabase/supabase-js` 已从 package.json 移除。若未来考虑 Supabase Auth，需重新安装最新版本。
