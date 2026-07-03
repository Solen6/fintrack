"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";
import { LAST_SYNC } from "@/lib/mock-data";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/use-profile";
import { usePrivacy } from "@/lib/privacy";

const NAV_TABS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/accounts",  label: "Accounts"  },
  { href: "/news",      label: "News"      },
  { href: "/calendar",  label: "Calendar"  },
  { href: "/paper",     label: "Paper"     },
  { href: "/options",   label: "Options"   },
  { href: "/futures",   label: "Futures"   },
  { href: "/competitions", label: "Competitions" },
];

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

      {/* Right: privacy toggle + sync status + user */}
      <div className="flex items-center gap-4 shrink-0">
        <PrivacyToggle />

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
  const profile = useProfile();
  const initial = profile.initial || "·";

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
    window.location.href = "/";
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
        {initial}
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
              {initial}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-foreground truncate">{profile.name || "—"}</p>
              <p className="text-xs text-muted-foreground truncate">{profile.email || "Loading…"}</p>
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

/* Private-mode toggle — hides account balances & P&L across the app. */
function PrivacyToggle() {
  const { hidden, toggle } = usePrivacy();
  return (
    <button
      onClick={toggle}
      aria-pressed={hidden}
      title={hidden ? "Private mode on — balances hidden" : "Hide balances (private mode)"}
      aria-label={hidden ? "Show balances" : "Hide balances"}
      className={cn(
        "flex items-center justify-center h-7 w-7 rounded-sm transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        hidden
          ? "text-[oklch(0.72_0.14_74)] hover:bg-accent"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
      )}
    >
      {hidden ? <EyeOffIcon /> : <EyeIcon />}
    </button>
  );
}

function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.9 5.2A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3 3.9M6.6 6.6A17.6 17.6 0 0 0 2 12s3.5 7 10 7a10.4 10.4 0 0 0 4.4-1M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
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
