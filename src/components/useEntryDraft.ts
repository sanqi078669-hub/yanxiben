"use client";
import { useEffect, useRef, useState } from "react";
import type { EntryInput } from "../lib/model";
import { draftPrefix, readDraft, type Draft } from "../lib/drafts";

export function useEntryDraft(
  entry: EntryInput,
  record: string,
  version: number,
  loaded: boolean,
  saved: string,
) {
  const [owner, setOwner] = useState("");
  const [pending, setPending] = useState<{ key: string; draft: Draft }[]>([]);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const slot = useRef("");
  useEffect(() => {
    let active = true;
    fetch("/api/v1/auth/identity")
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return (await r.json()).data.owner as string;
      })
      .then((value) => {
        if (active) setOwner(value);
      })
      .catch(() => {
        if (active) setMessage("草稿保护未启用，请保持页面打开并及时保存。");
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!owner || !loaded) return;
    setReady(false);
    try {
      // Each mounted editor owns a separate slot: concurrent tabs cannot overwrite each other.
      slot.current = `${draftPrefix}${owner}:${record}:${crypto.randomUUID()}`;
      const candidates = Object.keys(localStorage)
        .filter((key) => key.startsWith(`${draftPrefix}${owner}:${record}:`))
        .flatMap((key) => {
          const draft = readDraft(localStorage.getItem(key), owner, record);
          if (!draft) {
            localStorage.removeItem(key);
            return [];
          }
          return JSON.stringify(draft.entry) === saved ? [] : [{ key, draft }];
        })
        .sort((a, b) => b.draft.updated - a.draft.updated);
      setPending(candidates);
      setReady(true);
    } catch {
      setMessage("浏览器不允许保存草稿，请及时手动保存。");
    }
    // Inspect existing drafts once per editor/record, not after every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, record, loaded]);
  useEffect(() => {
    if (!ready || pending.length || !slot.current) return;
    try {
      if (JSON.stringify(entry) === saved) {
        localStorage.removeItem(slot.current);
        return;
      }
      localStorage.setItem(
        slot.current,
        JSON.stringify({ owner, record, version, entry, updated: Date.now() }),
      );
      setMessage(
        "已暂存本浏览器草稿（保留 7 天），尚不等于保存到记录。未上传成功的图片需重新选择。",
      );
    } catch {
      setMessage("草稿暂存失败，可能存储空间不足，请保持页面打开并手动保存。");
    }
  }, [entry, owner, record, version, ready, pending.length, saved]);
  function dismiss(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      setMessage("无法删除浏览器草稿。");
    }
    setPending((v) => v.filter((item) => item.key !== key));
  }
  function clear() {
    try {
      if (slot.current) localStorage.removeItem(slot.current);
    } catch {}
    setMessage("");
  }
  return { pending, message, dismiss, clear, ready };
}
