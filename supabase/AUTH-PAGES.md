# Step 2：页面生成前的会话基础

本次仅实现 SSR 客户端封装和会话中间件。注册、登录、邮箱回调和 toast 页面等待确认后逐个生成。

## 文件结构

```text
src/
  proxy.ts                         已接入；Next.js 16 的中间件入口
  lib/supabase/
    config.ts                      已实现；统一读取 .env.local 对应环境变量
    client.ts                      已实现；createBrowserClient
    server.ts                      已实现；createServerClient + cookies()
    middleware.ts                  已实现；刷新会话并重定向已登录用户
  app/
    (auth)/
      register/page.tsx            待确认；服务端检查身份 + 注册表单
      login/page.tsx               待确认；服务端检查身份 + 登录表单
    auth/confirm/route.ts          待确认；邮箱确认链接处理
  components/auth/
    register-form.tsx              待确认；signUp + 验证邮件提示
    login-form.tsx                 待确认；signInWithPassword
  components/ui/                   待确认；页面所需控件与 toast
tests/
  supabase-middleware.test.ts       已实现；模拟 Auth 服务的会话边界测试
```

仓库实际依赖为 Next.js 16.4.2，因此保留并扩展已有 `src/proxy.ts`，不并存 `src/middleware.ts`。独立的会话逻辑位于 `src/lib/supabase/middleware.ts`。Next.js 14 的入口约定为 `src/middleware.ts`，不应在当前 Next.js 16 项目中再创建该入口。

## 当前行为

- `@supabase/ssr` 的浏览器与服务端封装统一读取 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`，没有 service role key。
- Proxy 调用 `getClaims()` 刷新并验证会话，不信任 `getSession()` 返回的用户对象。
- 新 Cookie 同时传给当前服务端请求和浏览器；跳转响应也保留更新后的 Cookie 和防缓存头。
- 已登录用户访问 `/login` 或 `/register` 时跳转 `/`，丢弃原查询串；匿名用户可继续访问认证页。
- 保留原 CSP nonce，允许浏览器连接配置中的 Supabase origin。
- `.env.local` 仍为占位值时，原网站继续运行，认证路径返回 503 配置提示。填写真实变量后重启 Next.js。
- 现有 matcher 排除 `/api`，因为当前 API 使用旧 SQLite / iron-session。以后接入 Supabase 的 API Route Handler 必须自行创建 server client 并验证用户；不能把 Proxy 当作唯一授权检查。

## 后续页面实现要处理的两个边界

1. 满员提示：触发器的 `REGISTRATION_LIMIT_REACHED` 可能被 Auth 包装成通用数据库错误。页面不能把所有 500 都映射为满员。下一阶段需要增加一个仅返回“是否已满”的受限 RPC；在注册失败后辅助判断文案，不读取用户列表，也不代替原触发器的并发限制。
2. 现有首页与 API 使用 SQLite / iron-session，Supabase 登录不会自动创建旧会话。后续页面整合时必须明确处理这个认证边界，不能将新增 Supabase Cookie 当作已经完成旧业务的用户迁移。旧业务数据迁移不在本次会话基础实现范围内。

当前测试采用真实 SSR SDK + 模拟 HTTP 响应，覆盖匿名访问、会话刷新、Cookie 双向传递、跳转响应保留 Cookie、CSP 与伪造令牌拒绝。尚未连接真实 Supabase；第 8 人注册、RLS 和邮件验证链路仍需 Step 4 实测。

参考：[Supabase SSR 官方指南](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&queryGroups=framework)。

## Supabase Auth 预埋已移除（2026-10-26）

路线决策：本项目最终采用 **iron-session + SQLite 增量扩展**
实现注册、7 人上限、管理员后台，未启用 Supabase Auth。

本次对话前预埋的 `src/lib/supabase/` 目录已于 2026-10-26 移除，
`src/proxy.ts` 中的会话刷新调用同步清理。
`tests/supabase-middleware.test.ts` 改造为 `tests/proxy.test.ts`，
只验证 proxy 的安全头行为（CSP、nonce、禁缓存）。

`.env.local` 中的 `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 暂保留一周观察，
确认无残留依赖后手动清理。

若未来考虑 Supabase Auth，需重新适配 @supabase/ssr 最新版本，
旧代码可通过 `git log -- src/lib/supabase/` 找回作参考。
