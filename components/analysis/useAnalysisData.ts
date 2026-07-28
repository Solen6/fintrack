"use client";

import { useCallback, useEffect, useState } from "react";

/** Generic loader for the /api/analysis/* endpoints: handles loading / error /
    retry and returns typed JSON. Non-2xx responses surface the server message.
    Pass a null URL to skip fetching (e.g. an empty ticker basket). */
export function useAnalysisData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(url != null);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (url == null) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(url)
      .then(async (r) => {
        const json = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(json?.error || `Request failed (${r.status})`);
        return json as T;
      })
      .then((json) => {
        if (alive) setData(json);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Unknown error");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [url, nonce]);

  return { data, error, loading, retry };
}
