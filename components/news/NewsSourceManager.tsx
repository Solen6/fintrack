"use client";

import { useState, useEffect, useRef } from "react";
import { BUILTIN_SOURCES, type BuiltinKey, type BuiltinPrefs } from "@/lib/news-builtins";
import { sourceColor } from "@/lib/news-source-color";

/* Colored dot matching the source's color in the news feed. */
function SourceDot({ source, dimmed }: { source: string; dimmed?: boolean }) {
  return (
    <span
      className="w-2 h-2 rounded-full shrink-0 transition-opacity duration-150"
      style={{ background: sourceColor(source), opacity: dimmed ? 0.3 : 1 }}
      aria-hidden
    />
  );
}

export interface NewsSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

interface Props {
  sources: NewsSource[];
  builtins: BuiltinPrefs;
  onClose: () => void;
  onAdd: (source: NewsSource) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onToggleBuiltin: (key: BuiltinKey, enabled: boolean) => void;
}

/* ─── Reusable pill toggle ─── */
function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="w-8 h-[18px] rounded-full shrink-0 relative transition-colors duration-150"
      style={{ background: on ? "oklch(0.72 0.14 74)" : "oklch(0.22 0 0)" }}
      aria-label={label}
      aria-pressed={on}
    >
      <span
        className="absolute top-[2px] w-[14px] h-[14px] rounded-full transition-transform duration-150"
        style={{
          background: "oklch(0.08 0 0)",
          transform: on ? "translateX(16px)" : "translateX(2px)",
        }}
      />
    </button>
  );
}

const SUGGESTIONS = [
  { name: "WSJ Markets",      url: "https://feeds.a.dj.com/rss/RSSMarketsMain.aspx" },
  { name: "NYT Business",     url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml" },
  { name: "Reuters Business", url: "https://feeds.reuters.com/reuters/businessNews" },
  { name: "CNBC Finance",     url: "https://www.cnbc.com/id/10000664/device/rss/rss.html" },
  { name: "MarketWatch",      url: "https://feeds.marketwatch.com/marketwatch/topstories/" },
  { name: "Seeking Alpha",    url: "https://seekingalpha.com/feed.xml" },
  { name: "Motley Fool",      url: "https://www.fool.com/feeds/index.aspx" },
  { name: "Barron's",         url: "https://www.barrons.com/feed" },
];

export function NewsSourceManager({
  sources,
  builtins,
  onClose,
  onAdd,
  onToggle,
  onDelete,
  onToggleBuiltin,
}: Props) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const existingUrls = new Set(sources.map((s) => s.url));

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimName = name.trim();
    const trimUrl = url.trim();
    if (!trimName || !trimUrl) return;
    setAdding(true);
    setError("");
    try {
      const res = await fetch("/api/news/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimName, url: trimUrl }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Failed to add source"); return; }
      onAdd(d.source);
      setName("");
      setUrl("");
    } catch {
      setError("Network error — try again");
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    onToggle(id, enabled); // optimistic
    await fetch(`/api/news/sources/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  }

  async function handleDelete(id: string) {
    onDelete(id); // optimistic
    await fetch(`/api/news/sources/${id}`, { method: "DELETE" });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.72)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border overflow-hidden flex flex-col"
        style={{ background: "oklch(0.12 0 0)", maxHeight: "85vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-foreground">News Sources</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Connect RSS feeds to pull into your news tab</p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors w-7 h-7 flex items-center justify-center rounded"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Built-in providers */}
          <div className="px-5 py-4 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Built-in
            </p>
            <ul className="space-y-2">
              {BUILTIN_SOURCES.map((b) => (
                <li
                  key={b.key}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md border border-border"
                  style={{ background: "oklch(0.14 0 0)" }}
                >
                  <Toggle
                    on={builtins[b.key]}
                    onClick={() => onToggleBuiltin(b.key, !builtins[b.key])}
                    label={`${builtins[b.key] ? "Disable" : "Enable"} ${b.name}`}
                  />
                  <SourceDot source={b.name} dimmed={!builtins[b.key]} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${builtins[b.key] ? "text-foreground" : "text-muted-foreground"}`}>
                      {b.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate opacity-70">{b.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Custom RSS feeds */}
          <div className="px-5 py-4 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Custom Feeds ({sources.length})
            </p>
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sources added yet — add one below.</p>
            ) : (
              <ul className="space-y-2">
                {sources.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-md border border-border"
                    style={{ background: "oklch(0.14 0 0)" }}
                  >
                    <Toggle
                      on={s.enabled}
                      onClick={() => handleToggle(s.id, !s.enabled)}
                      label={s.enabled ? "Disable source" : "Enable source"}
                    />
                    <SourceDot source={s.name} dimmed={!s.enabled} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${s.enabled ? "text-foreground" : "text-muted-foreground"}`}>
                        {s.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate opacity-70">{s.url}</p>
                    </div>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors text-xs shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-white/5"
                      aria-label="Remove source"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Add new source */}
          <form onSubmit={handleAdd} className="px-5 py-4 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Add RSS Feed
            </p>
            <div className="space-y-2 mb-3">
              <input
                ref={nameRef}
                type="text"
                placeholder="Source name (e.g. WSJ Markets)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-md text-sm text-foreground border border-border outline-none focus:border-primary transition-colors placeholder:text-muted-foreground"
                style={{ background: "oklch(0.09 0 0)" }}
              />
              <input
                type="url"
                placeholder="RSS feed URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-md text-sm text-foreground border border-border outline-none focus:border-primary transition-colors placeholder:text-muted-foreground"
                style={{ background: "oklch(0.09 0 0)" }}
              />
            </div>
            {error && (
              <p className="text-xs mb-2" style={{ color: "oklch(0.64 0.16 28)" }}>
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={adding || !name.trim() || !url.trim()}
              className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "oklch(0.72 0.14 74)", color: "oklch(0.08 0 0)" }}
            >
              {adding ? "Adding…" : "Add Source"}
            </button>
          </form>

          {/* Suggestions */}
          {SUGGESTIONS.some((s) => !existingUrls.has(s.url)) && (
            <div className="px-5 py-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Suggestions
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.filter((s) => !existingUrls.has(s.url)).map((s) => (
                  <button
                    key={s.url}
                    onClick={() => { setName(s.name); setUrl(s.url); nameRef.current?.focus(); }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
                    style={{ background: "oklch(0.10 0 0)" }}
                  >
                    <SourceDot source={s.name} />
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
