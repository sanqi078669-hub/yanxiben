# 登录页 style-v2 局部试点交付

日期：2026-10-29。分支：`ui/style-v2`。当前为本地未提交改动，未 commit、未部署。

## 范围与现有视觉系统

本次只改登录页。延续 PRODUCT.md 确认的深绿 `#28624c`、奶油纸底、衬线标题及版画感品牌基础，在登录页试用期刊式版面；登录后的页面、业务逻辑与全局 token 不在范围内。

DESIGN.md 仍是既有实现的视觉实录：正文及普通页面标题以系统无衬线为主，衬线和装饰有局部用途。本试点的暖纸色、标题尺寸、分栏和插图均是登录页方案，不提升为全站规范，也不据此重写 DESIGN.md、PRODUCT.md 或 `.impeccable/design.json`。

## 交付文件

- `src/components/Login.tsx`：登录页结构、品牌与装饰图接入；提交 handler 经 AST 比对保持完全一致。
- `src/components/Login.module.css`：仅登录页生效的排版、配色、响应式布局及交互状态。
- `public/login/study-engraving.webp`：独立生成的装饰版画；`study-engraving.webp.json` 保存精确生成提示词。
- `public/login/fonts/noto-serif-sc-headings.woff2`、`fonts/source.json`、`fonts/OFL.txt`：自托管字体、来源与许可。
- `public/login/README.md`：资产尺寸、生成与处理方式、来源及字体维护说明。
- `.impeccable/config.json`：只新增 `design-system-font` 对字体别名值 `yanxiben journal serif` 的局部例外，不放宽其他规则。
- `.impeccable/review/login-style-v2/`：本报告、四张截图、桌面/手机测量与验证记录。

## 字体与插图

标题使用自托管 Noto Serif SC 500–600，仅保留中文品牌与标题用字；WOFF2 为 **8,516 bytes / 8.32 KiB**。正文为 Arial、Microsoft YaHei、PingFang SC 等系统无衬线。运行时只访问应用同源字体，无 Google Fonts 请求依赖。来源记录见 [source.json](../../../public/login/fonts/source.json)，随资产保留 [SIL OFL 1.1](../../../public/login/fonts/OFL.txt)。修改衬线标题文案必须重做子集，避免新增字符回退到系统字体。

书本、纸页与铅笔版画由 imagegen 为本页独立生成，非风格稿截图裁片。交付 WebP **960×640，81,014 bytes / 79.12 KiB**，页面引用 `/login/study-engraving.webp`，不引用临时目录；纯装饰使用空 alt。来源、提示词与 WebP 处理参数见 [资产说明](../../../public/login/README.md) 和 [提示词侧车](../../../public/login/study-engraving.webp.json)。提示词持久化扫描为 1 raster / 0 missing，像素与文件大小未变。

## 本地验收证据

| 检查 | 结果 |
| --- | --- |
| 1440×900 桌面 | 页眉、页脚各 108px；主体 56:44 分栏；标题 48px / 500；字体和插图已加载；scrollWidth = clientWidth = 1440 |
| 375×812 浏览器窄屏 | 主按钮 bottom 594.53px；实际内容宽 360px（浏览器滚动条占位），scrollWidth = clientWidth = 360，无水平溢出 |
| 手机布局错误态 | 错误文字可见，按钮 bottom 673px，仍在首屏内 |
| 热区与焦点 | 输入框及主按钮高 48px；密码显隐 44×44px，注册链接高 44px；最小热区 44px；焦点为 3px 深绿环、offset 3px |
| 文字对比度 | 最低 5.03:1；主按钮 6.97:1；错误文字 6.12:1，均超过 PRODUCT.md 的 4.5:1 目标 |
| 静态检查 | `npx tsc --noEmit`、`npm run lint`、`git diff --check` 均通过 |
| 行为保持 | 提交 handler AST 比对完全一致；实测密码显隐、错误反馈、busy 时禁用并显示“正在登录…” |

详细数值见 [桌面测量](desktop-metrics.json)、[手机测量](mobile-metrics.json) 和 [验证记录](verification.json)。

成功登录验收**未完成**：操作被浏览器自动审批的账户用量限制打断；用户继续后浏览器连接不可用，因此没有成功登录结果。手机真机与软键盘场景也尚未验收；浏览器窄屏结果不替代这些检查。

## 与风格稿的差异

- 实现遵循明确的 48px 桌面叙事标题等尺寸，未照搬 AI 风格图夸大的文字比例。
- 正文保留系统无衬线，衬线集中于品牌和标题。
- 版画单独生成，构图与风格稿不同。
- 手机隐藏大插图、长叙事补充和栏目字，保留标题、简短说明与登录任务。

## 截图与评审

- [桌面 1440×900](desktop-1440x900.jpg)
- [手机布局 375×812](mobile-375x812.jpg)
- [手机键盘焦点](mobile-focus.jpg)
- [手机错误态](mobile-error.jpg)

独立 finish reviewer 已检查上述四张截图及源码，结论为 **ship，无实质问题**。该结论仅适用于本地登录页视觉试点，不构成成功登录、真机兼容或部署验收。
