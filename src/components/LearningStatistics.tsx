"use client";
import { request } from "../lib/request";
import { useEffect, useState } from "react";
import { subjects, errors } from "../lib/model";
import type { learningStatistics } from "../modules/review/statistics";
type Statistics = ReturnType<typeof learningStatistics>;
const fraction = (n: number, d: number) =>
  d ? `${n}/${d}（${Math.round((n / d) * 100)}%）` : "暂无样本";
export function LearningStatistics() {
  const [from, setFrom] = useState(
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    ),
    [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [subject, setSubject] = useState(""),
    [mode, setMode] = useState("");
  const [data, setData] = useState<Statistics | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    request<Statistics>(
      "reviews/statistics?" + new URLSearchParams({ from, to, subject, mode }),
      { signal: controller.signal },
    )
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [from, to, subject, mode]);
  return (
    <section className="panel form-panel">
      <h2>复习效果 · 以自评为依据</h2>
      <div className="filters">
        <label>
          起始日期
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          统计科目
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">全部科目</option>
            {subjects.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          练习类型
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">全部练习</option>
            <option value="PRACTICE">主动练习</option>
            <option value="SCHEDULED">计划复习</option>
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">正在读取统计…</p>}
      {data && (
        <>
          <p>
            {data.total} 次作答 · {data.entries} 道题 · 计划 {data.scheduled} 次
            / 主动 {data.practice} 次
          </p>
          {data.total < 10 && (
            <p role="note">样本较少，仅供回顾，暂不判断进步或退步。</p>
          )}
          <ul>
            <li>独立掌握比例：{fraction(data.independent, data.total)}</li>
            <li>使用提示比例：{fraction(data.hints, data.total)}</li>
            <li>
              连续两次困难比例：{fraction(data.repeated, data.repeatBase)}
            </li>
          </ul>
          <div className="table-scroll">
            <table>
              <caption>按月回顾（次数）</caption>
              <thead>
                <tr>
                  <th>月份</th>
                  <th>作答</th>
                  <th>独立掌握</th>
                  <th>使用提示</th>
                  <th>不会 / 困难</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.monthly).map(([month, v]) => (
                  <tr key={month}>
                    <th scope="row">{month}</th>
                    <td>{v.total}</td>
                    <td>{v.independent}</td>
                    <td>{v.hints}</td>
                    <td>{v.difficult}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-scroll">
            <table>
              <caption>本次作答错因自评 · 按月变化</caption>
              <thead>
                <tr>
                  <th>月份</th>
                  <th>已填写错因</th>
                  <th>未填写 / 旧历史</th>
                  {errors.map((e) => (
                    <th key={e}>{e}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.errorMonthly).map(([month, v]) => (
                  <tr key={month}>
                    <th scope="row">{month}</th>
                    <td>{v.known}</td>
                    <td>{v.unknown}</td>
                    {errors.map((e) => (
                      <td key={e}>{fraction(v.counts[e], v.known)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            按本次作答时主动填写的错因自评统计。各项比例以明确记录错因的作答次数为分母，可多选，各项比例不相加。未填写及旧历史显示为未知；题目原有标签不会当作本次错因。后续修改题目标签不会改写这些历史。
          </p>
        </>
      )}
      <details>
        <summary>统计口径与限制</summary>
        <p>
          按日志中的作答当地日期筛选，排除已删除题目。独立掌握指未用提示且自评“掌握
          /
          熟练”的次数，分母为当前筛选内所有作答，不等于系统核验的答对率。提示比例使用相同分母。
        </p>
        <p>
          连续两次困难比例：同题在筛选范围内相邻两次均为“不会 /
          困难”的次数，除以有前一次作答可比较的次数。不读取范围外历史，不等于重复犯错率。错因统计仅使用作答时填写的自评，不用题目标签回填旧记录。
        </p>
      </details>
    </section>
  );
}
