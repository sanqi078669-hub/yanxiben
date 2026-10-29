# 登录页试点资产

## 字体

- 文件：`fonts/noto-serif-sc-headings.woff2`，8,516 bytes。
- Noto Serif SC 可变字体，字重 500–600；只包含登录页中文品牌与标题用字。
- 来源、下载地址及完整子集文字见 `fonts/source.json`；许可见 `fonts/OFL.txt`（SIL OFL 1.1）。
- 字体由应用同源自托管，运行时不请求 Google Fonts。正文使用系统无衬线字体。
- 修改衬线标题文案时应重新生成子集；子集外文字回退到系统衬线字体。

## 插图

- 文件：`study-engraving.webp`，960 × 640，81,014 bytes（小于 200 KB）。
- 来源：2026-10-29 使用内置 imagegen 为本登录页单独生成的书本版画；不是风格稿截图裁片，也不引用临时生成目录。
- 处理：原图等比缩小至 960px 宽，使用 sharp 编码为 WebP，quality 84、effort 6。
- 用途：纯装饰，空 alt；375px 手机布局隐藏。
- 生成提示词如下。

```text
Use case: illustration-story.
Asset type: production decorative illustration for a cream-paper Chinese private study notebook login page, "研习刊" visual direction.
Create a single isolated monochrome engraving of an open study notebook resting on two loose study sheets, with one simple pencil across the lower foreground. Authentic finely cut wood engraving or antique scholarly book engraving, entirely dark forest green #28624C ink on perfectly flat warm cream #F5F1E8 background. No other colors. Landscape 3:2 composition, generous empty cream margins (8% of frame), full objects completely visible. The opened notebook is viewed obliquely from slightly above, delicate cross hatching, restrained contrast, paper edges, subtle illegible pen strokes rather than readable words or equations. Calm precise academic editorial character. No photographic shading, no 3D render, no drop shadow or gradient background, no floral ornaments, no icons, no labels, no typography, no watermark, no UI elements, no border. Make it suitable at a displayed size 400px wide x 265px tall. Flat cream backdrop must stay uniform to blend directly into the web page.
```
