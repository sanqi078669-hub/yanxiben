"use client";
import { useState, useRef, useCallback, useEffect } from "react";
type Any = Record<string, any>;
export function useLoad<T = Any>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  const generation = useRef(0);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    const request = ++generation.current;
    setLoading(true);
    setError("");
    return fn()
      .then((result) => {
        if (request === generation.current) setData(result);
      })
      .catch((e) => {
        if (request === generation.current) setError(e.message);
      })
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
  }, deps);
  useEffect(() => {
    reload();
    return () => {
      generation.current++;
    };
  }, [reload]);
  return { data, error, reload, setData, loading };
}
