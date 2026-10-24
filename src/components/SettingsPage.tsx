"use client";
import { AiPrices } from "./AiPrices";
import { AiBudget } from "./AiBudget";
import { RestoreWizard } from "./RestoreWizard";
import { useState } from "react";

import { Check, FileText, Download } from "lucide-react";

import { AiSettings } from "./AiTools";

import { AiHistory } from "./AiHistory";

import { defaults } from "../lib/model";
import { requestResponse } from "../lib/request";
import { api } from "../lib/request";
import { ErrorBox } from "./ui";
export default function SettingsPage({
  profile,
  onSave,
  notify,
}: {
  profile: typeof defaults;
  onSave: (p: typeof defaults) => void;
  notify: (s: string) => void;
}) {
  const [s, setS] = useState(profile),
    [intervals, setIntervals] = useState(profile.intervals.join(",")),
    [error, setError] = useState(""),
    [password, setPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [exportPassword, setExportPassword] = useState(""),
    [busy, setBusy] = useState(false);
  async function download(type: string) {
    setBusy(true);
    setError("");
    try {
      const r = await requestResponse("exports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "yanxiben",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ type, password: exportPassword }),
      });
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `yanxiben-${type.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("导出已生成并开始下载");
      if (type === "BACKUP")
        window.dispatchEvent(new Event("backup-generated"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE ROOM FOR YOUR OWN RHYTHM</div>
          <h1>按自己的节奏，慢慢来。</h1>
          <p>调整学习偏好，也为积累留一份可靠的备份。</p>
        </div>
      </div>
      <ErrorBox text={error} />
      <AiSettings />
      <AiPrices />
      <AiBudget />
      <RestoreWizard />
      <details className="panel form-panel">
        <summary>查看 AI 调用历史与反馈</summary>
        <AiHistory />
      </details>
      <div className="settings-grid">
        <form
          className="panel form-panel"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const v = await api<typeof defaults>(
                "settings",
                { ...s, intervals: intervals.split(/[,，]/).map(Number) },
                "PATCH",
              );
              onSave(v);
              notify("学习设置已保存");
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <h2>学习偏好</h2>
          <label>
            怎么称呼你
            <input
              value={s.displayName}
              onChange={(e) => setS({ ...s, displayName: e.target.value })}
              required
            />
          </label>
          <label>
            时区
            <input
              value={s.timezone}
              onChange={(e) => setS({ ...s, timezone: e.target.value })}
              placeholder="Asia/Shanghai"
            />
          </label>
          <p className="tip">时区改变不会移动已有到期日期。</p>
          <label>
            每日复习展示上限
            <input
              type="number"
              min={1}
              max={200}
              value={s.dailyLimit}
              onChange={(e) =>
                setS({ ...s, dailyLimit: Number(e.target.value) })
              }
            />
          </label>
          <label>
            复习间隔（6 个递增天数）
            <input
              value={intervals}
              onChange={(e) => setIntervals(e.target.value)}
            />
          </label>
          <p className="tip">
            初始为 1、3、7、14、30、60
            天。其余到期任务会保留，不会因展示上限丢失。
          </p>
          <button className="button">
            保存设置
            <Check size={16} />
          </button>
        </form>
        <div>
          <section className="panel form-panel">
            <h2>把积累，妥善保存</h2>
            <p className="muted">
              完整备份包含结构化记录、附件、关联与复习历史；阅读导出包含
              Markdown 和相对路径图片。
            </p>
            <label>
              验证当前密码
              <input
                type="password"
                value={exportPassword}
                onChange={(e) => setExportPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <div className="export-actions">
              <button
                className="button"
                disabled={busy || !exportPassword}
                onClick={() => download("BACKUP")}
              >
                <Download size={17} />
                完整备份 ZIP
              </button>
              <button
                className="button outline"
                disabled={busy || !exportPassword}
                onClick={() => download("MARKDOWN")}
              >
                <FileText size={17} />
                Markdown 导出
              </button>
            </div>
            <div className="tip">
              可使用上方恢复向导校验 ZIP
              并打开独立学习空间；命令行恢复步骤保留在项目 README。
            </div>
          </section>
          <form
            className="panel form-panel"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("auth/password", {
                  current: password,
                  password: newPassword,
                });
                setPassword("");
                setNewPassword("");
                setError("");
                notify("密码已修改，其他会话已退出");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <h2>账号与安全</h2>
            <label>
              当前密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              新密码（至少 12 位）
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={12}
                required
              />
            </label>
            <button className="button outline">修改密码</button>
          </form>
        </div>
      </div>
    </>
  );
}
