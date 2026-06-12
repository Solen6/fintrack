"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";
import { LAST_SYNC } from "@/lib/mock-data";
import { createClient } from "@/lib/supabase/client";

const NAV_TABS = [
  { href: "/portfolio", label: "Portfolio" },
  { href: "/news",      label: "News"      },
  { href: "/options",   label: "Options"   },
  { href: "/futures",   label: "Futures"   },
];

const PROFILE = { name: "Carter Rowe", email: "carter@justinrowe.com", initial: "C" };

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="flex items-center h-12 px-6 border-b border-border bg-sidebar shrink-0">
      {/* Brand */}
      <span
        className="text-sm font-semibold tracking-tight mr-8"
        style={{ color: "oklch(0.72 0.14 74)" }}
      >
        fintrack
      </span>

      {/* Tab nav */}
      <nav className="flex items-center gap-1 flex-1" aria-label="Main navigation">
        {NAV_TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "px-3 py-1.5 text-sm rounded-sm transition-colors duration-150",
                active
                  ? "text-foreground bg-accent"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {/* Right: sync status + user */}
      <div className="flex items-center gap-4 shrink-0">
        <button
          className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 flex items-center gap-1.5"
          title="Sync portfolio from OneDrive"
          aria-label="Sync portfolio from OneDrive"
        >
          <SyncIcon />
          <span>{formatRelativeTime(LAST_SYNC)}</span>
        </button>

        <ProfileMenu />
      </div>
    </header>
  );
}

function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-shadow duration-150 focus:outline-none"
        style={{
          background: "oklch(0.20 0 0)",
          color: "oklch(0.72 0.14 74)",
          boxShadow: open ? "0 0 0 2px oklch(0.72 0.14 74 / 0.5)" : "none",
        }}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {PROFILE.initial}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-60 rounded-sm border border-border overflow-hidden z-50 shadow-lg"
          style={{ background: "oklch(0.10 0 0)" }}
        >
          {/* Identity header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0"
              style={{ background: "oklch(0.20 0 0)", color: "oklch(0.72 0.14 74)" }}
              aria-hidden
            >
              {PROFILE.initial}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-foreground truncate">{PROFILE.name}</p>
              <p className="text-xs text-muted-foreground truncate">{PROFILE.email}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="py-1">
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors duration-150"
            >
              Settings
            </Link>
            <button
              role="menuitem"
              onClick={signOut}
              className="block w-full text-left px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors duration-150"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SyncIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M13.5 8A5.5 5.5 0 1 1 8 2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M8 2.5 10.5 5 8 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
