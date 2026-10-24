# 研习本

一个本地运行的考研学习记录与复习应用，使用 Next.js、React、TypeScript 和 SQLite 开发。当前为本机试用版。

## 主要功能

- 收集数学、408、生词和长难句，支持图片、Markdown 与公式。
- 用标签、知识点和关联整理材料，记录错因与修改历史。
- 安排复习、主动练习，查看学习统计。
- 备份与恢复数据，导出 Markdown 阅读包。
- 可选 AI 辅助：截图识别、整理、提示、作答点评和学习诊断。

## 快速开始

需要 Node.js `>=24.19.0 <25` 和 npm `11.x`。

```powershell
npm ci
npm run init
npm run dev
```

打开 <http://127.0.0.1:3000>。初始用户名为 `student`，随机密码保存在本机 `data/credentials/随机UUID.txt`（init 输出路径，不输出密码）；登录后可在设置中修改密码，私密交付后删除对应凭据文件。

应用默认仅本机访问，尚未完成公网部署验收。可选配置见 [.env.example](.env.example)；AI 服务需自行配置，调用可能产生费用。

## 数据与备份

数据保存在本机 `data/`。请定期在设置页导出完整备份；备份 ZIP 为明文，应妥善保管。数据库、附件、密钥和真实环境配置均不应提交到 Git。

## 开发与文档

```powershell
npm run lint
npm run typecheck
npm test
```

- [使用与维护指南](docs/USAGE.md)：使用流程、AI 配置、备份恢复和维护。
- [受邀实例部署与运维](docs/DEPLOYMENT.md)：单机 SQLite / Caddy / systemd、多账号 CLI、加密异地备份、完整恢复、发布与回退；目前待正式服务器验收。
- [本次上线准备验收](docs/LAUNCH-VERIFICATION-20261024.md) · [上线清单](docs/LAUNCH-CHECKLIST.md)。
- [文档索引](docs/README.md)：需求、架构与验收记录。
- [贡献说明](CONTRIBUTING.md) · [安全说明](SECURITY.md)。

## 许可证

项目尚未指定开源许可证。
