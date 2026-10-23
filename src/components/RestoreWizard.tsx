"use client";
import { useEffect, useState } from "react";
import { api } from "./NotebookShared";
type Preview = {
  id: string;
  counts: Record<string, number>;
  folder: string;
  username: string;
};
const labels: Record<string, string> = {
  entries: "学习记录",
  attachments: "附件",
  knowledge: "知识点",
  relations: "关联",
  reviews: "复习计划",
  logs: "作答历史",
  revisions: "内容版本",
  idempotency: "提交去重记录",
  knowledge_aliases: "知识点别名",
  knowledge_merges: "知识点合并记录",
  ai_audit: "AI 调用与反馈",
  ai_audit_extras: "费用依据",
};
export function RestoreWizard() {
  const [last, setLast] = useState<string | null>(null),
    [file, setFile] = useState<File | null>(null),
    [password, setPassword] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () =>
      api<{ created: string | null }>("data/backup-status")
        .then((r) => setLast(r.created))
        .catch((e) => setError(e.message));
    refresh();
    window.addEventListener("backup-generated", refresh);
    return () => window.removeEventListener("backup-generated", refresh);
  }, []);
  return (
    <section className="panel form-panel">
      <h2>备份状态与恢复向导</h2>
      <p>
        上次生成完整备份：{last ? new Date(last).toLocaleString() : "尚无记录"}
        。生成记录不代表 ZIP 已保存到安全位置，请核对下载文件。
      </p>
      {(!last || Date.now() - Date.parse(last) > 7 * 86400000) && (
        <p role="status">
          建议现在生成一份完整备份，并保存在本机以外的安全位置。
        </p>
      )}
      <details>
        <summary>从完整备份恢复到独立空间</summary>
        <p>
          恢复向导先在独立目录校验数据、附件摘要和关联，再打开独立学习空间。当前数据保留，恢复失败可继续使用原空间。学习备份包含
          AI 建议与反馈，不包含模型密钥和价格配置。
        </p>
        <fieldset disabled={busy}>
          <label>
            选择完整备份 ZIP
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setPreview(null);
                setUrl("");
              }}
            />
          </label>
          <label>
            验证当前密码
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            className="button outline"
            disabled={!file || !password}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const form = new FormData();
                form.set("file", file!);
                form.set("password", password);
                const r = await fetch("/api/v1/data/restore-preview", {
                  method: "POST",
                  headers: { "X-Requested-With": "yanxiben" },
                  body: form,
                });
                const b = await r.json();
                if (!r.ok) throw new Error(b.error?.message || "恢复校验失败");
                setPreview(b.data);
                setPassword("");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            校验并预览恢复内容
          </button>
          {preview && (
            <div>
              <h3>隔离恢复已通过校验</h3>
              <ul>
                {Object.entries(preview.counts).map(([name, count]) => (
                  <li key={name}>
                    {labels[name] || name}：{count}
                  </li>
                ))}
              </ul>
              <p>
                新空间登录账号：{preview.username}，使用当前账号密码。恢复目录：
                {preview.folder}
                。打开后可在设置中配置模型密钥；返回原浏览器标签页即可回退。
              </p>
              <button
                className="button"
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const r = await api<{ url: string }>(
                      "data/restore-launch",
                      { id: preview.id, confirm: true },
                    );
                    setUrl(r.url);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                确认启动恢复后的独立空间
              </button>
            </div>
          )}
        </fieldset>
      </details>
      {busy && <p role="status">正在处理恢复，请保持页面打开…</p>}
      {error && <p role="alert">{error}</p>}
      {url && (
        <p role="status">
          恢复服务已启动：
          <a className="button" href={url} target="_blank" rel="noreferrer">
            打开恢复后的学习空间
          </a>{" "}
          <button
            className="button outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("data/restore-stop", { id: preview!.id });
                setUrl("");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            停止隔离服务（保留数据）
          </button>
        </p>
      )}
    </section>
  );
}
