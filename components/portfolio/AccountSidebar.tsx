"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatCurrencyCompact } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import type { HoldingWithMetrics } from "@/lib/types";
import {
  ACCOUNT_TYPES,
  resolveAccountType,
  type AccountType,
} from "@/lib/account-types";

interface CashBalance {
  account: string;
  label: string;
  balance: number;
}

interface Props {
  holdings: HoldingWithMetrics[];
  cash?: CashBalance[];
  selected: string;
  onSelect: (id: string) => void;
  onRemoveAccount: (name: string) => void;
}

export function AccountSidebar({ holdings, cash = [], selected, onSelect, onRemoveAccount }: Props) {
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [accountTypes, setAccountTypes] = useState<Record<string, AccountType>>({});
  const [metaLoaded, setMetaLoaded] = useState(false);

  /* Load type tags, and re-load when the tab regains focus so a change made in
     Settings (a separate component) is reflected without a hard reload. */
  useEffect(() => {
    let active = true;
    const loadMeta = () =>
      fetch("/api/accounts/meta")
        .then((r) => r.json())
        .then((d) => { if (active) setAccountTypes(d.types ?? {}); })
        .catch(() => {})
        .finally(() => { if (active) setMetaLoaded(true); });
    loadMeta();
    const onVisible = () => { if (document.visibilityState === "visible") loadMeta(); };
    window.addEventListener("focus", loadMeta);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", loadMeta);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const accounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of holdings) {
      map.set(h.account, (map.get(h.account) ?? 0) + h.value);
    }
    for (const c of cash) {
      map.set(c.account, (map.get(c.account) ?? 0) + c.balance);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [holdings, cash]);

  /* Bucket accounts under their type tag, preserving ACCOUNT_TYPES order and the
     value sort within each group. Only non-empty groups are kept. */
  const groups = useMemo(() => {
    return ACCOUNT_TYPES.map((t) => {
      const items = accounts.filter((a) => resolveAccountType(a.name, accountTypes) === t.id);
      const subtotal = items.reduce((s, a) => s + a.value, 0);
      return { id: t.id, label: t.label, items, subtotal };
    }).filter((g) => g.items.length > 0);
  }, [accounts, accountTypes]);

  const grandTotal = accounts.reduce((s, a) => s + a.value, 0);

  const handleRemove = (name: string) => {
    if (confirmRemove === name) {
      onRemoveAccount(name);
      setConfirmRemove(null);
      if (selected === name) onSelect("all");
    } else {
      setConfirmRemove(name);
    }
  };

  return (
    <aside
      className="w-52 shrink-0 flex flex-col border-r border-border bg-sidebar overflow-y-auto"
      aria-label="Account filter"
    >
      <div className="px-4 pt-5 pb-2">
        <AccountItem
          label="All Accounts"
          sublabel={`${accounts.length} account${accounts.length !== 1 ? "s" : ""}`}
          value={<Sensitive>{formatCurrencyCompact(grandTotal)}</Sensitive>}
          active={selected === "all"}
          onClick={() => { onSelect("all"); setConfirmRemove(null); }}
        />
      </div>

      {!metaLoaded && accounts.length > 0 && (
        <div className="px-4 pt-4">
          <p className="text-xs text-muted-foreground animate-pulse">Loading…</p>
        </div>
      )}

      {metaLoaded && groups.map((group) => (
        <div key={group.id} className="px-4 pt-4 pb-1">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground font-medium">{group.label}</p>
            <span className="text-xs font-mono" style={{ color: "oklch(0.44 0.008 74)" }}>
              <Sensitive>{formatCurrencyCompact(group.subtotal)}</Sensitive>
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map(({ name, value }) => (
              <div key={name} className="group relative">
                <AccountItem
                  label={name}
                  value={<Sensitive>{formatCurrencyCompact(value)}</Sensitive>}
                  active={selected === name}
                  onClick={() => { onSelect(name); setConfirmRemove(null); }}
                />
                {/* Remove button — appears on hover */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemove(name); }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded-sm text-xs"
                  style={{
                    color: confirmRemove === name ? "var(--negative)" : "oklch(0.44 0.008 74)",
                    background: "oklch(0.12 0 0)",
                  }}
                  title={confirmRemove === name ? "Click again to confirm" : "Remove account"}
                >
                  {confirmRemove === name ? "Sure?" : "×"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {accounts.length === 0 && (
        <div className="px-4 pt-4">
          <p className="text-xs text-muted-foreground">No accounts yet.</p>
        </div>
      )}
    </aside>
  );
}

interface AccountItemProps {
  label: string;
  sublabel?: string;
  value?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}

function AccountItem({ label, sublabel, value, active, onClick }: AccountItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2 rounded-sm text-sm transition-colors duration-150",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
      )}
      aria-pressed={active}
    >
      <div className="flex items-center justify-between gap-2 pr-4">
        <span className={cn("font-medium truncate", active && "text-foreground")}>{label}</span>
        {value && (
          <span
            className="text-xs font-mono shrink-0"
            style={
              active
                ? { color: "oklch(0.72 0.14 74)" }
                : { color: "oklch(0.52 0.008 74)" }
            }
          >
            {value}
          </span>
        )}
      </div>
      {sublabel && (
        <span className="text-xs text-muted-foreground mt-0.5 block">{sublabel}</span>
      )}
    </button>
  );
}
