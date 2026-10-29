"use client";
import DictionaryManager from "./DictionaryManager";
import { AiPrices } from "./AiPrices";
import { AiBudget } from "./AiBudget";
import { RestoreWizard } from "./RestoreWizard";
import { useEffect, useState } from "react";

import { Check, FileText, Download } from "lucide-react";

import { AiSettings } from "./AiTools";

import { AiHistory } from "./AiHistory";

import { defaults } from "../lib/model";
import { requestResponse, readDownload } from "../lib/request";
import { api } from "../lib/request";
import { ErrorBox } from "./ui";
import PasswordInput from "./PasswordInput";
import {
  newPasswordSchema,
  newPasswordHint,
  passwordBytes,
} from "../lib/password-policy";
export default function SettingsPage({
  profile,
  onSave,
  notify,
}: {
  profile: typeof defaults;
  onSave: (p: typeof defaults) => void;
  notify: (s: string) => void;
}) {
  const [capacity, setCapacity] = useState<{
    bytes: number;
    limit: number;
    warning: boolean;
    restoreMode: string;
  } | null>(null);
  useEffect(() => {
    api<{
      bytes: number;
      limit: number;
      warning: boolean;
      restoreMode: string;
    }>("data/capacity")
      .then(setCapacity)
      .catch(() => {});
  }, []);
  const [s, setS] = useState(profile),
    [intervals, setIntervals] = useState(profile.intervals.join(",")),
    [error, setError] = useState(""),
    [password, setPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [confirmPasswordError, setConfirmPasswordError] = useState(""),
    [exportPassword, setExportPassword] = useState(""),
    [exportKeys, setExportKeys] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [downloadProgress, setDownloadProgress] = useState("");
  async function download(type: string) {
    const key = exportKeys[type] || crypto.randomUUID();
    setExportKeys((keys) => ({ ...keys, [type]: key }));
    setBusy(true);
    setDownloadProgress("正在生成导出…");
    setError("");
    try {
      const r = await requestResponse("exports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "yanxiben",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ type, password: exportPassword }),
      });
      const blob = await readDownload(r, (bytes, total) =>
        setDownloadProgress(
          total
            ? `下载中 ${Math.floor((bytes / total) * 100)}%`
            : `已接收 ${(bytes / 1048576).toFixed(1)} MiB`,
        ),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `yanxiben-${type.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setExportKeys((keys) => {
        const next = { ...keys };
        delete next[type];
        return next;
      });
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("导出已生成并开始下载");
      if (type === "BACKUP")
        window.dispatchEvent(new Event("backup-generated"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setDownloadProgress("");
    }
  }
  return (
    <div className="journal-settings">
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE ROOM FOR YOUR OWN RHYTHM</div>
          <h1>按自己的节奏，慢慢来。</h1>
          <p>调整学习偏好，也为积累留一份可靠的备份。</p>
        </div>
      </div>
      <ErrorBox text={error} />
      {downloadProgress && <p role="status">{downloadProgress}</p>}
      {capacity && (
        <section
          className="panel capacity-section"
          aria-labelledby="journal-capacity-title"
        >
          <h2 id="journal-capacity-title">账号容量</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">项目</th>
                <th scope="col">容量</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">当前账号数据</th>
                <td>{(capacity.bytes / 1048576).toFixed(1)} MiB</td>
              </tr>
              <tr>
                <th scope="row">受邀实例维护上限</th>
                <td>{(capacity.limit / 1048576).toFixed(0)} MiB</td>
              </tr>
            </tbody>
          </table>
          <progress
            aria-label="当前账号数据占维护上限"
            value={capacity.bytes}
            max={capacity.limit}
          />
          <p className="tip">
            当前账号数据约 {(capacity.bytes / 1048576).toFixed(1)}{" "}
            MiB。正式受邀实例维护上限 80 MiB（含历史和附件），60 MiB 起预警。
            {capacity.warning ? "已接近上限，请导出并联系维护人。" : ""}单附件
            10 MiB；学习 ZIP 200 MiB；解压 500 MiB。
          </p>
        </section>
      )}
      <DictionaryManager />
      <AiSettings />
      <AiPrices />
      <AiBudget />
      {capacity?.restoreMode === "admin" ? (
        <section className="panel form-panel">
          <h2>恢复学习数据</h2>
          <p>
            请联系维护人，通过私密渠道交付备份。管理员会在隔离环境校验并安排恢复，不会覆盖现用题库。
          </p>
        </section>
      ) : capacity ? (
        <RestoreWizard />
      ) : null}
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
              <PasswordInput
                aria-label="验证当前密码"
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
              恢复方式见上方说明。ZIP 是当前账号的学习导出，不包含账号认证或 AI
              密钥；实例灾难恢复由维护人负责。
            </div>
          </section>
          <form
            className="panel form-panel"
            onSubmit={async (e) => {
              e.preventDefault();
              if (newPassword !== confirmPassword) {
                setConfirmPasswordError("两次输入的新密码不一致");
                return;
              }
              setConfirmPasswordError("");
              try {
                newPasswordSchema.parse(newPassword);
                await api("auth/password", {
                  current: password,
                  password: newPassword,
                });
                setPassword("");
                setNewPassword("");
                setConfirmPassword("");
                setConfirmPasswordError("");
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
              <PasswordInput
                aria-label="当前密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              新密码（至少 12 位）
              <PasswordInput
                aria-label="新密码（至少 12 位）"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={12}
                required
              />
            </label>
            <p className="tip">
              {newPasswordHint}。当前 {passwordBytes(newPassword)} 字节。
            </p>
            <label>
              确认新密码
              <PasswordInput
                aria-label="确认新密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                aria-invalid={!!confirmPasswordError}
                aria-describedby={
                  confirmPasswordError ? "confirm-password-error" : undefined
                }
                required
              />
            </label>
            <ErrorBox text={confirmPasswordError} id="confirm-password-error" />
            <button className="button outline">修改密码</button>
          </form>
        </div>
      </div>
    </div>
  );
}
