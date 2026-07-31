"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/use-profile";
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
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /* Load the user's real accounts (from holdings + cash, plus any declared in
     account_meta with nothing in them yet) and their current type tags +
     display names. */
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
        for (const name of (m?.accounts ?? []) as string[]) if (name) names.add(name);
        const list = Array.from(names)
          .sort((a, b) => a.localeCompare(b))
          .map((name) => ({ name, type: resolveAccountType(name, types) }));
        setAccounts(list);
        setDisplayNames(m?.displayNames ?? {});
      })
      .finally(() => setAccountsLoading(false));
  }, []);

  /* Rename an account's display label. The raw `account.name` stays the key
     used for holdings/cash filtering everywhere else — only the label shown
     to the user changes. Optimistic; reverts on error. */
  const renameAccount = async (rawName: string, newLabel: string) => {
    const prev = displayNames[rawName];
    setDisplayNames((d) => ({ ...d, [rawName]: newLabel }));
    const res = await fetch("/api/accounts/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: rawName, displayName: newLabel }),
    }).catch(() => null);
    if (!res?.ok) {
      setDisplayNames((d) => ({ ...d, [rawName]: prev ?? "" }));
      return false;
    }
    return true;
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/account/delete", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDeleteError(body.error || "Failed to delete account.");
        setDeleting(false);
        return;
      }
      const supabase = createClient();
      await supabase.auth.signOut();
      window.location.href = "/";
    } catch {
      setDeleteError("An unexpected error occurred.");
      setDeleting(false);
    }
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
                    <EditableAccountName
                      rawName={account.name}
                      displayName={displayNames[account.name]}
                      onSave={(label) => renameAccount(account.name, label)}
                    />
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
                window.location.href = "/";
              }}
            >
              Sign out
            </button>
          </div>
        </section>

        {/* ── Danger Zone ── */}
        <section>
          <h2 className="text-sm font-semibold mb-4" style={{ color: "var(--negative)" }}>Danger Zone</h2>
          <div className="rounded-sm border p-4 flex items-center justify-between gap-4" style={{ borderColor: "oklch(0.28 0.06 25)", background: "oklch(0.10 0.01 25)" }}>
            <div>
              <p className="text-sm text-foreground font-medium">Delete account</p>
              <p className="text-xs text-muted-foreground mt-0.5">Permanently deletes your account and all data. This cannot be undone.</p>
            </div>
            <button
              className="shrink-0 rounded-sm border px-4 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              style={{ borderColor: "var(--negative)", color: "var(--negative)", background: "transparent" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.64 0.16 28 / 0.12)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete account
            </button>
          </div>
        </section>

        {/* ── App version ── */}
        <p className="text-xs text-muted-foreground pb-4">fintrack · v0.1.0</p>
      </div>

      {/* ── Delete account confirmation modal ── */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowDeleteConfirm(false); setDeleteInput(""); setDeleteError(null); } }}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-sm border p-6 flex flex-col gap-4"
            style={{ background: "oklch(0.12 0 0)", borderColor: "oklch(0.22 0 0)" }}
          >
            <div>
              <h3 className="text-base font-semibold text-foreground">Delete account?</h3>
              <p className="text-sm text-muted-foreground mt-1">This will permanently delete your account and all holdings, snapshots, and history. There is no recovery.</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Type <span className="font-mono text-foreground">DELETE</span> to confirm</p>
              <Input
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder="DELETE"
                autoFocus
                className="h-9"
                onKeyDown={(e) => { if (e.key === "Escape") { setShowDeleteConfirm(false); setDeleteInput(""); setDeleteError(null); } }}
              />
              {deleteError && <p className="text-xs mt-1.5" style={{ color: "var(--negative)" }}>{deleteError}</p>}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                className="rounded-sm border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => { setShowDeleteConfirm(false); setDeleteInput(""); setDeleteError(null); }}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="rounded-sm px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                style={{ background: "var(--negative)", color: "#fff" }}
                disabled={deleteInput !== "DELETE" || deleting}
                onClick={handleDeleteAccount}
              >
                {deleting ? "Deleting…" : "Delete account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

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

/* Editable account label in the Account types list. `rawName` is the account's
   real identity (what holdings/cash rows actually store) — it never changes;
   only the displayed label does. Saving an empty value clears the alias and
   the row reverts to showing `rawName`. */
function EditableAccountName({
  rawName,
  displayName,
  onSave,
}: {
  rawName: string;
  displayName: string | undefined;
  onSave: (label: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(displayName ?? rawName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setValue(displayName ?? rawName);
  }, [displayName, rawName, editing]);

  const save = async () => {
    setSaving(true);
    setError(null);
    // Saving the raw name back is the same as clearing the alias.
    const trimmed = value.trim();
    const ok = await onSave(trimmed === rawName ? "" : trimmed);
    setSaving(false);
    if (!ok) { setError("Failed to save"); return; }
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
    setValue(displayName ?? rawName);
  };

  if (editing) {
    return (
      <div className="flex flex-1 min-w-0 flex-wrap items-center gap-2">
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
          className="h-7 max-w-[200px] text-sm"
          aria-label={`Rename ${rawName}`}
        />
        <button
          onClick={save}
          disabled={saving}
          className="rounded-sm px-2.5 py-1 text-xs font-medium transition-opacity duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={cancel}
          disabled={saving}
          className="rounded-sm border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          Cancel
        </button>
        {error && <span className="text-xs" style={{ color: "var(--negative)" }}>{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-w-0 items-center gap-2">
      <span className="text-sm font-medium text-foreground min-w-0 truncate">
        {displayName ?? rawName}
      </span>
      <button
        onClick={() => setEditing(true)}
        className="rounded-sm text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        aria-label={`Rename ${rawName}`}
      >
        Edit
      </button>
    </div>
  );
}
