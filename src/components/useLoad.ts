"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { api } from "../lib/request";
export function useLoad<T = any>(path: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  const generation = useRef(0);
  const active = useRef(false);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    const request = ++generation.current;
    setLoading(true);
    setError("");
    return api<T>(path)
      .then((result) => {
        if (active.current && request === generation.current) setData(result);
      })
      .catch((e) => {
        if (active.current && request === generation.current)
          setError(e.message);
      })
      .finally(() => {
        if (active.current && request === generation.current) setLoading(false);
      });
  }, [path]);
  useEffect(() => {
    active.current = true;
    reload();
    return () => {
      active.current = false;
    };
  }, [reload]);
  return { data, error, reload, setData, loading };
}
