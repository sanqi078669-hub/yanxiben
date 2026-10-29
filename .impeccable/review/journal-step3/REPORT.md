# 第三步交付：资料库与详情视觉试点

日期：2026-10-29。分支：`ui/style-v2`；基线：`1333f16`。本轮仅完成本地实现与检查，未提交、未部署。

## 范围与边界

- 延续深绿、奶油纸底与衬线标题的品牌基础，把资料库做成目录、详情做成分节纸面；本报告记录本轮局部实现，不更新全站设计规范。
- 新增页面规则均挂在 `.journal-library` / `.journal-detail` 下。`LibraryPage` 同时用于收集箱和回收站，因此仅 `mode === "library"` 获得资料库类名；详情加载态也有对应 wrapper。
- 外壳唯一调整为侧栏 active 背景透明；原有 2px 绿色竖标保留。登录、今日页及其余受保护外壳规则保持原样。
- 信息结构、路由、数据、筛选参数、页签 `aria-pressed`、逾期计算均未改。组件 diff 仅根 wrapper；用 TypeScript printer 去除 wrapper 后，全文件与 HEAD 等同。
- `globals.css`、`Notebook`、`Login`、`Today` 和业务子组件源码无 diff；本轮配置无改动，沿用既有字体 alias，设计 hook 无新增待处置问题。

## 落实的视觉

- 页面标题桌面 32px、手机 26px 衬线；资料库说明 15px。“收集一条”“继续整理”使用绿色实心主按钮。
- 筛选区融入纸底，以顶部和底部细线分隔；搜索及六个筛选控件均为 48px 高、4px 圆角。手机保持两列，类型、标签及清除操作跨整行。
- 资料目录标题为 18px / 手机 17px 衬线，元信息 12px，状态采用描边；列表无卡片阴影或悬浮位移。批量区为薄框，空结果使用文字和细线，不配插图。
- 详情 AI 收起时为细条；内容按纸面分节，区块标题为 18px 绿色衬线，分析小标题 15px，Markdown 正文 16px / 1.8 行高。
- 页签至少 44px 高，当前项有绿色底线，原 pressed 逻辑保留。计划仍按“到期／逾期 → 主动练习 → 暂停”排列，暂停保持文字按钮；关联 select 与主要按钮至少 44px，键盘焦点为 3px 绿轮廓。

## 文件与字体

- 应用文件：`src/components/LibraryPage.tsx`、`src/components/Detail.tsx`、`src/components/journal.css`。
- 字体文件：`public/fonts/README.md`、`journal-serif.source.json`、`journal-serif.woff2`；审阅材料位于本目录。
- 字体为 Noto Serif SC 400–600，CSS alias 仍为 `Yanxiben Journal UI`。保留原 262 个字符，扩展至 455 个字符，148,164 bytes（144.69 KiB）。
- 新增静态用字覆盖资料库、详情、`BatchTags`、`EntryContent`、`AiRelated`、`AiStudy`。来源清单与 SIL OFL 1.1 许可齐全，运行时同源加载；动态标题允许回退系统衬线，未引入全量汉字包。原登录字体文件与样式未改。

## 验证与限度

- 最终 TypeScript、lint、diff whitespace 检查通过；[verification.json](verification.json) 记录作用域、受保护规则及源码边界检查。
- [measurements.json](measurements.json) 覆盖 13 组页面状态与尺寸：1440×900、375×812；均无横向溢出，字体 `fontLoaded: true`，采样交互目标无小于要求的记录。
- [contrast.json](contrast.json) 包含 317 个文字采样，最低对比度 5.03:1；此结论限于已采样状态。
- 使用现有搜索框输入不存在的词得到空结果，再清空恢复；批量操作仅展开，未执行。详情实际切换历史、版本与分析，并展开／收起 AI；[behavior.json](behavior.json) 记录历史、版本页签 pressed 状态。
- 未触发 AI 发送、计划变更、关联写入或删除。手机真机、软键盘与完整业务回归尚未验收，浏览器窄屏检查不代表全面功能验收。
- 独立 finish reviewer 审阅核心图及补充状态后给出 `ship`，未发现本轮实质问题。

## 截图与取舍

| 核心状态 | 1440×900 | 375×812 |
| --- | --- | --- |
| 资料库记录 | [桌面](library-records-1440x900.jpg) | [手机](library-records-375x812.jpg) |
| 资料库空结果 | [桌面](library-empty-1440x900.jpg) | [手机](library-empty-375x812.jpg) |
| 详情首屏 | [桌面](detail-first-1440x900.jpg) | [手机](detail-first-375x812.jpg) |
| 详情计划 | [桌面](detail-plan-1440x900.jpg) | [手机](detail-plan-375x812.jpg) |

补充：[手机记录与焦点](library-records-375-lower.jpg)；批量展开[桌面](library-batch-open-1440.jpg)／[手机](library-batch-open-375.jpg)；AI 展开[桌面](detail-ai-open-1440.jpg)／[手机](detail-ai-open-375.jpg)；关联区[桌面](detail-associations-1440.jpg)／[手机](detail-associations-375.jpg)。

375px 资料库首屏主要呈现筛选区：保留原结构与 48px 控件后，记录位于下半屏，可在补充图查看；空结果截图已滚到结果区。此处接受滚动长度，以保留筛选信息与可操作尺寸。
