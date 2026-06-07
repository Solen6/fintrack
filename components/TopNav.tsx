"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";
import { LAST_SYNC } from "@/lib/mock-data";

const NAV_TABS = [
  { href: "/portfolio", label: "Portfolio" },
  { href: "/budget",    label: "Budget"    },
  { href: "/news",      label: "News"      },
  { href: "/accounts",  label: "Accounts"  },
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

        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium"
          style={{
            background: "oklch(0.20 0 0)",
            color: "oklch(0.72 0.14 74)",
          }}
          aria-label="User account"
        >
          C
        </div>
      </div>
    </header>
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
