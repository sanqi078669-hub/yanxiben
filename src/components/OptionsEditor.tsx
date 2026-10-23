"use client";

export function parseOptions(raw: string): string[] | null {
  if (!raw.trim()) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every((v) => typeof v === "string")
      ? value
      : null;
  } catch {
    return null;
  }
}

export function OptionsEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const options = parseOptions(value);
  if (!options)
    return (
      <section role="alert">
        <p>原选项格式无法读取，内容已保留。请复制原内容后重新逐项填写。</p>
        <pre>{value}</pre>
        <button
          type="button"
          className="button outline"
          onClick={() => {
            if (
              window.confirm(
                "已复制需要保留的选项？重建会清空当前选项，其他内容保留。",
              )
            )
              onChange("[]");
          }}
        >
          重建选项
        </button>
      </section>
    );
  return (
    <fieldset className="options-editor">
      <legend>客观题选项（可选）</legend>
      {options.map((option, i) => (
        <div key={i} className="option-row">
          <label>
            选项 {i + 1}
            <textarea
              value={option}
              onChange={(event) =>
                onChange(
                  JSON.stringify(
                    options.map((v, j) => (j === i ? event.target.value : v)),
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            className="text-button"
            aria-label={`移除选项 ${i + 1}`}
            onClick={() =>
              onChange(JSON.stringify(options.filter((_, j) => j !== i)))
            }
          >
            移除
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button outline"
        disabled={options.length >= 20}
        onClick={() => onChange(JSON.stringify([...options, ""]))}
      >
        添加选项
      </button>
      <p className="muted">按题目顺序填写，支持公式和换行；最多 20 项。</p>
    </fieldset>
  );
}
