"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/use-profile";
import { OneDriveFilePicker } from "./OneDriveFilePicker";
import {
  ACCOUNT_TYPES,
  resolveAccountType,
  type AccountType,
} from "@/lib/account-types";

/* ─── Account type editing ───
   Real accounts are derived from the user's holdings + cash balances. Each one's
   type tag (brokerage / retirement / cash) lives in the account_meta table and
   drives the Accounts-tab grouping + the dashboard performance filter. Until a
   type is explicitly set, resolveAccountType falls back to a name guess. */
interface AccountTypeRow {
  name: string;
  type: AccountType;
}

export function AccountsPageClient() {
  const profile = useProfile();
  const [accounts, setAccounts] = useState<AccountTypeRow[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [savingTypes, setSavingTypes] = useState<Set<string>>(new Set());
  const [portfolioFile, setPortfolioFile] = useState("");
  const [portfolioSheet, setPortfolioSheet] = useState("");
  const [budgetFile, setBudgetFile] = useState("");
  const [budgetSheet, setBudgetSheet] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"connected" | "disconnected" | "loading">("loading");
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    const supabase = createClient();
    supabase.from("microsoft_connections")
      .select("expires_at, portfolio_file_path, portfolio_sheet_name, budget_file_path, budget_sheet_name, updated_at")
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSyncStatus("connected");
          if (data.portfolio_file_path) setPortfolioFile(data.portfolio_file_path);
          if (data.portfolio_sheet_name) setPortfolioSheet(data.portfolio_sheet_name);
          if (data.budget_file_path) setBudgetFile(data.budget_file_path);
          if (data.budget_sheet_name) setBudgetSheet(data.budget_sheet_name);
          if (data.updated_at) {
            const d = new Date(data.updated_at);
            setSyncedAt(d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
          }
        } else {
          setSyncStatus("disconnected");
        }
      });
  }, [searchParams]);

  /* Load the user's real accounts (from holdings + cash) and their current type
     tags from account_meta. */
  useEffect(() => {
    Promise.all([
      fetch("/api/holdings").then((r) => r.json()).catch(() => ({})),
      fetch("/api/cash").then((r) => r.json()).catch(() => ({})),
      fetch("/api/accounts/meta").then((r) => r.json()).catch(() => ({})),
    ])
      .then(([h, c, m]) => {
        const types: Record<string, string> = m?.types ?? {};
        const names = new Set<string>();
        for (const x of h?.holdings ?? []) if (x?.account) names.add(x.account as string);
        for (const x of c?.balances ?? []) if (x?.account) names.add(x.account as string);
        const list = Array.from(names)
          .sort((a, b) => a.localeCompare(b))
          .map((name) => ({ name, type: resolveAccountType(name, types) }));
        setAccounts(list);
      })
      .finally(() => setAccountsLoading(false));
  }, []);

  const handlePickerSave = async (
    portfolio: { filePath: string; fileName: string; sheetName: string },
    budget:    { filePath: string; fileName: string; sheetName: string }
  ) => {
    setPortfolioFile(portfolio.filePath);
    setPortfolioSheet(portfolio.sheetName);
    setBudgetFile(budget.filePath);
    setBudgetSheet(budget.sheetName);
    setShowPicker(false);
    const supabase = createClient();
    await supabase.from("microsoft_connections").update({
      portfolio_file_path:  portfolio.filePath,
      portfolio_sheet_name: portfolio.sheetName,
      budget_file_path:     budget.filePath,
      budget_sheet_name:    budget.sheetName,
      updated_at:           new Date().toISOString(),
    }).not("user_id", "is", null);
  };

  const disconnectMicrosoft = async () => {
    const supabase = createClient();
    await supabase.from("microsoft_connections").delete().not("user_id", "is", null);
    setSyncStatus("disconnected");
    setSyncedAt(null);
  };

  /* Persist an account's type tag to account_meta. Optimistic; reverts on error.
     prevType is captured inside the functional updater so it reflects the latest
     committed value (safe under rapid edits), and the saving indicator is keyed
     per account so overlapping saves don't clear each other's state. */
  const setAccountType = async (name: string, type: AccountType) => {
    let prevType: AccountType | undefined;
    setAccounts((prev) =>
      prev.map((a) => {
        if (a.name === name) { prevType = a.type; return { ...a, type }; }
        return a;
      })
    );
    setSavingTypes((s) => new Set(s).add(name));
    try {
      const res = await fetch("/api/accounts/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: name, type }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch {
      if (prevType) setAccounts((prev) => prev.map((a) => (a.name === name ? { ...a, type: prevType! } : a)));
    } finally {
      setSavingTypes((s) => { const n = new Set(s); n.delete(name); return n; });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 flex flex-col gap-10">

        {/* ── OneDrive Connection ── */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-4">OneDrive Connection</h2>
          <div
            className="rounded-sm border border-border overflow-hidden"
            style={{ background: "oklch(0.10 0 0)" }}
          >
            {/* Status row */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    background:
                      syncStatus === "connected"
                        ? "oklch(0.72 0.14 74)"
                        : syncStatus === "loading"
                        ? "oklch(0.40 0 0)"
                        : "oklch(0.64 0.16 28)",
                  }}
                  aria-hidden
                />
                <span className="text-sm text-foreground">
                  {syncStatus === "loading"
                    ? "Checking…"
                    : syncStatus === "connected"
                    ? "Connected"
                    : "Not connected"}
                </span>
                {syncStatus === "connected" && syncedAt && (
                  <span className="text-xs text-muted-foreground">· synced at {syncedAt}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {syncStatus === "connected" ? (
                  <>
                    <SettingsButton onClick={() => setShowPicker(true)}>Change files</SettingsButton>
                    <SettingsButton onClick={disconnectMicrosoft} variant="ghost">
                      Disconnect
                    </SettingsButton>
                  </>
                ) : syncStatus === "disconnected" ? (
                  <SettingsButton onClick={() => { window.location.href = "/api/auth/microsoft"; }}>
                    Connect OneDrive
                  </SettingsButton>
                ) : null}
              </div>
            </div>

            {/* File selection summary */}
            {syncStatus === "connected" && (portfolioFile || budgetFile) ? (
              <>
                <div className="flex items-center gap-4 px-5 py-3.5 border-b border-border">
                  <span className="text-xs text-muted-foreground w-28 shrink-0">Portfolio</span>
                  <div>
                    <p className="text-sm text-foreground">{portfolioFile.split("/").pop() ?? portfolioFile}</p>
                    {portfolioSheet && <p className="text-xs text-muted-foreground">Sheet: {portfolioSheet}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-4 px-5 py-3.5">
                  <span className="text-xs text-muted-foreground w-28 shrink-0">Budget</span>
                  <div>
                    <p className="text-sm text-foreground">{budgetFile.split("/").pop() ?? budgetFile}</p>
                    {budgetSheet && <p className="text-xs text-muted-foreground">Sheet: {budgetSheet}</p>}
                  </div>
                </div>
              </>
            ) : syncStatus === "connected" ? (
              <div className="px-5 py-4">
                <p className="text-sm text-muted-foreground mb-3">No files selected yet.</p>
                <SettingsButton onClick={() => setShowPicker(true)}>Select Excel files</SettingsButton>
              </div>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Select which Excel files and sheets to use for your portfolio and budget data.
          </p>

          {/* File picker — shown inline below the connection box */}
          {showPicker && syncStatus === "connected" && (
            <div className="mt-3">
              <OneDriveFilePicker
                onSave={handlePickerSave}
                onCancel={() => setShowPicker(false)}
                initialPortfolio={portfolioFile ? { filePath: portfolioFile, sheetName: portfolioSheet } : undefined}
                initialBudget={budgetFile ? { filePath: budgetFile, sheetName: budgetSheet } : undefined}
              />
            </div>
          )}
        </section>

        {/* ── Account types ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Account types</h2>
          </div>

          <div
            className="rounded-sm border border-border overflow-hidden"
            style={{ background: "oklch(0.10 0 0)" }}
          >
            {accountsLoading ? (
              <p className="px-5 py-4 text-sm text-muted-foreground animate-pulse">Loading accounts…</p>
            ) : accounts.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                No accounts yet — upload a CSV or add a position first.
              </p>
            ) : (
              accounts.map((account, idx) => {
                const isLast = idx === accounts.length - 1;
                return (
                  <div
                    key={account.name}
                    className={`px-5 py-3.5 flex items-center gap-4 ${!isLast ? "border-b border-border" : ""}`}
                  >
                    <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
                      {account.name}
                    </span>
                    {savingTypes.has(account.name) && (
                      <span className="text-xs text-muted-foreground">Saving…</span>
                    )}
                    <select
                      value={account.type}
                      onChange={(e) => setAccountType(account.name, e.target.value as AccountType)}
                      className="h-7 text-xs rounded-sm px-2 border border-border text-foreground shrink-0"
                      style={{ background: "oklch(0.16 0 0)" }}
                      aria-label={`Type for ${account.name}`}
                    >
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Tags group accounts on the Accounts tab and filter the dashboard performance chart.
            Brokerage &amp; Retirement count as invested; Cash is held separately.
          </p>
        </section>

        {/* ── Profile ── */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-4">Profile</h2>
          <div
            className="rounded-sm border border-border overflow-hidden"
            style={{ background: "oklch(0.10 0 0)" }}
          >
            <EditableNameRow name={profile.name} loading={profile.loading} />
            <ProfileRow label="Email" value={profile.loading ? "…" : profile.email || "—"} last />
          </div>

          <div className="mt-4">
            <button
              className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-150 border border-border rounded-sm px-4 py-2"
              onClick={async () => {
                const supabase = createClient();
                await supabase.auth.signOut();
                window.location.href = "/login";
              }}
            >
              Sign out
            </button>
          </div>
        </section>

        {/* ── App version ── */}
        <p className="text-xs text-muted-foreground pb-4">fintrack · v0.1.0</p>
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function SettingsButton({
  children,
  onClick,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "ghost";
}) {
  return (
    <button
      onClick={onClick}
      className="text-xs px-3 py-1.5 rounded-sm border transition-colors duration-150"
      style={
        variant === "ghost"
          ? {
              borderColor: "transparent",
              color: "oklch(0.52 0.008 74)",
            }
          : {
              borderColor: "oklch(0.28 0 0)",
              color: "oklch(0.88 0.005 74)",
              background: "oklch(0.16 0 0)",
            }
      }
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor =
          variant === "ghost" ? "oklch(0.28 0 0)" : "oklch(0.72 0.14 74)";
        (e.currentTarget as HTMLButtonElement).style.color =
          "oklch(0.94 0.005 74)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor =
          variant === "ghost" ? "transparent" : "oklch(0.28 0 0)";
        (e.currentTarget as HTMLButtonElement).style.color =
          variant === "ghost" ? "oklch(0.52 0.008 74)" : "oklch(0.88 0.005 74)";
      }}
    >
      {children}
    </button>
  );
}

function ProfileRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 px-5 py-3.5 ${!last ? "border-b border-border" : ""}`}>
      <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

/* Editable display name → persisted to Supabase user_metadata.full_name */
function EditableNameRow({ name, loading }: { name: string; loading: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the field seeded from the live profile while not actively editing.
  useEffect(() => {
    if (!editing) setValue(name);
  }, [name, editing]);

  const save = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Name can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: upErr } = await supabase.auth.updateUser({ data: { full_name: trimmed } });
    setSaving(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setEditing(false); // useProfile picks up USER_UPDATED and refreshes everywhere
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
    setValue(name);
  };

  return (
    <div className="flex items-center gap-4 px-5 py-3.5 border-b border-border">
      <span className="text-xs text-muted-foreground w-28 shrink-0">Name</span>
      {editing ? (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            disabled={saving}
            maxLength={60}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              else if (e.key === "Escape") cancel();
            }}
            className="h-8 max-w-[240px]"
            placeholder="Your name"
            aria-label="Display name"
          />
          <button
            onClick={save}
            disabled={saving}
            className="rounded-sm px-3 py-1 text-xs font-medium transition-opacity duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={cancel}
            disabled={saving}
            className="rounded-sm border border-border px-3 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            Cancel
          </button>
          {error && <span className="text-xs" style={{ color: "var(--negative)" }}>{error}</span>}
        </div>
      ) : (
        <div className="flex flex-1 items-center gap-3">
          <span className="text-sm text-foreground">{loading ? "…" : name || "—"}</span>
          {!loading && (
            <button
              onClick={() => setEditing(true)}
              className="rounded-sm text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              Edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}
