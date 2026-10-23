"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  Check,
  ChevronLeft,
  Upload,
  FileText,
  X,
  Eye,
} from "lucide-react";

import { AiExtract } from "./AiTools";
import { AiStudy } from "./AiStudy";

import { OptionsEditor } from "./OptionsEditor";
import { MaterialPreview } from "./MaterialPreview";
import { useEntryDraft } from "./useEntryDraft";

import {
  names,
  types,
  subjects,
  errors,
  fields,
  type Entry,
  type EntryInput,
} from "../lib/model";
import { api, MD, TypeIcon, Badge, useLoad, ErrorBox } from "./NotebookShared";
import { readEnvelope } from "../lib/request";
type Any = Record<string, any>;
const blank = (type: EntryInput["type"]): EntryInput => ({
  type,
  title: "",
  subject: type === "MATH" ? "高等数学" : type === "CS" ? "数据结构" : "英语",
  body: "",
  source: "",
  summary: "",
  status: "INBOX",
  details: {},
  contexts: [],
  knowledgeIds: [],
  tags: [],
  errors: [],
  attachments: [],
});
export default function Editor({
  id,
  notify,
}: {
  id?: string;
  notify: (s: string) => void;
}) {
  const [captureStep, setCaptureStep] = useState(0);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const router = useRouter(),
    params = useSearchParams();
  const initial = types.includes(params.get("type") as any)
    ? (params.get("type") as EntryInput["type"])
    : "MATH";
  const [e, setE] = useState<EntryInput>(blank(initial)),
    [version, setVersion] = useState(0),
    [loaded, setLoaded] = useState(!id),
    [loadError, setLoadError] = useState(""),
    [loadAttempt, setLoadAttempt] = useState(0),
    [state, setState] = useState("未保存"),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState<Entry | null>(null),
    [preview, setPreview] = useState(false),
    [uploading, setUploading] = useState(false),
    [busy, setBusy] = useState(false);
  const saved = useRef(JSON.stringify(e)),
    saving = useRef(false),
    dirty = useRef(false),
    latest = useRef(e);
  latest.current = e;
  const draft = useEntryDraft(
    e,
    id || "new",
    version,
    loaded && !loadError,
    saved.current,
  );
  const { data: nodes } = useLoad<any[]>(() => api("knowledge-nodes"));
  const { data: existingWords } = useLoad(
    () => api("entries?type=VOCABULARY&limit=100"),
    [],
  );
  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoaded(false);
    setLoadError("");
    api("entries/" + id)
      .then((r) => {
        if (!active) return;
        const base = blank(r.type);
        for (const key of Object.keys(base)) (base as Any)[key] = r[key];
        saved.current = JSON.stringify(base);
        setE(base);
        setVersion(r.version);
        setState("已保存到本地服务");
      })
      .catch((e) => {
        if (active) setLoadError(e.message);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [id, loadAttempt]);
  const save = useCallback(
    async (manual = false) => {
      if (
        !loaded ||
        loadError ||
        saving.current ||
        conflict ||
        draft.pending.length
      )
        return false;
      saving.current = true;
      setBusy(true);
      setError("");
      setState("保存中…");
      const snapshot = latest.current;
      const payload = {
        ...snapshot,
        tags: snapshot.tags.map((t) => t.trim()).filter(Boolean),
      };
      try {
        const result = await api(
          id ? "entries/" + id : "entries",
          id ? { ...payload, expectedVersion: version, manual } : payload,
          id ? "PATCH" : "POST",
        );
        saved.current = JSON.stringify(snapshot);
        draft.clear();
        setRestoredDraft(false);
        dirty.current = JSON.stringify(latest.current) !== saved.current;
        setVersion(result.version);
        setState(
          "已保存 · " +
            new Date().toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            }),
        );
        if (!id) {
          dirty.current = false;
          router.replace("/entries/" + result.id + "/edit");
        }
        return true;
      } catch (err) {
        setState("保存失败，输入保留在当前页面");
        setError((err as Error).message);
        if ((err as Any).code === "VERSION_CONFLICT" && id) {
          setConflict(await api("entries/" + id));
        }
        return false;
      } finally {
        saving.current = false;
        setBusy(false);
      }
    },
    [id, version, conflict, router, draft.pending.length, loaded, loadError],
  );
  useEffect(() => {
    if (!loaded || loadError) return;
    dirty.current = JSON.stringify(e) !== saved.current;
    if (
      !id ||
      !dirty.current ||
      conflict ||
      restoredDraft ||
      draft.pending.length
    )
      return;
    setState("尚有更改，等待保存…");
    const timer = setTimeout(() => save(false), 1500);
    return () => clearTimeout(timer);
  }, [
    e,
    loaded,
    loadError,
    id,
    save,
    conflict,
    restoredDraft,
    draft.pending.length,
  ]);
  useEffect(() => {
    const leave = (ev: BeforeUnloadEvent) => {
      if (dirty.current) {
        ev.preventDefault();
        ev.returnValue = "";
      }
    };
    const click = (ev: MouseEvent) => {
      if (
        dirty.current &&
        (ev.target as HTMLElement).closest("a[href]") &&
        !window.confirm("还有未保存的更改，确定离开吗？")
      ) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("click", click, true);
    };
  }, []);
  const change = (patch: Partial<EntryInput>) =>
    setE((v) => ({ ...v, ...patch }));
  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const xhr = new XMLHttpRequest();
      const result = await new Promise<Any>((resolve, reject) => {
        xhr.open("POST", "/api/v1/attachments");
        xhr.setRequestHeader("X-Requested-With", "yanxiben");
        xhr.upload.onprogress = (ev) =>
          setState(
            "图片上传中 " +
              (ev.lengthComputable
                ? Math.round((ev.loaded / ev.total) * 100)
                : 0) +
              "%",
          );
        xhr.onerror = () => reject(new Error("上传失败，请重新选择文件重试"));
        xhr.onload = () => {
          readEnvelope(
            new Response(xhr.responseText, {
              status: xhr.status,
              headers: {
                "Content-Type": xhr.getResponseHeader("Content-Type") || "",
                "X-Request-Id": xhr.getResponseHeader("X-Request-Id") || "",
              },
            }),
          ).then(resolve, reject);
        };
        xhr.send(form);
      });
      setE((v) => ({
        ...v,
        attachments: [...v.attachments, { id: result.id, role: "PROMPT" }],
      }));
      setState("图片已上传；请保存记录");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }
  if (!loaded)
    return (
      <>
        <ErrorBox text={error} />
        <div className="loading">正在读取记录…</div>
      </>
    );
  if (loadError)
    return (
      <section className="panel form-panel">
        <h1>无法读取这条记录</h1>
        <ErrorBox text={loadError} />
        <button className="button" onClick={() => setLoadAttempt((v) => v + 1)}>
          重试读取
        </button>
        <Link className="button outline" href="/library">
          返回资料库
        </Link>
      </section>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="back-link" href={id ? "/entries/" + id : "/inbox"}>
            <ChevronLeft size={16} />
            返回{id ? "记录" : "收集箱"}
          </Link>
          <h1>{id ? "让思路，变得清晰。" : "把这个疑问留下来。"}</h1>
          <p>文字或图片即可收集，完整分析可以之后补充。</p>
        </div>
        <div className="heading-actions">
          <span className="save-state" role="status">
            {state}
          </span>
          <button
            className="button"
            disabled={
              busy || uploading || !!conflict || draft.pending.length > 0
            }
            onClick={() =>
              !id && captureStep !== 2 ? setCaptureStep(2) : save(true)
            }
          >
            <Check size={17} />
            {id
              ? "保存记录"
              : captureStep === 2
                ? "确认保存到收集箱"
                : "核对后保存"}
          </button>
        </div>
      </div>
      <ErrorBox text={error} id="editor-error" />
      {draft.message && (
        <p role="status">{draft.message} 主动退出登录会清除本浏览器草稿。</p>
      )}
      {restoredDraft && (
        <p role="status">
          草稿已恢复，自动保存暂停。请核对后手动保存；服务器版本有变化时会提示冲突。
        </p>
      )}
      {draft.pending.map(({ key, draft: item }) => (
        <section className="panel form-panel" key={key}>
          <h2>
            发现未提交草稿 · {new Date(item.updated).toLocaleString("zh-CN")}
          </h2>
          <p>
            请选择恢复或舍弃后继续。草稿版本 {item.version}，当前记录版本{" "}
            {version}。
          </p>
          <details>
            <summary>比较草稿与当前内容</summary>
            <h3>未提交草稿</h3>
            <MaterialPreview material={item.entry} />
            <h3>当前内容</h3>
            <MaterialPreview material={e} />
          </details>
          <button
            className="button"
            onClick={() => {
              setE(item.entry);
              setVersion(item.version);
              setRestoredDraft(true);
              draft.dismiss(key);
            }}
          >
            恢复此草稿
          </button>
          <button className="text-button" onClick={() => draft.dismiss(key)}>
            舍弃此草稿
          </button>
        </section>
      ))}
      {conflict && (
        <section className="conflict panel">
          <h3>检测到另一份更新 · 服务器版本 {conflict.version}</h3>
          <p>
            你的输入未被替换。请比较后选择：以当前输入重新保存，或载入服务器内容。
          </p>
          <div className="comparison">
            <div>
              <h4>我的输入</h4>
              <MaterialPreview material={e} />
            </div>
            <div>
              <h4>服务器内容</h4>
              <MaterialPreview material={conflict} />
            </div>
          </div>
          <button
            className="button outline"
            onClick={() => {
              setVersion(conflict.version);
              setConflict(null);
              setState("已采用最新版本号，将保存当前输入");
            }}
          >
            保留我的输入并重试
          </button>
          <button
            className="text-button"
            onClick={() => {
              const base = blank(conflict.type);
              for (const key of Object.keys(base))
                (base as Any)[key] = (conflict as Any)[key];
              saved.current = JSON.stringify(base);
              setE(base);
              setVersion(conflict.version);
              setConflict(null);
            }}
          >
            载入服务器内容
          </button>
        </section>
      )}
      {!id && (
        <section className="panel form-panel" aria-label="录入步骤">
          <nav className="ai-actions" aria-label="选择录入步骤">
            {["1 · 录入材料", "2 · 整理分析（可跳过）", "3 · 核对保存"].map(
              (name, i) => (
                <button
                  key={name}
                  className={captureStep === i ? "button" : "button outline"}
                  aria-current={captureStep === i ? "step" : undefined}
                  onClick={() => setCaptureStep(i)}
                >
                  {name}
                </button>
              ),
            )}
          </nav>
          <p role="status">
            {
              [
                "先输入文字或上传图片；识别是可选步骤。",
                "可手动整理或请求 AI 建议，不需要分析时直接核对保存。",
                "请检查下方完整内容。确认保存后才会创建记录，不会自动加入复习。",
              ][captureStep]
            }
          </p>
          {captureStep < 2 && (
            <button
              className="text-button"
              onClick={() => setCaptureStep(captureStep + 1)}
            >
              下一步
            </button>
          )}
          {captureStep === 2 && <MaterialPreview material={e} />}
        </section>
      )}
      <fieldset
        className="editor-layout editor-fields"
        aria-label="记录内容"
        aria-describedby={error ? "editor-error" : undefined}
        data-capture-step={id ? "edit" : captureStep}
        disabled={busy && !id}
      >
        <div>
          <section className="panel form-panel capture-material">
            <div className="section-title">
              <h2>
                01 <span>原始材料</span>
              </h2>
              <button
                className="text-button"
                onClick={() => setPreview(!preview)}
              >
                <Eye size={16} />
                {preview ? "继续编辑" : "预览 Markdown"}
              </button>
            </div>
            <div className="type-picker">
              {types.map((t) => (
                <button
                  key={t}
                  disabled={!!id}
                  className={e.type === t ? "selected" : ""}
                  onClick={() => {
                    if (
                      e.type !== t &&
                      (e.body || Object.keys(e.details).length) &&
                      !confirm("切换模板将清空当前未保存内容，继续吗？")
                    )
                      return;
                    setE(blank(t));
                  }}
                >
                  <TypeIcon type={t} />
                  {names[t]}
                </button>
              ))}
            </div>
            <label>
              标题
              <input
                placeholder="为这次思考起个名字（选填）"
                value={e.title}
                onChange={(v) => change({ title: v.target.value })}
              />
            </label>
            <label>
              {e.type === "VOCABULARY"
                ? "词条 / 原句"
                : e.type === "SENTENCE"
                  ? "英文原句"
                  : "题目 / 疑问"}
              {preview ? (
                <MD>{e.body}</MD>
              ) : (
                <textarea
                  className="body-editor"
                  placeholder={
                    e.type === "MATH"
                      ? "输入题目，支持 Markdown、$公式$ 和代码块…"
                      : "输入或粘贴原文…"
                  }
                  value={e.body}
                  onChange={(v) => change({ body: v.target.value })}
                />
              )}
            </label>
            <div className="upload-area">
              <Upload size={23} />
              <div>
                <b>{uploading ? "正在上传图片…" : "添加题目截图或照片"}</b>
                <span>PNG / JPEG / WebP · 单张不超过 10 MB</span>
              </div>
              <label className="button outline small upload-label">
                选择图片
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploading || e.attachments.length >= 20}
                  onChange={(v) => {
                    if (v.target.files?.[0]) upload(v.target.files[0]);
                    v.target.value = "";
                  }}
                />
              </label>
            </div>
            <div className="attachment-grid">
              {e.attachments.map((a) => (
                <div key={a.id}>
                  <img
                    src={"/api/v1/attachments/" + a.id + "/content"}
                    alt="已上传图片"
                  />
                  <select
                    aria-label="图片用途"
                    value={a.role}
                    onChange={(v) =>
                      change({
                        attachments: e.attachments.map((x) =>
                          x.id === a.id
                            ? { ...x, role: v.target.value as any }
                            : x,
                        ),
                      })
                    }
                  >
                    <option value="PROMPT">题面图片</option>
                    <option value="ANSWER">答案图片（复习时隐藏）</option>
                  </select>
                  <button
                    className="icon-button"
                    aria-label="移除图片"
                    onClick={() =>
                      change({
                        attachments: e.attachments.filter((x) => x.id !== a.id),
                      })
                    }
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
            <AiExtract entry={e} existing={!!id} onApply={change} />
            <label>
              来源
              <input
                placeholder="例如：张宇高数 18 讲 · 第 3 讲 · 例 5"
                value={e.source}
                onChange={(v) => change({ source: v.target.value })}
              />
            </label>
          </section>
          <div className="capture-analysis">
            <AiStudy
              key={e.type}
              entry={e}
              actions={
                e.type === "VOCABULARY"
                  ? ["organize", "english"]
                  : e.type === "SENTENCE"
                    ? ["organize", "analyze", "english"]
                    : ["organize", "analyze"]
              }
              onApply={change}
            />
          </div>
          <section className="panel form-panel capture-analysis">
            <div className="section-title">
              <h2>
                02 <span>分析与理解</span>
              </h2>
              <Badge>允许稍后补充</Badge>
            </div>
            {e.type === "CS" && (
              <>
                <label>
                  类型
                  <select
                    value={e.details.subtype || "QUESTION"}
                    onChange={(v) =>
                      change({
                        details: { ...e.details, subtype: v.target.value },
                      })
                    }
                  >
                    <option value="QUESTION">题目</option>
                    <option value="CONCEPT">概念疑问</option>
                  </select>
                </label>
                <OptionsEditor
                  value={e.details.options_json || ""}
                  onChange={(options_json) =>
                    change({ details: { ...e.details, options_json } })
                  }
                />
              </>
            )}
            {fields[e.type].map(([key, label]) => (
              <label key={key}>
                {label}
                {preview ? (
                  <MD>{e.details[key]}</MD>
                ) : (
                  <textarea
                    rows={key === "lemma" || key === "part_of_speech" ? 1 : 3}
                    value={e.details[key] || ""}
                    placeholder={"记录" + label + "…"}
                    onChange={(v) =>
                      change({
                        details: { ...e.details, [key]: v.target.value },
                      })
                    }
                  />
                )}
              </label>
            ))}
            {e.type === "VOCABULARY" && (
              <>
                {existingWords?.items.some(
                  (x: Entry) =>
                    x.id !== id &&
                    x.details.lemma?.toLowerCase() ===
                      e.details.lemma?.toLowerCase() &&
                    x.details.part_of_speech === e.details.part_of_speech,
                ) && (
                  <p className="tip">
                    资料库中已有相同词条与词性，可追加语境，也可保留独立记录。
                  </p>
                )}
                {e.contexts.map((c, i) => (
                  <div className="context-card" key={i}>
                    <h3>
                      语境 {i + 1}
                      <button
                        className="text-button"
                        onClick={() =>
                          change({
                            contexts: e.contexts.filter((_, j) => i !== j),
                          })
                        }
                      >
                        移除
                      </button>
                    </h3>
                    {[
                      ["sentence_text", "原句"],
                      ["meaning_md", "语境词义"],
                      ["source", "出处"],
                      ["collocation", "搭配"],
                      ["sentence_entry_id", "关联长难句 ID（可选）"],
                    ].map(([k, l]) => (
                      <label key={k}>
                        {l}
                        <textarea
                          rows={2}
                          value={(c as Any)[k]}
                          onChange={(v) =>
                            change({
                              contexts: e.contexts.map((x, j) =>
                                j === i ? { ...x, [k]: v.target.value } : x,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                ))}
                <button
                  className="button outline"
                  onClick={() =>
                    change({
                      contexts: [
                        ...e.contexts,
                        {
                          sentence_text: "",
                          meaning_md: "",
                          source: "",
                          collocation: "",
                          sentence_entry_id: "",
                        },
                      ],
                    })
                  }
                >
                  <Plus size={17} />
                  添加语境
                </button>
              </>
            )}
            <label>
              一句话总结
              <textarea
                placeholder="下次遇到类似问题，我会先…"
                value={e.summary}
                onChange={(v) => change({ summary: v.target.value })}
              />
            </label>
          </section>
        </div>
        <aside className="editor-side">
          <section className="panel form-panel">
            <h3>归档这份思考</h3>
            <label>
              科目
              <select
                value={e.subject}
                onChange={(v) =>
                  change({ subject: v.target.value, knowledgeIds: [] })
                }
              >
                {(e.type === "MATH"
                  ? ["高等数学"]
                  : e.type === "CS"
                    ? subjects.slice(1, 5)
                    : ["英语"]
                ).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              整理状态
              <select
                value={e.status}
                onChange={(v) => change({ status: v.target.value as any })}
              >
                <option value="INBOX">待整理</option>
                <option value="ORGANIZED">已整理</option>
              </select>
            </label>
            <p className="tip">
              整理完成不会自动加入复习；保存后可在详情中安排计划。
            </p>
            <label>知识点</label>
            <div className="check-list">
              {nodes
                ?.filter(
                  (n) =>
                    n.subject === e.subject &&
                    (!n.archived || e.knowledgeIds.includes(n.id)),
                )
                .map((n) => (
                  <label key={n.id}>
                    <input
                      type="checkbox"
                      checked={e.knowledgeIds.includes(n.id)}
                      onChange={(v) =>
                        change({
                          knowledgeIds: v.target.checked
                            ? [...e.knowledgeIds, n.id]
                            : e.knowledgeIds.filter((k) => k !== n.id),
                        })
                      }
                    />
                    {n.name}
                    {n.archived ? "（已归档）" : ""}
                  </label>
                ))}
              {!nodes?.some((n) => n.subject === e.subject) && (
                <p className="muted">
                  还没有该科目的知识点。可在知识地图中添加。
                </p>
              )}
            </div>
            <label>错因（可多选）</label>
            <div className="chip-list">
              {errors.map((v) => (
                <button
                  key={v}
                  className={e.errors.includes(v) ? "chosen" : ""}
                  aria-pressed={e.errors.includes(v)}
                  onClick={() =>
                    change({
                      errors: e.errors.includes(v)
                        ? e.errors.filter((x) => x !== v)
                        : [...e.errors, v],
                    })
                  }
                >
                  {v}
                </button>
              ))}
            </div>
            <label>
              标签
              <input
                placeholder="用中文逗号或英文逗号分隔"
                value={e.tags.join("，")}
                onChange={(v) =>
                  change({ tags: v.target.value.split(/[,，]/) })
                }
                onBlur={() =>
                  change({ tags: e.tags.map((t) => t.trim()).filter(Boolean) })
                }
              />
            </label>
          </section>
          <div className="editor-note">
            <FileText size={22} />
            <h3>留住你的第一反应</h3>
            <p>
              不仅记下正确答案，也记下当时为什么会这样想。理解错误，是理解知识的开始。
            </p>
          </div>
        </aside>
      </fieldset>
    </>
  );
}
