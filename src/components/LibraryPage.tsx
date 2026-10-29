"use client";
import { DictionaryLabel, useDictionary } from "./DictionaryContext";
import { DictionaryOptions } from "./DictionaryOptions";
import Link from "next/link";

import {
  Plus,
  RotateCcw,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import { useLibraryQuery } from "./useLibraryQuery";
import { BatchTags } from "./BatchTags";
import type { EntryList, KnowledgeNode } from "../lib/api-types";
import { useLibraryPosition } from "./libraryPosition";

import { api } from "../lib/request";
import { TypeIcon, Empty, Row, ErrorBox } from "./ui";
import { useLoad } from "./useLoad";
export default function LibraryPage({
  mode,
  notify,
}: {
  mode: string;
  notify: (s: string, tone?: "success" | "error") => void;
}) {
  const { items, loading: dictionaryLoading } = useDictionary();
  const {
    q,
    setQ,
    debouncedQ,
    type,
    setType,
    subject,
    setSubject,
    status,
    setStatus,
    knowledge,
    setKnowledge,
    errorFilter,
    setErrorFilter,
    tag,
    setTag,
    page,
    setPage,
    clearFilters,
    returnTo,
  } = useLibraryQuery(mode);
  const { data: nodes } = useLoad<KnowledgeNode[]>("knowledge-nodes");
  const query = new URLSearchParams({
    q: debouncedQ,
    type,
    subject,
    status,
    knowledge,
    error: errorFilter,
    tag,
    page: String(page),
    trash: mode === "trash" ? "1" : "0",
  }).toString();
  const { data, error, reload, loading } = useLoad<EntryList>(
    "entries?" + query,
  );
  const hasFilters = !!(
    q ||
    type ||
    subject ||
    knowledge ||
    errorFilter ||
    tag ||
    (status && mode !== "inbox")
  );
  useLibraryPosition(returnTo, !!data && !loading && q === debouncedQ);
  return (
    <div className={mode === "library" ? "journal-library" : undefined}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {mode === "inbox"
              ? "CAPTURE FIRST, UNDERSTAND LATER"
              : mode === "trash"
                ? "NOT LOST, JUST SET ASIDE"
                : "A GROWING COLLECTION"}
          </div>
          <h1>
            {mode === "inbox"
              ? "收集箱"
              : mode === "trash"
                ? "回收站"
                : "你的知识，一点点成形。"}
          </h1>
          <p>
            {mode === "trash"
              ? "删除的记录仍保留附件和历史；恢复后复习计划保持暂停。"
              : mode === "inbox"
                ? "让零散的疑问，变成有条理的理解。"
                : "数学、408 与英语，让每份积累都能被重新找到。"}
          </p>
        </div>
        <Link className="button" href="/entries/new">
          <Plus size={18} />
          收集一条
        </Link>
      </div>
      <div className="filter-panel">
        {!dictionaryLoading && !items.types.some((item) => !item.archived) && (
          <p>
            暂无可用类型，可先创建类型或恢复归档类型。
            <Link href="/settings#dictionary-manager">前往分类管理</Link>
          </p>
        )}
        <p aria-live="polite">
          {hasFilters ? "已启用筛选条件" : "显示默认范围"}{" "}
          <button className="text-button" onClick={clearFilters}>
            清除筛选并回到第一页
          </button>
        </p>
        <div className="search-input">
          <Search size={19} />
          <input
            aria-label="搜索记录"
            placeholder="搜索题目、原文、分析或来源…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="filters dictionary-filters">
          <label className="dictionary-filter dictionary-filter-type">
            <span className="dictionary-filter-name">记录类型</span>
            <select
              aria-label="记录类型"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">所有类型</option>
              <DictionaryOptions kind="TYPE" value={type} />
            </select>
          </label>
          <label className="dictionary-filter">
            <span className="dictionary-filter-name">科目</span>
            <select
              aria-label="科目"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            >
              <option value="">所有科目</option>
              <DictionaryOptions kind="SUBJECT" value={subject} />
            </select>
          </label>
          {mode !== "inbox" && (
            <label className="dictionary-filter">
              <span className="dictionary-filter-name">整理状态</span>
              <select
                aria-label="整理状态"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">整理状态</option>
                <option value="INBOX">待整理</option>
                <option value="ORGANIZED">已整理</option>
              </select>
            </label>
          )}
          <label className="dictionary-filter">
            <span className="dictionary-filter-name">知识点</span>
            <select
              aria-label="知识点"
              value={knowledge}
              onChange={(e) => setKnowledge(e.target.value)}
            >
              <option value="">所有知识点</option>
              {knowledge && nodes && !nodes.some((n) => n.id === knowledge) && (
                <option value={knowledge}>原知识点已失效，请清除筛选</option>
              )}
              {nodes?.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <label className="dictionary-filter">
            <span className="dictionary-filter-name">错因</span>
            <select
              aria-label="错因"
              value={errorFilter}
              onChange={(e) => setErrorFilter(e.target.value)}
            >
              <option value="">所有错因</option>
              <DictionaryOptions kind="ERROR" value={errorFilter} />
            </select>
          </label>
          <label className="dictionary-filter dictionary-filter-tag">
            <span className="dictionary-filter-name">标签</span>
            <input
              className="tag-filter"
              aria-label="标签筛选"
              placeholder="标签"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            />
          </label>
          <button
            className="text-button"
            onClick={() => {
              setQ("");
              setType("");
              setSubject("");
              setStatus(mode === "inbox" ? "INBOX" : "");
              setKnowledge("");
              setErrorFilter("");
              setTag("");
            }}
          >
            清除筛选
          </button>
        </div>
      </div>
      <ErrorBox text={error} />
      {mode !== "trash" &&
        q === debouncedQ &&
        data &&
        data.items.length > 0 && (
          <BatchTags key={query} items={data.items} reload={reload} />
        )}
      <section className="panel">
        <div className="section-title">
          <h2>
            {mode === "trash" ? "已删除记录" : "学习记录"}{" "}
            <small>{data?.total ?? 0} 条</small>
          </h2>
          <span className="muted">最近更新优先</span>
        </div>
        {loading || q !== debouncedQ ? (
          <p role="status">正在查找记录…</p>
        ) : data?.items.length ? (
          data.items.map((e) =>
            mode === "trash" ? (
              <div className="entry-row" key={e.id}>
                <TypeIcon type={e.type} />
                <div className="entry-main">
                  <h3>{e.title || "未命名记录"}</h3>
                  <p>
                    <DictionaryLabel kind="SUBJECT" value={e.subject} /> ·
                    删除于 {e.deleted_at?.slice(0, 10)}
                  </p>
                </div>
                <button
                  className="button outline small"
                  onClick={async () => {
                    try {
                      await api("entries/" + e.id + "/restore", {});
                      notify("已恢复记录，复习计划保持暂停");
                      reload();
                    } catch (e) {
                      notify((e as Error).message, "error");
                    }
                  }}
                >
                  <RotateCcw size={15} />
                  恢复
                </button>
              </div>
            ) : (
              <Row key={e.id} e={e} returnTo={returnTo} />
            ),
          )
        ) : (
          <Empty
            title={
              hasFilters || page > 1
                ? "没有找到匹配的记录"
                : mode === "trash"
                  ? "回收站是空的"
                  : "还没有收集记录"
            }
            text={
              hasFilters || page > 1
                ? "试试调整关键词，或清除部分筛选条件。"
                : "开始收集，给下一次理解留下线索。"
            }
          />
        )}
        <div className="pagination">
          <span>
            第 {page} 页 · 共 {Math.max(1, Math.ceil((data?.total || 0) / 20))}{" "}
            页
          </span>
          <button
            disabled={page === 1}
            aria-label="上一页"
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            disabled={page * 20 >= (data?.total || 0)}
            aria-label="下一页"
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </section>
    </div>
  );
}
