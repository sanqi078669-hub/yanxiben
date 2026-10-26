/* eslint-disable @next/next/no-img-element -- Private attachments require the browser's session cookie, which the public image optimizer does not forward. */
import { fields, names } from "../lib/model";
import { DictionaryLabel } from "./DictionaryContext";
import { parseOptions } from "./OptionsEditor";

const labels: Record<string, string> = {
  entry: "当前题目",
  candidates: "候选题目",
  basicIds: "基础匹配的记录编号",
  mode: "比较方式",
  total: "同科目记录总数",
  difference: "差异",
  ...Object.fromEntries(Object.values(fields).flat()),
  type: "材料类型",
  subject: "科目",
  title: "标题",
  body: "题面 / 原文",
  summary: "总结",
  details: "分析与理解",
  contexts: "语境",
  sentence_text: "语境原句",
  meaning_md: "语境词义",
  collocation: "搭配",
  answer: "本次作答",
  hintUsed: "本次是否使用提示",
  subtype: "题目类型",
  options_json: "选项",
  options: "选项",
  source: "来源",
  status: "整理状态",
  knowledgeIds: "知识点编号",
  tags: "标签",
  errors: "错因",
  attachments: "附件",
  id: "编号",
  role: "图片用途",
  sentence_entry_id: "关联句子编号",
  sampleSize: "采样作答次数",
  distinctEntries: "不同题目数",
  from: "起始日期",
  to: "结束日期",
  smallSample: "是否小样本",
  scope: "统计范围",
  entries: "题目统计",
  attempts: "作答次数",
  again: "不会次数",
  hard: "困难次数",
  good: "掌握次数",
  easy: "熟练次数",
  hints: "使用提示次数",
  practice: "主动练习次数",
  feedback: "点评",
  evidence: "依据",
  errorTags: "错因建议",
  warnings: "限制与提醒",
  knowledgePoints: "知识点建议",
  hint: "提示",
  strengths: "正确部分",
  missing: "遗漏之处",
  rating: "建议自评",
  explanation: "解释",
  translation: "译文",
  structure: "句子结构",
  wordMeaning: "语境词义",
  collocations: "搭配",
  question: "变式题面",
  solution: "参考解答",
  recommendations: "建议",
  reason: "依据",
  nextStep: "下一步",
  entryIds: "相关记录",
  matches: "相似记录",
  ok: "连接成功",
};
function display(key: string, value: unknown): React.ReactNode {
  if (key === "mode" && value === "semantic") return "语义比较";
  if (key === "mode" && value === "basic") return "基础匹配";
  if (value === null || value === undefined || value === "") return "（空）";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (key === "attachments" && Array.isArray(value))
    return value.length ? (
      <div className="attachment-grid">
        {value.map((v: { id: string; role: string }) => (
          <figure key={v.id}>
            <img
              src={`/api/v1/attachments/${v.id}/content`}
              alt={v.role === "PROMPT" ? "题面图片" : "答案图片"}
            />
            <figcaption>
              {v.role === "PROMPT" ? "题面图片" : "答案图片"}
            </figcaption>
          </figure>
        ))}
      </div>
    ) : (
      "（无）"
    );
  if (key === "type" && typeof value === "string")
    return names[value as keyof typeof names] || value;
  if (key === "subtype")
    return value === "CONCEPT"
      ? "概念疑问"
      : value === "QUESTION"
        ? "题目"
        : String(value);
  if (key === "status")
    return value === "INBOX"
      ? "待整理"
      : value === "ORGANIZED"
        ? "已整理"
        : String(value);
  if (key === "role")
    return value === "PROMPT"
      ? "题面图片"
      : value === "ANSWER"
        ? "答案图片"
        : String(value);
  if (
    (key === "options_json" || key === "options") &&
    typeof value === "string"
  ) {
    const options = parseOptions(value);
    return options ? (
      <ol>
        {options.map((v, i) => (
          <li key={i}>
            <pre>{v || "（空选项）"}</pre>
          </li>
        ))}
      </ol>
    ) : (
      <pre>{value}</pre>
    );
  }
  if (Array.isArray(value))
    return value.length ? (
      <ol>
        {value.map((v, i) => (
          <li key={i}>{display("", v)}</li>
        ))}
      </ol>
    ) : (
      "（无）"
    );
  if (typeof value === "object")
    return <MaterialPreview material={value as Record<string, unknown>} />;
  return <pre>{String(value)}</pre>;
}
export function MaterialPreview({
  material,
  resolveLabels = false,
}: {
  material: Record<string, unknown>;
  resolveLabels?: boolean;
}) {
  return (
    <dl className="material-preview">
      {Object.entries(material).map(([key, value]) => (
        <div key={key}>
          <dt>{labels[key] || key}</dt>
          <dd>
            {resolveLabels &&
            key === "subject" &&
            typeof value === "string" &&
            value ? (
              <DictionaryLabel kind="SUBJECT" value={value} markArchived />
            ) : resolveLabels &&
              key === "errors" &&
              Array.isArray(value) &&
              value.length ? (
              <ul>
                {value.map((item: string) => (
                  <li key={item}>
                    <DictionaryLabel kind="ERROR" value={item} markArchived />
                  </li>
                ))}
              </ul>
            ) : (
              display(key, value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
