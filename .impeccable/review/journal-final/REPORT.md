# 研习刊最后一批页面交付记录

日期：2026-10-29；分支：`ui/style-v2`；对照基线：`867331d`。
本批将 Register、RestoreWizard、AdminUsers 接入既有研习刊视觉，保持业务逻辑。
这是既有视觉世界的局部扩展；根目录设计文档、sidecar、配置不在本批修改范围。
适配取舍按“不改业务”范围执行且已沟通，不代表收到新的用户回答或账号政策决定。

## 范围与文件

- 组件：`src/components/Register.tsx`、`RestoreWizard.tsx`、`AdminUsers.tsx`。
- 页面：`src/app/admin/page.tsx`；新增局部样式：`src/components/JournalFinal.module.css`。
- 字体：`public/fonts/README.md`、`journal-serif.source.json`、`journal-serif.woff2`。
- 共 8 个应用／字体文件：7 个已跟踪文件修改，另有 1 个新 CSS Module。
- Module 共 97 条规则；无脱离局部作用域的选择器，无新增 CSS 自定义属性。
- `journal.css`、`globals.css`、Login 及其 Module、Notebook、此前五步的其它页面组件保持不变。
- Settings 内嵌的 RestoreWizard 是本批明确覆盖的区域，其余 Settings 区域未变。

## 页面结果

- 注册沿用 Login 刊头与纸张语言；桌面叙事／表单为 56／44，实测 734.719／577.266px。
- 桌面品牌／叙事／表单标题为 32／48／32px；手机为 22／26／22px，375px 单列。
- 375×812 注册 CTA 高 50px、底边 602.14px，位于首屏；局部重置 main 最小高度使页脚适配。
- 原 7 账号说明、账号规则、密码显隐、确认密码校验、错误和“正在创建…”状态保留；未新增邀请流程。
- 恢复以纸面细线和三步条呈现；当前步骤只读取既有 file／preview 状态。
- 上传与密码控件实测高 48px、圆角 4px；上传纵向 padding 为 0，密码右侧为眼睛按钮预留 52px。
- 棕色用于恢复警告与危险操作；隔离校验、重新认证、确认、进度、错误及工作区管理保留。
- 恢复仍打开独立空间，不覆盖当前数据；未为视觉效果新增恢复工作流。
- 管理标题桌面 32px、手机 26px；目录表采用细线、透明行底与描边操作，删除可操作态用红棕，禁用态保持可读。
- 名额提示用细线分隔；手机表格在自身区域横向滚动，可由键盘聚焦，操作目标至少 44px。
- 原本人保护、7 账号上限与级联删除规则保留；页面现有内容只有名额、记录数等，未补造重置或容量指标。

## 字体与资产

- Noto Serif SC 自托管子集由 658 字扩为 670 字，原字符完整保留，字重仍为 400–600。
- WOFF2 为 247,072 bytes（241.28 KiB），沿用别名 `Yanxiben Journal UI` 与 SIL OFL 1.1。
- 来源与字符表见字体 source JSON，许可文件未变；运行时同源加载，动态内容回退系统衬线。
- 注册复用 `public/login/study-engraving.webp`（960×640，81,014 bytes），来源见该目录 README。
- 本批没有新增位图资产；正文仍用系统无衬线，Login 的独立字体与样式未改。

## 验证证据

- `verification.json`：TypeScript、lint、`git diff --check` 均通过。
- 四个 TSX 文件的 handlers、hooks、guards、输入与禁用规则对照均为 true。
- 12 个测量状态无页面横向溢出，字体已加载；采样目标均至少 44px，输入均至少 48px。
- `contrast.json`：157 个文字颜色样本，最低 4.7265:1，没有低于 4.5:1 的样本。
- `behavior.json`：空密码显隐已切换并还原；实际焦点为 3px 绿框、offset 3px。
- 管理表格键盘横滚实测 scrollLeft 321，焦点为 3px 绿框；当前仅有 student（当前管理员本人），禁用／删除均受保护。
- 12 张截图已逐张打开，尺寸全部符合要求；临时浏览器视口已复原。
- 独立收尾复核结论见 `finish-review.md`：可交付，无实质修复项；Register／Module 检查无确定性发现。

## 验证边界与未决事项

- 未执行账号创建、凭据输入、变更请求、上传、重新认证、恢复校验／启动或账号启停／删除。
- busy、错误、完成、删除弹窗与无权访问门禁仅核对源码；没有绕过保护或注入假数据展示状态。
- 未做手机真机、软键盘与完整键盘流程验收；375px 浏览器检查不等于真机通过。
- PRODUCT.md 中自助注册／受邀政策的冲突仍未决；保留原文不将 7 账号开通方式固化为长期政策。
- 根 DESIGN.md 的既有记录与本批局部实现差异未被改写成全局规范；本报告只记录本批实况。
- 本批未提交、未部署。

## 截图索引

| 场景 | 1440×900 | 375×812 |
| --- | --- | --- |
| 注册首屏 | [桌面](register-first-1440x900.jpg) | [手机](register-first-375x812.jpg) |
| 管理列表 | [桌面](admin-list-1440x900.jpg) | [手机](admin-list-375x812.jpg) |
| 恢复步骤 | [桌面](restore-steps-1440x900.jpg) | [手机](restore-steps-375x812.jpg) |
| 恢复表单 | [桌面](restore-form-1440x900.jpg) | [手机](restore-form-375x812.jpg) |
| 恢复工作区 | [桌面](restore-workspaces-1440x900.jpg) | [手机](restore-workspaces-375x812.jpg) |

补充：[注册焦点](register-focus-375.jpg)、[管理操作与横滚](admin-actions-375.jpg)，均为 375×812。
恢复截图已滚动到目标区域；同帧其他 Settings 内容为未变的上下文。
