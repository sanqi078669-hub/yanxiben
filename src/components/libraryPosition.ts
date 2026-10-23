"use client";
import { useEffect, useRef } from "react";

const key = "yanxi-library-position";

export function rememberLibraryPosition(url: string, entryId: string) {
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ url, entryId, y: window.scrollY, at: Date.now() }),
    );
  } catch {
    /* Returning to the list still works when browser storage is unavailable. */
  }
}

export function useLibraryPosition(url: string, ready: boolean) {
  const restored = useRef(false);
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || "null");
      if (!saved || saved.url !== url || Date.now() - saved.at > 3600000)
        return;
      sessionStorage.removeItem(key);
      const frame = requestAnimationFrame(() => {
        const link = Array.from(
          document.querySelectorAll<HTMLAnchorElement>("a[data-entry-id]"),
        ).find((node) => node.dataset.entryId === saved.entryId);
        link?.focus({ preventScroll: true });
        if (Number.isFinite(saved.y))
          window.scrollTo({ top: Math.max(0, saved.y), behavior: "instant" });
      });
      return () => cancelAnimationFrame(frame);
    } catch {
      /* Invalid or disabled storage must not block the list. */
    }
  }, [url, ready]);
}
