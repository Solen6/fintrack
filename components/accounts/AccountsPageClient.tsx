"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/use-profile";
import { OneDriveFilePicker } from "./OneDriveFilePicker";

/* ─── Types ─── */
type AccountType = "investment" | "savings" | "checking" | "roth";

interface AccountRow {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  active: boolean;
}

const TYPE_LABELS: Record<AccountType, string> = {
  investment: "Brokerage",
  roth:       "Roth IRA",
  savings:    "Savings",
  checking:   "Checking",
};

/* ─── Initial state ─── */
const INITIAL_ACCOUNTS: AccountRow[] = [
  { id: "brokerage", name: "Brokerage",  institution: "Fidelity", type: "investment", active: true },
  { id: "roth",      name: "Roth IRA",   institution: "Fidelity", type: "roth",       active: true },
  { id: "hysa",      name: "HYSA",       institution: "Marcus",   type: "savings",    active: true },
  { id: "checking",  name: "Checking",   institution: "Chase",    type: "checking",   active: true },
];

export function AccountsPageClient() {
  const profile = useProfile();
  const [accounts, setAccounts] = useState<AccountRow[]>(INITIAL_ACCOUNTS);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const toggleActive = (id: string) =>
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, active: !a.active } : a))
    );

  const updateAccount = (id: string, field: keyof AccountRow, value: string) =>
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [field]: value } : a))
    );

  const removeAccount = (id: string) =>
    setAccounts((prev) => prev.filter((a) => a.id !== id));

  const addAccount = () => {
    const newId = `account-${Date.now()}`;
    setAccounts((prev) => [
      ...prev,
      { id: newId, name: "New Account", institution: "", type: "checking", active: true },
    ]);
    setEditingId(newId);
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

        {/* ── Accounts ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Accounts</h2>
            <SettingsButton onClick={addAccount}>+ Add account</SettingsButton>
          </div>

          <div
            className="rounded-sm border border-border overflow-hidden"
            style={{ background: "oklch(0.10 0 0)" }}
          >
            {accounts.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                No accounts configured.
              </p>
            ) : (
              accounts.map((account, idx) => {
                const isEditing = editingId === account.id;
                const isLast = idx === accounts.length - 1;

                return (
                  <div
                    key={account.id}
                    className={`px-5 py-3.5 flex items-center gap-4 ${!isLast ? "border-b border-border" : ""}`}
                  >
                    {/* Active toggle */}
                    <Switch
                      checked={account.active}
                      onCheckedChange={() => toggleActive(account.id)}
                      aria-label={`Toggle ${account.name}`}
                    />

                    {/* Name + institution */}
                    {isEditing ? (
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Input
                          value={account.name}
                          onChange={(e) => updateAccount(account.id, "name", e.target.value)}
                          className="h-7 text-sm w-36"
                          autoFocus
                        />
                        <Input
                          value={account.institution}
                          onChange={(e) => updateAccount(account.id, "institution", e.target.value)}
                          placeholder="Institution"
                          className="h-7 text-sm w-32"
                        />
                        <select
                          value={account.type}
                          onChange={(e) =>
                            updateAccount(account.id, "type", e.target.value as AccountType)
                          }
                          className="h-7 text-xs rounded-sm px-2 border border-border text-foreground"
                          style={{ background: "oklch(0.16 0 0)" }}
                        >
                          <option value="investment">Brokerage</option>
                          <option value="roth">Roth IRA</option>
                          <option value="savings">Savings</option>
                          <option value="checking">Checking</option>
                        </select>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className={`text-sm font-medium ${!account.active ? "text-muted-foreground" : "text-foreground"}`}>
                          {account.name}
                        </span>
                        {account.institution && (
                          <span className="text-xs text-muted-foreground">{account.institution}</span>
                        )}
                        <span
                          className="text-xs px-1.5 py-0.5 rounded-sm ml-1"
                          style={{
                            background: "oklch(0.16 0 0)",
                            color: "oklch(0.52 0.008 74)",
                          }}
                        >
                          {TYPE_LABELS[account.type]}
                        </span>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() =>
                          setEditingId((prev) =>
                            prev === account.id ? null : account.id
                          )
                        }
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 px-2 py-1"
                        aria-label={isEditing ? "Done editing" : `Edit ${account.name}`}
                      >
                        {isEditing ? "Done" : "Edit"}
                      </button>
                      <button
                        onClick={() => removeAccount(account.id)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 px-2 py-1"
                        aria-label={`Remove ${account.name}`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Investment accounts (Brokerage, Roth IRA) show holdings. Savings and Checking accounts show balance only.
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
        <p className="text-xs text-muted-foreground pb-4">fintrack · v0.1.0 · mock data mode</p>
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

function FileRow({
  label,
  value,
  onChange,
  placeholder,
  last,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 px-5 py-3.5 ${!last ? "border-b border-border" : ""}`}>
      <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 text-xs font-mono flex-1"
      />
    </div>
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
