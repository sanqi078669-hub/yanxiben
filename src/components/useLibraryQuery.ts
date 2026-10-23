"use client";
import { useSearchParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
export function useLibraryQuery(mode: string) {
  const params = useSearchParams(),
    pathname = usePathname();
  function field(
    name: string,
    fallback = "",
  ): [string, (value: string) => void] {
    return [
      params.get(name) ?? fallback,
      (value) => {
        const next = new URLSearchParams(window.location.search);
        next.set(name, value);
        next.delete("page");
        window.history.replaceState(null, "", `${pathname}?${next}`);
      },
    ];
  }
  const [q, setQ] = field("q"),
    [type, setType] = field("type"),
    [subject, setSubject] = field("subject"),
    [status, setStatus] = field("status", mode === "inbox" ? "INBOX" : ""),
    [knowledge, setKnowledge] = field("knowledge"),
    [errorFilter, setErrorFilter] = field("error"),
    [tag, setTag] = field("tag");
  const rawPage = Number(params.get("page") || 1),
    page =
      Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 1000000
        ? rawPage
        : 1;
  function setPage(value: number | ((old: number) => number)) {
    const next = new URLSearchParams(window.location.search);
    next.set("page", String(typeof value === "function" ? value(page) : value));
    window.history.pushState(null, "", `${pathname}?${next}`);
  }
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(timer);
  }, [q]);
  function clearFilters() {
    window.history.replaceState(null, "", pathname);
  }
  return {
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
    returnTo: pathname + (params.size ? `?${params}` : ""),
  };
}
