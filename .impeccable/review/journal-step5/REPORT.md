# 第五步交付：设置、知识地图与回收站

分支 `ui/style-v2`，基线 `55cd14f`。本轮仅做局部视觉接入，未 commit、未部署。

## 范围与实现

- 新增 100 条 CSS 规则仅挂在 `.journal-settings`、`.journal-knowledge`、`.journal-trash` 下；原 CSS 前缀完整保留，无新增全局变量。
- 三页标题为桌面 32px、手机 26px 衬线；分区标题 22px、子标题 18px，正文继续系统无衬线。
- 延续纸底 `#F5F1E8`、表面 `#FFFCF6`、主文字 `#242622`、次文字 `#66685E`、深绿 `#28624C`、红棕 `#924D3C` 与细线 `#D9D4C9`。
- 设置各区改为纸面与 1px 分节线，分类管理采用目录行；归档、恢复和排序按钮描边，禁用文字保持可读。
- 容量原本只有说明文字，本轮用已有 `capacity.bytes` / `capacity.limit` 补充表格和原生进度条；无斑马纹，纸色轨道、深绿填充。原容量政策、预警文案与条件保留。
- 账号安全、AI、备份及恢复表单统一为 48px 控件、4px 圆角；多行文本域保留自然高度。现有危险操作保留明确文字，使用红棕描边。
- 知识节点改为索引行，子节点用细线与缩进连接；名称允许完整换行。手机单列，诊断／统计及别名合并仍默认折叠。
- 回收站采用目录行和描边恢复按钮；手机操作另起一行。筛选空结果以文字与细线表达，不加插画。
- 当前回收站只有“恢复”，没有永久删除入口；本轮未新增删除能力。恢复工作区的原有删除确认流程保持原样。
- 设置页前置的手机“知识地图／回收站”入口属于既有外壳，本轮未改。
- 前四步页面、外壳、路由、业务处理、校验、请求与数据结构未改；移除页面 wrapper、回收站类名分支和容量展示增量后，三个组件的源码比对均通过。

## 文件与字体

- 应用文件：`src/components/SettingsPage.tsx`、`KnowledgePage.tsx`、`LibraryPage.tsx`、`journal.css`。
- 字体文件：`public/fonts/README.md`、`journal-serif.source.json`、`journal-serif.woff2`；共七个 tracked 文件变更。
- Noto Serif SC 400–600，别名仍为 `Yanxiben Journal UI`；保留原 552 字，扩展到 658 字。
- 字体大小 242,160 bytes（236.48 KiB）；OFL 许可保留，来源与用字清单已更新。
- 开发时下载字体子集，运行时由应用同源提供；动态内容允许系统衬线回退，未引入全量中文字库或新图片资产。
- `PRODUCT.md`、`DESIGN.md`、sidecar 与配置均保留。根设计实录与局部研习刊已有差异，本轮不把局部规则提升为全站规范。

## 验收与证据

- `npx tsc --noEmit`、`npm run lint`、`git diff --check` 最终通过。
- [verification.json](verification.json)：作用域、原 CSS、源码边界和字体覆盖检查通过；21 组状态测量无页面横向溢出，字体已加载。
- 采样交互目标至少 44px，输入与选择控件至少 48px；[measurements.json](measurements.json) 保留逐项尺寸。
- [contrast.json](contrast.json)：1,461 个文字颜色采样，最低 4.555:1，无低于 4.5:1 的采样；此结论仅覆盖采样状态。
- [behavior.json](behavior.json)：空密码显示／隐藏已检查并恢复；实测焦点为 3px 深绿轮廓、3px 间距。
- 改名、模型配置只打开空白或原值草稿后取消；恢复表单只展开，知识诊断／统计检查后恢复折叠。回收站用搜索产生空结果，随后清空搜索。
- 未执行配置保存、激活、分类归档／排序、节点创建／合并、导出、恢复、重新验证、密码修改、上传、删除或 AI 生成／连接测试；页面原有状态读取照常运行。
- 21 张截图均逐张打开核对，实际尺寸为 1440×900 或 375×812；浏览器临时视口已恢复。
- 独立终检给出 [ship](finish-review.md)，无本轮实质修复项。文档代理因额度限制未能完成，报告由主代理补齐。
- 设计 hook 早期未发现新增确定性问题，后续 CSS 提示达到既有上限；不宣称完成了最终完整 detector 扫描。

## 截图

下方按目标区域定位，较下方区域的截图已滚动；手机回收站首屏主要显示筛选，记录见补充图。

| 状态 | 1440×900 | 375×812 |
| --- | --- | --- |
| 设置与容量 | [桌面](settings-first-1440x900.jpg) | [手机](settings-first-375x812.jpg) |
| 分类目录 | [桌面](settings-dictionary-1440x900.jpg) | [手机](settings-dictionary-375x812.jpg) |
| AI 设置 | [桌面](settings-ai-1440x900.jpg) | [手机](settings-ai-375x812.jpg) |
| 账号安全 | [桌面](settings-security-1440x900.jpg) | [手机](settings-security-375x812.jpg) |
| 恢复表单 | [桌面](settings-restore-1440x900.jpg) | [手机](settings-restore-375x812.jpg) |
| 知识地图 | [桌面](knowledge-first-1440x900.jpg) | [手机](knowledge-first-375x812.jpg) |
| 诊断与统计展开 | [桌面](knowledge-expanded-1440x900.jpg) | [手机](knowledge-expanded-375x812.jpg) |
| 回收站 | [桌面](trash-first-1440x900.jpg) | [手机](trash-first-375x812.jpg) |
| 筛选空结果 | [桌面](trash-empty-1440x900.jpg) | [手机](trash-empty-375x812.jpg) |

补充：[手机改名草稿](settings-dictionary-open-375.jpg)、[手机模型草稿](settings-model-draft-375.jpg)、[手机回收站记录](trash-records-375.jpg)。

## 验证限度

- 当前知识数据只有两个根节点，归档节点及归档科目标记有实际检查；深层连接线、缩进和知识空态仅核对源码，未创建或清空用户数据来制造状态。
- 回收站检查的是筛选空结果，未清空实际回收站；永久删除按钮没有现成功能可验收。
- 原有确认、重新验证和导出／恢复处理均保留，但本轮没有执行这些业务流程，不能据此声称流程回归通过。
- 窄屏为桌面浏览器验收，未完成手机真机、软键盘、全流程键盘遍历或跨设备验证。
