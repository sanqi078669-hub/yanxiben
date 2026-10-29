# 研习刊第二步交付报告

2026-10-29 · 分支 `ui/style-v2` · 对照基线 `ce95e54`。

本轮完成应用外壳（侧栏、顶栏、移动底部导航）和今日页的局部改造。独立 finish 初轮复核的唯一修正项已解决，修正复核为 **resolved — pass**；最终 disposition：**ship**。未提交、未部署。

## 范围与实现

- 采用纸色背景、细分隔线和 2px 导航选中标记；控件圆角 4px、面板圆角 2px。
- 今日主标题桌面 32px、窄屏 26px；统计数字 36px，正文保留系统无衬线。
- 统计取消独立卡片；上下两组内容均为 60/40 双栏，窄屏统计 2×2、内容单列。
- 复习块是今日页唯一大面积绿色区域；收集与记录改为目录式列表，状态标签使用描边。
- 隐藏旧星芒、纸叠装饰及侧栏线画；未新增插图，保留 `public/login` 登录资产。
- 复核指出复习块重复的 `TODAY’S FOCUS` 英文眉题，现已在全部尺寸隐藏并重截今日截图；日期眉题保持 12px，日期后的英文仅在窄屏隐藏。
- 用户接受其他页面内容继续使用旧风格；路由、数据、登录和 `aria-current` 逻辑未改。

## 文件与隔离

- `src/components/Notebook.tsx`：仅导入 `journal.css`，为原外壳增加 `journal-shell` 类。
- `src/components/Today.tsx`：仅增加 `journal-today` 外层与日期英文 span，便于局部样式和窄屏隐藏。
- `src/components/journal.css`：新选择器全部挂在 `.journal-shell` / `.journal-today`；没有 `:root` 变量定义或全局 token 覆盖。
- `public/fonts/`：字体、来源清单、OFL 许可和 README；`.impeccable/config.json` 仅新增指定字体别名的 ignore 值，说明已授权字体触发的钩子误报，未关闭规则。
- `DESIGN.md`、`PRODUCT.md`、`.impeccable/design.json`、全局 CSS 和其他页面内容文件均未修改。现有 DESIGN 作为旧系统实录保留，本报告只记录本轮局部结果。

## 字体

`journal-serif.woff2` 为 Noto Serif SC 400–600 子集，共 262 字符、95,924 bytes（93.68 KiB），包含登录、外壳、今日静态中文及数字标点。独立别名 `Yanxiben Journal UI` 仅用于外壳品牌和今日标题、数字，避免影响其他页内容字体。

字体运行时同源加载，不请求 Google Fonts；动态文字允许系统衬线回退。`journal-serif.source.json` 保存来源与用字清单，`OFL.txt` 为 SIL OFL 1.1。原登录字体文件与样式未动；静态文案变化后需更新本子集。

## 验证证据

- TypeScript 检查、lint、`git diff --check` 通过；PostCSS 确认全部新选择器受作用域限制且无全局变量覆盖。
- 对照 HEAD，Notebook 只有上述两处允许差异；排除范围内内容文件与全局 CSS 无差异。
- 44 处文字对比度采样最低 **5.03:1**；本轮采样操作目标均至少 44px，键盘焦点为 3px 轮廓、3px 偏移。
- 1440×900、375×812 浏览器视口均无横向溢出，字体成功加载；窄屏复习 CTA 底部 679.23px，位于底导航顶部 747px 以上。
- 资料库筛选、详情页签、设置表单在 1440 / 375 宽度分别比较八项内容样式，均无差异，未发现横溢或错位。
- 资料库桌面基线 clientWidth 1440、改后 1425，受内容加载/竖向滚动条影响；样式单独比较通过，不据此声称可用宽度完全相同。
- 详情见 [verification.json](verification.json)、[today-metrics.json](today-metrics.json)、[content-comparison.json](content-comparison.json)、[contrast.json](contrast.json)。

## 截图

主要四张：[今日桌面](today-1440x900.jpg)、[今日窄屏](today-375x812.jpg)、[资料库桌面](library-1440x900.jpg)、[资料库窄屏](library-375x812.jpg)。

补充六张：[今日桌面下半页与焦点](today-1440-lower.jpg)、[今日窄屏下半页与焦点](today-375-lower.jpg)、[详情桌面](detail-1440x900.jpg)、[详情窄屏](detail-375x812.jpg)、[设置桌面](settings-1440x900.jpg)、[设置窄屏](settings-375x812.jpg)。

## 验收边界

本轮用既有账号成功登录后只读检查，没有修改学习数据。结果属于响应式浏览器视觉、样式隔离和键盘焦点检查，不代表手机真机、软键盘或完整功能回归验收；其他页面仍保留已接受的旧内容风格。
