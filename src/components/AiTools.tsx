"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { providerPresets } from "../modules/ai/presets";
import { extractionPatch, type Extraction } from "../modules/ai/contracts";
import { names, type EntryInput } from "../lib/model";

import { api } from "../lib/request";
export function aiApi(path: string, body?: unknown) {
  const target = (body as { target?: string } | undefined)?.target;
  return api(
    "ai/" + path,
    body,
    undefined,
    target ? { "X-AI-Target": target } : undefined,
  );
}
export function AiSettings() {
  const [config, setConfig] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const empty = () => ({
    id: crypto.randomUUID(),
    name: "",
    base: "",
    model: "",
    vision: false,
    tokenParameter: "max_tokens",
    maxOutputTokens: 4000,
    key: "",
  });
  const [draft, setDraft] = useState<ReturnType<typeof empty> | null>(null);
  useEffect(() => {
    aiApi("config")
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  async function command(body: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setConfig(await aiApi("config", body));
      setMessage("模型配置已保存");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel form-panel ai-panel">
      <h2>AI 模型与服务</h2>
      <p>
        支持 OpenAI 兼容接口，可分别配置
        DeepSeek、OpenAI、通义千问、Kimi、豆包等服务的兼容端点。模型名称和图片能力以服务商为准。
      </p>
      <p className="muted">
        密钥加密保存在本机服务端，不会返回浏览器或包含在学习备份中。主动使用 AI
        时，所选材料会发送至当前服务商，可能产生费用。
      </p>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!config ? (
        <p>正在读取配置…</p>
      ) : (
        <>
          <label>
            当前模型
            <select
              value={config.activeId || ""}
              disabled={busy}
              onChange={(e) =>
                command({ action: "activate", id: e.target.value || null })
              }
            >
              <option value="">关闭 AI</option>
              {config.profiles.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.model}
                </option>
              ))}
            </select>
          </label>
          <div className="ai-actions">
            <button
              className="text-button"
              disabled={
                busy ||
                !config.activeId ||
                !config.profiles.find((p: any) => p.id === config.activeId)
                  ?.vision
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                setMessage("");
                try {
                  await aiApi("test", { vision: true });
                  setMessage(
                    "图片能力测试通过：模型识别了系统生成的蓝色色块。此测试不代表所有图片都能正确识别。",
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              测试图片能力（固定色块）
            </button>
            <button
              className="button outline"
              disabled={busy}
              onClick={() => setDraft(empty())}
            >
              添加模型配置
            </button>
            <button
              className="text-button"
              disabled={busy || !config.activeId}
              onClick={async () => {
                setBusy(true);
                setError("");
                setMessage("");
                try {
                  await aiApi("test", {});
                  setMessage("真实连接测试通过（仅发送固定测试文本）");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              测试当前连接
            </button>
          </div>
          {config.profiles.map((p: any) => (
            <div className="ai-profile" key={p.id}>
              <b>{p.name}</b>
              <span>
                {p.model} · {new URL(p.base).host} ·{" "}
                {p.vision ? "支持图片" : "仅文本"} · 输出上限{" "}
                {p.maxOutputTokens} tokens
              </span>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setDraft({ ...p, key: "" })}
              >
                编辑
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => command({ action: "remove", id: p.id })}
              >
                移除配置
              </button>
            </div>
          ))}
        </>
      )}
      {draft && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const {
              id,
              name,
              base,
              model,
              vision,
              tokenParameter,
              maxOutputTokens,
              key,
            } = draft;
            if (
              await command({
                action: "save",
                profile: {
                  id,
                  name,
                  base,
                  model,
                  vision,
                  tokenParameter,
                  maxOutputTokens,
                  key,
                },
              })
            )
              setDraft(null);
          }}
        >
          <label>
            从服务商预设填入
            <select
              defaultValue=""
              onChange={(e) => {
                const preset = providerPresets.find(
                  (p) => p.name === e.target.value,
                );
                if (preset)
                  setDraft({
                    ...draft,
                    name: preset.name,
                    base: preset.base,
                    model: preset.model,
                    tokenParameter: preset.tokenParameter,
                    vision: false,
                    key: "",
                  });
              }}
            >
              <option value="">自定义 / 请选择</option>
              {providerPresets.map((p) => (
                <option key={p.name}>{p.name}</option>
              ))}
            </select>
          </label>
          <p className="muted">
            预设仅填入兼容地址；切换预设会清空待填密钥。模型名称、地区和图片能力请核对服务商文档，保存并启用后再测试。仅
            DeepSeek 已完成本项目真实调用验收。
          </p>
          <details>
            <summary>服务商官方配置文档</summary>
            {providerPresets
              .filter((p, i, a) => a.findIndex((x) => x.docs === p.docs) === i)
              .map((p) => (
                <p key={p.name}>
                  <a href={p.docs} target="_blank" rel="noreferrer">
                    {p.name}
                  </a>
                </p>
              ))}
          </details>
          <label>
            配置名称
            <input
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="例如：DeepSeek 学习助手"
            />
          </label>
          <label>
            接口基础地址
            <input
              required
              type="url"
              value={draft.base}
              onChange={(e) => setDraft({ ...draft, base: e.target.value })}
              placeholder="https://api.deepseek.com"
            />
          </label>
          <label>
            模型名称
            <input
              required
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              placeholder="填写服务商提供的模型 ID"
            />
          </label>
          <label>
            API Key（已保存的配置留空可保留）
            <input
              type="password"
              autoComplete="new-password"
              value={draft.key}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.vision}
              onChange={(e) => setDraft({ ...draft, vision: e.target.checked })}
            />
            此模型支持图片输入
          </label>
          <label>
            输出长度参数
            <select
              value={draft.tokenParameter}
              onChange={(e) =>
                setDraft({ ...draft, tokenParameter: e.target.value })
              }
            >
              <option value="max_tokens">max_tokens（多数兼容服务）</option>
              <option value="max_completion_tokens">
                max_completion_tokens（OpenAI 新模型）
              </option>
            </select>
          </label>
          <label>
            输出 token 上限
            <select
              value={draft.maxOutputTokens}
              onChange={(e) =>
                setDraft({ ...draft, maxOutputTokens: Number(e.target.value) })
              }
            >
              <option value={4000}>4,000（默认）</option>
              <option value={8000}>8,000</option>
              <option value={16000}>16,000</option>
            </select>
          </label>
          <p className="muted">
            请确认模型支持所选上限；提高上限可能增加费用与等待时间。截断不会自动重试或写入学习内容。
          </p>
          <div className="ai-actions">
            <button className="button" disabled={busy}>
              保存配置
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setDraft(null)}
            >
              取消
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export function AiExtract({
  entry,
  existing,
  onApply,
}: {
  entry: EntryInput;
  existing: boolean;
  onApply: (patch: Partial<EntryInput>) => void;
}) {
  const [status, setStatus] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [result, setResult] = useState<Extraction | null>(null);
  const [snapshot, setSnapshot] = useState("");
  const current = JSON.stringify(entry);
  useEffect(() => {
    aiApi("status")
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);
  const images = entry.attachments.filter((a) => a.role === "PROMPT");
  return (
    <section className="panel form-panel ai-panel">
      <h2>AI 截图识别</h2>
      <p role="status">
        {busy
          ? "正在识别图片…"
          : result
            ? "图片识别完成，请检查题面和选项。"
            : ""}
      </p>
      <p>
        添加题目图片后，可识别题干、公式和选项。建议内容需要确认后才填入表单。
      </p>
      {!status?.ready ? (
        <p>
          <Link href="/settings">到设置配置 AI 模型</Link>
        </p>
      ) : (
        <>
          <p>
            当前：{status.model} · {status.host}
          </p>
          {!status.vision && (
            <p>当前模型未开启图片能力，请在设置中切换视觉模型。</p>
          )}
          <p>
            将发送 {images.length} 张题目图片（最多 3 张），不发送解析图片。
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            同意将上述图片发送至当前 AI 服务进行识别
          </label>
          <button
            className="button outline"
            disabled={
              busy ||
              !consent ||
              !status.vision ||
              !images.length ||
              images.length > 3
            }
            onClick={async () => {
              setSnapshot(current);
              setBusy(true);
              setError("");
              setResult(null);
              try {
                setResult(
                  await aiApi("extract", {
                    attachmentIds: images.map((a) => a.id),
                    target: status.target,
                    consent: true,
                  }),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在识别…" : "识别图片"}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {result && (
        <div className="ai-result">
          <p>
            <b>识别建议 · 请核对</b> · {names[result.type] ?? result.type} ·{" "}
            {result.subject}
          </p>
          <h3>{result.title}</h3>
          <pre>{result.body}</pre>
          {result.options.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
          {result.warnings.map((s, i) => (
            <p key={i} role="note">
              ⚠ {s}
            </p>
          ))}
          {snapshot !== current && (
            <p>表单已修改，请重新识别后再应用，避免覆盖新输入。</p>
          )}
          <button
            className="button"
            disabled={snapshot !== current}
            onClick={() => {
              try {
                const patch = extractionPatch(
                  result,
                  existing ? entry.type : undefined,
                );
                if (
                  !existing &&
                  entry.type !== result.type &&
                  (entry.body || Object.keys(entry.details).length)
                )
                  throw new Error(
                    "已有内容与识别模板不同，请先新建对应模板以保留原输入",
                  );
                onApply({
                  ...patch,
                  details: { ...entry.details, ...patch.details },
                });
                setResult(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            确认替换标题与题面、填入选项
          </button>
          <p className="muted">
            原图片保留；解析与原解法不会替换。已有记录沿用自动保存，新记录仍需手动保存。
          </p>
        </div>
      )}
    </section>
  );
}
