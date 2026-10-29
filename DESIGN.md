---
name: 研习本
description: 现有响应式学习空间的视觉系统实录
colors:
  green: "#28624c"
  bg: "#f7f8f5"
  paper: "#fff"
  text: "#273b37"
  muted: "#626e66"
  line: "#e5eae3"
  button-hover: "#1c4f3c"
  outline-border: "#ccd9cb"
  outline-hover: "#edf3eb"
  button-light: "#f1f5e7"
  button-light-text: "#305640"
  sidebar: "#fbfcf9"
  topbar: "#fafbf8"
  nav-selected: "#e9f0e5"
  nav-selected-text: "#2f6148"
  input-border: "#dce3da"
  badge: "#f1f4ed"
  badge-text: "#7a886b"
typography:
  body:
    fontFamily: 'Arial, "Microsoft YaHei", "PingFang SC", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  headline:
    fontFamily: 'Arial, "Microsoft YaHei", "PingFang SC", sans-serif'
    fontSize: "31px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.02em"
  title:
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.5
  label:
    fontSize: "13px"
    fontWeight: 600
  banner-title:
    fontFamily: 'Georgia, "Noto Serif SC", "Songti SC", "SimSun", serif'
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "1px"
rounded:
  badge: "5px"
  control: "7px"
  panel: "9px"
spacing:
  inline: "12px"
  panel: "23px"
  form-panel: "27px"
  page-inline: "44px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "11px 20px"
  button-primary-hover:
    backgroundColor: "{colors.button-hover}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.green}"
    rounded: "{rounded.control}"
    padding: "11px 20px"
  button-light:
    backgroundColor: "{colors.button-light}"
    textColor: "{colors.button-light-text}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  panel:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel}"
  badge:
    backgroundColor: "{colors.badge}"
    textColor: "{colors.badge-text}"
    rounded: "{rounded.badge}"
    padding: "3px 9px"
---

# Design System: 研习本

## Overview

这是现有实现的记录，不是新的设计提案。依据为 `src/app/globals.css`、相关组件及本地实际页面的 computed style；采样日期为 2026-10-29。前置信息中的“深绿、奶油纸底、衬线标题、手绘/版画感”保留为品牌背景，但不能覆盖代码与浏览器中的实际数值。

已在浏览器检查首页 `/`、设置 `/settings`、资料库 `/library`、新建记录 `/entries/new` 和复习 `/review`，分别使用 1440×1000、375×812 CSS px 视口。正文、导航、标题、卡片、按钮、输入框、选中项、禁用按钮及键盘焦点均有实际样式采样。浏览器保留 15px 竖向滚动条，实际布局宽度分别为 1425px、360px；媒体查询仍按 1440px、375px 生效。截图为本次视觉检查，不作为产品数据或真机验收。

hover 记录来自当前 CSS 的规则与层叠分析，未进行鼠标悬停实测。登录、详情、错误、toast、评分选中状态及隐藏的 AI 结果等，凡未在此次页面中呈现的样式，以下明确记为源码记录。未触发保存、AI 发送、导出、归档或复习提交。

整体以浅灰绿底、白色薄边框容器和深绿操作色构成；装饰集中在首页纸张叠层、符号、品牌图标与复习侧栏。普通页面标题实际为无衬线，衬线只在特定位置出现。

## Colors

### Primary

全局操作色是前置 token `green`。主要按钮、输入框聚焦边框、通用键盘焦点、文字按钮及选中页签使用它。主按钮 hover 使用 `button-hover`，描边按钮 hover 使用 `outline-hover`。

首页复习横幅背景（`#315f4d`）、登录叙事区（`#2c5746`）、品牌图标（`#2d624f`）是各自的固定色，均不等于全局主绿；登录颜色仅核对源码。

### Neutral

真正声明在 `:root` 的颜色变量只有以下七个，前置颜色表中的其余项均为从组件提取的固定值，并非代码已经存在的全局变量。

| CSS 变量  | 记录位置与实际用途                                                       |
| --------- | ------------------------------------------------------------------------ |
| `--bg`    | 对应 `colors.bg`，全页浅灰绿背景；实际颜色比“奶油纸”这一品牌描述更偏冷   |
| `--paper` | 对应 `colors.paper`，统计卡片；普通 panel 也呈白色，但源码直接写 `white` |
| `--text`  | 对应 `colors.text`，正文、标题、表单文字                                 |
| `--muted` | 对应 `colors.muted`，辅助说明、保存状态等                                |
| `--line`  | 对应 `colors.line`，卡片、分割线、导航边界                               |
| `--green` | 对应 `colors.green`，主操作及焦点                                        |
| `--pale`  | 声明为 `#eaf1e8`，本次源码检索未见消费；不把它描述为已经生效的选中底色   |

侧栏与顶栏分别使用前置 `sidebar`、`topbar`，区别于页面背景。导航选中底色使用 `nav-selected`，不是 `--pale`。标签使用 `badge` 与 `badge-text`。

### 功能色与现存差异

- 错误提示（源码）：背景 `#fff4ed`、边框 `#e9c8bb`、文字 `#a35e4e`；危险操作文字为 `#a66559`，不是统一危险色 token。
- 辅助信息还大量直接使用 `#899382`、`#929b90`、`#9ca494`、`#a3ac9d` 等浅绿灰。它们没有统一映射到 `--muted`。
- 颜色相近不代表同一 token。此文不将这些固定值合并，也不建立源码不存在的色阶。

## Typography

全局正文与标题默认采用前置 `body` 字体栈。`--serif` 为 `Georgia, "Noto Serif SC", "Songti SC", "SimSun", serif`。未发现字体下载规则；computed style 返回的是字体栈，不能据此保证每台设备实际安装了同一字体。

### 实际字号阶梯

这里是角色集合，不是等比字号体系；除 `--serif` 外没有字号或字体变量。

| 角色               | 1440 | 375                     | 字重、行高与例外                          |
| ------------------ | ---- | ----------------------- | ----------------------------------------- |
| 正文               | 14px | 14px                    | 400，1.65，实测 23.1px                    |
| 页面 h1            | 31px | `.page-heading h1` 25px | 600，1.4；中间断点通用 h1 为 26px         |
| 通用 h2            | 18px | 18px                    | 600，1.5；不是每个实际 h2 都用它          |
| 首页区块 h2        | 15px | 15px                    | 600，1.5，实测 22.5px                     |
| 表单/设置 panel h2 | 17px | 17px                    | 600，1.5，实测 25.5px                     |
| 通用 h3            | 15px | 15px                    | 600，继承 1.65，实测 24.75px              |
| label              | 13px | 13px                    | 600；嵌套 input 继承 13px，字重重置为 400 |
| 表单 textarea      | 13px | 13px                    | 1.8，实测 23.4px                          |
| small              | 11px | 11px                    | 多处组件继续覆盖至 8–12px                 |
| eyebrow            | 10px | 8px                     | 500，字距 1.8px → 1px                     |
| 统计数字           | 35px | 32px                    | Georgia/serif，400，1.45                  |
| 首页横幅标题       | 26px | 24px                    | `--serif`，400，1.5，字距 1px             |
| 复习题目 h2        | 23px | 23px                    | 当前卡片标题；375 下允许换行              |
| 复习侧栏标题       | 30px | 隐藏                    | `--serif`，400，1.7，字距 4px             |
| 顶栏操作按钮       | 12px | 10px                    | 500，375 下最小高度仍为 44px              |

源码中的页面特例：详情标题 28px → 22px；登录叙事标题 42px → 31px（≤900）→ 27px（≤620），使用衬线；登录表单标题 28px → 24px。它们不替代全局 h1/h2。

已有不一致：品牌约束的“衬线标题”仅局部实现；普通 h1、设置页标题和复习题目均为无衬线。字体会因嵌套 label、表单类和区块类而变化，不能假定同为 input 或 h2 就有相同字号。小字仍有 6–10px 的装饰与辅助用途，没有统一最小字号。

## Layout

### 全局壳与断点

| 项目       | 1440 实测/生效规则                       | 375 实测/生效规则                                |
| ---------- | ---------------------------------------- | ------------------------------------------------ |
| 侧栏       | 固定 237px，padding 34px 21px 0          | 隐藏                                             |
| 主区       | 左移出 237px 侧栏空间                    | margin 0，width 100%，底部预留 65px              |
| 顶栏       | 高 76px，左右 padding 44px               | 高 63px，左右 padding 19px                       |
| main       | max-width 1450px；padding 40px 44px 35px | padding 27px 18px 15px                           |
| 底部导航   | 隐藏                                     | 固定底部，高 65px，z-index 20；padding 9px 0 6px |
| 首页统计   | 四列，gap 18px                           | 两列，gap 11px                                   |
| 首页主体   | 1.45fr/1fr，gap 23px                     | 单列，网格 gap 0，靠子项 margin 分隔             |
| 设置主体   | 1fr/1.15fr，gap 25px                     | 单列，gap 0                                      |
| 分类分组   | 两列，gap 24px                           | 单列                                             |
| 复习工作区 | minmax(0,1fr)/230px，gap 40px            | 单列，侧栏隐藏                                   |

源码断点为 min-width 1500px，及 max-width 1200、900、620、600px。1200/900 时侧栏依次变成 205/175px；900 以下多数工作区改为单列。620 负责手机壳、导航、字号和内边距；600 另管按钮最小高度、评分两列和 AI 操作区，二者不是同一断点。

编辑/详情通用布局为主栏加 290px 辅栏、gap 25px；≤1200 辅栏变成 245px，≤900 单列。**实际新建流程特例**：录入材料步骤的 `.editor-fields[data-capture-step="0"]` 本身改为单列，故 1440 实测也不是两栏。375 下步骤导航三列、gap 6px；类型选择四列、gap 6px、按钮内边距 4px 2px；步骤面板 padding 12px。

资料库筛选在桌面是 flex wrap；375 下改为两列 grid，类型/标签/清除操作跨整行，select 最小高度 44px。实测每列 142px。详情对比、附件网格、表格横向滚动均有局部响应规则，不是全站通用网格。

### 间距记录

前置 `spacing` 是复用数值的记录，代码尚无 `--spacing-*` token。常见 inline gap 为 8/10/12px，列表行 gap 15px，面板间距 23/24/25px；不是严格的 4px 或 8px 倍数系统。

- 普通 panel padding 23px，表单 panel 27px，统计卡 20px 22px 17px。
- 375 下普通/表单 panel 多为 19px，统计卡 15px 16px，筛选面板 15px；步骤面板另为 12px。
- 页面标题区 margin-bottom 28px → 23px；普通 panel margin-bottom 23px → 20px。
- 表单 label margin 18px 0 8px，嵌套控件 margin-top 7px；字典行 padding 14px 0，资料行 18px 0 → 16px 0。

## Elevation & Depth

页面以背景色、白色容器和 1px 边界组织层级。实测普通 panel、统计卡、按钮、表单控件的 box-shadow 均为 `none`，没有通用卡片阴影。

源码中只有两类显式 box-shadow：首页装饰纸张 `0 12px 20px #173d3a20`，以及 toast `0 8px 35px #183b3229`。纸张阴影属于首页插画特例；toast 是浮层反馈，不能推广为面板阴影。

375 底部导航为 `#fbfcf8f5` 半透明底色配 `backdrop-filter: blur(12px)`；实测返回 `rgba(251,252,248,0.96)`。toast z-index 100，桌面距底 30px、手机 80px；跳过链接 z-index 1000。没有从现有代码提取出统一 elevation 级别。

## Shapes

圆角同样没有 CSS 变量：常用控件 7px、白色面板 9px、badge 5px；这是重复用法，不是全站只有三档。

页面/组件特例包括：分页与小标签 4px、图片 6px、上传区/类型图标/材料预览 8px、横幅 10px、品牌图标 11px、AI 结果与 options editor 12px；头像、状态点、附件删除图标使用 50%。

边框以 1px solid 为主：panel 用 `--line`，输入框用 `input-border`，描边按钮用 `outline-border`。上传区是 1px dashed `#cbd9c0`；选中页签是 2px 主绿底边，分析小标题为 3px 浅绿左边。边界色和粗细按组件定义，未集中 token 化。

## Components

### 按钮

主按钮见前置 component token；字号默认继承正文，500，gap 9px，transition `all 0.15s ease`。small 为 12px、padding 8px 13px；text-button 为透明无边框、主绿文字、padding 6px；icon-button 为透明、padding 7px、文字 `#7c8a80`。

| 状态           | 现有表现与证据                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------- |
| 主按钮 hover   | 源码：变为 `button-hover`，上移 1px                                                                |
| 描边 hover     | 源码：填充 `outline-hover`，同样上移 1px                                                           |
| 浅色按钮 hover | 源码层叠：后声明的 `.button.light` 保留浅色底和深绿文字，只继承上移；不能套用主按钮的深绿 hover 底 |
| focus-visible  | 实测：3px solid 主绿，outline-offset 3px                                                           |
| disabled       | 实测按钮 opacity 0.45；源码 cursor not-allowed，没有通用的 disabled 颜色组                         |
| active/pressed | 没有统一 `:active` 视觉规则；不虚构按下色                                                          |

375 下 `.button`、`.text-button`、summary 最小高度 44px；但后声明的字典按钮最小高度 32px 会覆盖它，实测禁用排序按钮为 32px。icon-button、普通分页按钮并未统一纳入 44px 规则。

### 输入与焦点

input/select/textarea 都是白底、7px 圆角、1px 输入边框、padding 11px 12px、width 100%，font inherit；textarea line-height 1.8，可纵向缩放。

源码基础 `:focus` 设置 2px 浅绿 `#b0c6b3` outline 和主绿 border；更靠后的全局 `:focus-visible` 将 outline 覆盖为 3px 主绿、offset 3px。此次实测 textarea 聚焦确实为 **3px 主绿轮廓 + 1px 主绿边框**。键盘 Tab 聚焦 skip-link 也实测相同的 3px 轮廓。

没有统一 input/select/textarea disabled 外观，也没有统一字段 error 边框状态；错误主要通过 `.error` 提示块表达。password-toggle 有局部 2px focus-visible 声明，但后续全局规则同等特异性且更晚，最终以全局 3px 为准。上传 label 单独有 3px `:focus-within`。

### 容器、标签与列表

panel 为白底、1px 分隔边、9px 圆角；form-panel 主要改变 padding 和标题/标签排版。stat 同为 9px，无阴影；源码 hover 边框变 `#becfbc`、上移 2px、transition 0.2s。

badge 见前置 token；手机资料行内 badge 单独变为 9px、padding 3px 7px，不改变全局 badge。资料列表以底部分隔线和行内留白为主，不给每条资料新增独立阴影。

### 导航

桌面侧栏链接为 13px，padding 12px 17px，gap 13px，7px 圆角。选中项有浅绿底、深绿字、600 字重和左侧 3px 指示条；hover 背景 `#f0f3ec`。由于 hover 规则更晚，选中项被悬停时底色也会替换，字色和指示条保留（源码层叠）。

手机改为底部图标/文字纵排，字号 9px、gap 3px，图标 20px、stroke-width 1.7，字色 `#7d9370`。现有 CSS 未提供独立的 mobile active 视觉规则，与桌面明确的选中表达不一致。

### 类型、复习评分与页签

类型选择实测 selected 使用 `#eff5e9` 底、`#6a916d` 边。类型按钮 disabled 特例将整按钮 opacity 恢复为 1，只把内部图标设为 0.45，不能用通用禁用透明度解释它。

以下仅据源码：评分默认底 `#fafbf7`、字 `#506445`、7px 圆角，padding 15px 5px；selected 为底 `#eef5e5`、边 `#81a36b`、字 `#527541`。桌面四列，≤600 两列、最小高 72px。页签默认 12px、gap 22px，选中主绿并有 2px 下划线；≤620 字号 10px、gap 16px。不同选择器的选中绿系没有共用语义 token。

### 提示与动效

错误提示及 toast 外观见 Colors、Elevation；本次没有为了展示状态制造错误或提交成功消息。AI 结果（源码）为浅底 `#f4f6f1`、12px 圆角、padding 18px；材料预览为 `#f6f8f5`、8px 圆角、padding 12px。

交互位移仅见按钮上移 1px、统计卡上移 2px。`prefers-reduced-motion: reduce` 将 animation-duration 和 transition-duration 设为 0.01ms，并将 scroll-behavior 改为 auto；没有统一 easing/duration 变量。

## Do's and Don'ts

### Do

- **Do** 优先遵循现有 CSS 和实际 computed style；同名标签的页面类覆盖应保留记录。
- **Do** 区分七个全局颜色变量、一个衬线字体变量与此文提取的固定值；前置 token 表不会自动创建 CSS 变量。
- **Do** 将首页横幅、登录叙事区、复习侧栏、AI 结果、步骤导航视作有明确作用域的特例。
- **Do** 记录已存在的不一致：多个近似绿灰、15/17/18px 的 h2 角色、非等比字号和间距、7/8/9/10/11/12px 并存圆角、32/44px 按钮高度、桌面/手机选中导航差异、局部与全局 focus 层叠。

### Don't

- **Don't** 把上述差异描述为已经统一，也不在 document 过程中修改代码来消除它们。
- **Don't** 因为品牌描述有“衬线标题”，就把实际无衬线 h1 记为衬线；不把 `--pale` 当作现用选中底色。
- **Don't** 给普通卡片补写阴影、统一按下色、字段 error/disabled 样式或源码不存在的 token。
- **Don't** 将 375 浏览器重排视为手机真机兼容性验收，或将 PRODUCT.md 的对比度目标当作当前界面已通过的结论。
