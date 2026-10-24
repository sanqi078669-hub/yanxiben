# FIX-12 质量门禁与验证

日期：2026-10-23。使用当前安装的 Next.js 16.4.2 文档配置，未启用 React Compiler。

## 本地命令与 CI

```sh
npm ci
npm run lint
npm run format:check
npm run typecheck
npm run build
npm run test:coverage
npm run audit:production
```

HTTP 测试依赖生产构建，必须等待 build 完成后运行。`typecheck` 先执行 `next typegen`，自动生成本版本需要的 next-env.d.ts 和路由类型，再运行 tsc；保留生成文件忽略规则，不手改生成内容。

CI 分为 quality、types、tests 三个任务：质量任务检查 lint/format/生产依赖高危审计；类型任务独立执行类型检查；测试任务先构建，再测试与覆盖率检查并上传报告。尚未推送远端，**远端 CI 未执行**。

ESLint 9.39.5、eslint-config-next 16.4.2、c8 12.0.0 均锁定版本；保留 Next core-web-vitals、TypeScript 和 Hooks 检查，警告也使 lint 失败。tsc 新增 noUnusedLocals/noUnusedParameters。清理未使用属性、状态、导入及 AppError.extra。

明确的配置取舍：现存 SQLite/JSON DTO 仍有动态 any，暂不启用 no-explicit-any，严格类型检查和运行时 schema 校验继续执行；本地存储/会话恢复及加载状态有意在 effect 中初始化，因此关闭 set-state-in-effect 性能诊断。Hooks 调用规则、依赖检查、render refs 和 purity 检查仍启用。三处私有图片保留原生 img，并就地说明 Cookie 鉴权无法由公共图片优化器代传，未全局关闭图片规则。

Prettier 检查源码、脚本、测试、配置和维护文档。忽略生成/私有文件，以及按要求保留原文的 docs/REQUIREMENTS.md、框架生成的 AGENTS.md。未通过忽略业务源码来隐藏格式问题。

## 覆盖率基线

c8 使用 all=true，包含整个 src 下 .ts/.tsx，exclude=[]；未加载文件也计为 0%。报告输出到已忽略的 coverage/（HTML、lcov、JSON 摘要），门禁读取该报告，缺少关键文件同样失败。

| 指标      | 本次实测 | 最低门槛 |
| --------- | -------- | -------- |
| 行 / 语句 | 41.02%   | 40%      |
| 分支      | 82.91%   | 80%      |
| 函数      | 74.79%   | 70%      |

另对迁移、复习会话/长度契约、记录服务、HTTP 实际体积限制、AI 配置/预算/公网连接设置 95% 行覆盖门槛；恢复输入校验为 90%。实测迁移及复习会话 100%，恢复校验 93.97%，记录服务 99.64%，实际上传限制 97.14%，AI 配置/连接 98.15%，预算 100%。

限制必须保留：组件自动行覆盖约 4.29%；HTTP 集成测试启动 Next 打包产物，c8 未映射回原始 HTTP 处理器，这些源码仍显示 0%。真实 HTTP 行为测试通过不等于原始行覆盖率 100%。此门槛是当前防退化基线，不能据此声称所有 UI 状态均有自动化覆盖；浏览器证据单独记录。

`check-coverage.mjs` 正向通过；将报告副本的行覆盖降为 0 后，门禁返回失败。未修改原报告，也未排除核心文件以提高数字。

## 行为与公式回归

- `useLoad` 改为按 URL 加载，明确依赖 path；保留请求代次与卸载保护。草稿清理函数稳定，补齐保存与会话持久化依赖。
- AI 生成时的材料快照、pending 的界面状态、恢复预览取消入口改用 React state；请求锁、AbortController 和待重试原请求仍保留在 ref，界面不在 render 读取 ref。编辑器最近内容在布局 effect 同步，已保存快照单独驱动草稿显示。
- 浏览器一次合成 HTML 503 → 刷新 → 恢复答案和 pending → 原请求重试成功。代理只记录幂等键摘要，两次一致；数据库仅新增一条主动练习历史，到期日仍为 2099-01-01。证据 fix12-review-retry.png、忽略的 fix12-pending-requests.json。
- 隔离账号 DeepSeek 辅助整理成功；修改合成题面后立即禁用采纳并提示重新生成，自动保存成功。截图 fix12-ai-stale-suggestion.png；没有使用个人题库。
- Markdown 测试直接渲染 react-markdown → remark-math → rehype-katex → KaTeX 0.19.0，覆盖行内、积分分式、矩阵、分段函数、非法公式、HTML 与不可信公式链接。保留已有 KaTeX override，未未经验证降到依赖声明中的旧版本；这组回归验证现有组合，不承诺所有宏命令兼容。
- 完整 141/141 自动化与覆盖率门槛通过；lint、格式、类型、生产构建通过；esbuild 升级后再次通过完整测试和无开发依赖生产恢复、启动、父进程重启、停止、删除验收。

## 依赖审计及残余风险

2026-10-23 生产审计 `npm audit --omit=dev --audit-level=high`：**0 个漏洞**。2026-10-24 重跑发现 Zod 新公告，已将 4.3.6 升至 4.6.7（修复版自 4.6.6 起），见 [Zod 资源耗尽公告](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。升级后的最新完整/生产审计返回均为 0，原始结果保存在忽略的 test-results/audit-all.json、audit-production.json。审计结果是查询时点快照，不证明不存在其他漏洞。

完整审计最初为 5 high + 1 low。已将 esbuild 升至 0.28.2，并让 tsx 使用同一版本；构建、测试和生产恢复验证兼容。该修复对应 [Windows 开发服务文件读取公告](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr)，项目没有调用 esbuild serve API。

2026-10-23 完整审计曾有 **5 个 high 包条目，均为开发依赖同一条 braces 漏洞链**：eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces。不是 5 个独立应用漏洞。[上游公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 当时未提供修复版。2026-10-24 npm 审计未再返回这条记录，但安装树中的 braces 仍为 3.0.3，不能据此宣称已通过升级修复；继续保留这项开发工具风险说明。该链不在生产依赖中，应用请求不调用 lint 工具；开发环境仍应避免处理不可信 glob/仓库。

没有执行 npm audit fix --force 建议的 Next 配置降级到 14.x，也未隐藏完整审计结果。CI 按计划门禁生产依赖高危项；不宣称完整开发依赖审计为零。审计证据保存在忽略的 test-results/audit-production.json、audit-all.json。
