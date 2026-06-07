"use client";

import { useState, useRef, useCallback } from "react";
import { parsePortfolioCSV } from "@/lib/parse-csv";
import type { ParsedHolding } from "@/lib/parse-csv";
import { formatCurrency } from "@/lib/format";

interface Props {
  existingAccounts?: string[];
  onSaved: () => void;
  onCancel?: () => void;
}

export function CSVUploadPanel({ existingAccounts = [], onSaved, onCancel }: Props) {
  const [accountName, setAccountName] = useState("");
  const [parsed, setParsed] = useState<ParsedHolding[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv")) {
      setParseErrors(["Please upload a .csv file."]);
      setParsed(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const result = parsePortfolioCSV(text);
      setParsed(result.holdings);
      setParseErrors(result.errors);
      setSaveError(null);
    };
    reader.readAsText(file);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleSave = async () => {
    if (!parsed || parsed.length === 0 || !accountName.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountName: accountName.trim(), holdings: parsed }),
      });
      if (!res.ok) {
        const j = await res.json();
        setSaveError(j.error ?? "Failed to save.");
      } else {
        onSaved();
      }
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setParsed(null);
    setParseErrors([]);
    setSaveError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const isReplacing = accountName.trim() && existingAccounts.includes(accountName.trim());
  const canSave = parsed && parsed.length > 0 && accountName.trim().length > 0;

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Upload Account</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Export positions from your broker (Fidelity: Accounts → Positions → Download)
              and upload here. Each account is stored separately.
            </p>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-4"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Account name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Account name
          </label>
          <input
            type="text"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="e.g. Fidelity Brokerage, Vanguard Roth IRA, 401k…"
            className="w-full rounded-sm px-3 py-2 text-sm bg-transparent border outline-none transition-colors"
            style={{
              borderColor: accountName.trim() ? "oklch(0.30 0 0)" : "oklch(0.22 0 0)",
              color: "oklch(0.92 0 0)",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "oklch(0.72 0.14 74)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = accountName.trim() ? "oklch(0.30 0 0)" : "oklch(0.22 0 0)")}
          />
          {/* Existing account chips */}
          {existingAccounts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              <span className="text-xs text-muted-foreground">Existing:</span>
              {existingAccounts.map((name) => (
                <button
                  key={name}
                  onClick={() => setAccountName(name)}
                  className="text-xs px-2 py-0.5 rounded-sm transition-colors"
                  style={{
                    background: accountName === name ? "oklch(0.20 0.02 74)" : "oklch(0.14 0 0)",
                    color: accountName === name ? "oklch(0.72 0.14 74)" : "oklch(0.52 0.008 74)",
                    border: `1px solid ${accountName === name ? "oklch(0.40 0.06 74)" : "oklch(0.20 0 0)"}`,
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          {isReplacing && (
            <p className="text-xs" style={{ color: "oklch(0.72 0.14 74)" }}>
              Existing holdings in "{accountName.trim()}" will be replaced.
            </p>
          )}
        </div>

        {/* Drop zone */}
        {!parsed && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed rounded-md px-8 py-14 flex flex-col items-center gap-3 cursor-pointer transition-colors duration-150"
            style={{
              borderColor: dragging ? "oklch(0.72 0.14 74)" : "oklch(0.22 0 0)",
              background: dragging ? "oklch(0.12 0.01 74)" : "oklch(0.10 0 0)",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={28} height={28}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "oklch(0.52 0.008 74)" }}
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-sm text-muted-foreground">
              Drag & drop a CSV file, or{" "}
              <span style={{ color: "oklch(0.72 0.14 74)" }}>click to browse</span>
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>
        )}

        {/* Parse errors */}
        {parseErrors.length > 0 && (
          <div
            className="rounded-sm px-4 py-3 text-sm"
            style={{ background: "oklch(0.14 0.02 28)", color: "oklch(0.75 0.08 28)" }}
          >
            <p className="font-medium mb-1">
              {parsed && parsed.length > 0 ? "Warnings" : "Could not parse file"}
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              {parseErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        {/* Preview */}
        {parsed && parsed.length > 0 && (
          <>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">
                  {parsed.length} position{parsed.length !== 1 ? "s" : ""} found
                </p>
                <button
                  onClick={reset}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Choose different file
                </button>
              </div>
              <div
                className="rounded-md overflow-hidden border"
                style={{ borderColor: "oklch(0.20 0 0)" }}
              >
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr
                        className="border-b sticky top-0"
                        style={{ background: "oklch(0.12 0 0)", borderColor: "oklch(0.20 0 0)" }}
                      >
                        {["Ticker", "Name", "Shares", "Avg Cost", "Sector"].map((h) => (
                          <th
                            key={h}
                            className="px-3 py-2 text-left font-medium"
                            style={{ color: "oklch(0.52 0.008 74)" }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.map((h, i) => (
                        <tr
                          key={i}
                          className="border-b"
                          style={{ borderColor: "oklch(0.16 0 0)" }}
                        >
                          <td className="px-3 py-2 font-mono font-semibold text-foreground">
                            {h.ticker}
                          </td>
                          <td className="px-3 py-2 max-w-[200px] truncate" style={{ color: "oklch(0.60 0.008 74)" }}>
                            {h.name}
                          </td>
                          <td className="px-3 py-2 font-mono text-right" style={{ color: "oklch(0.60 0.008 74)" }}>
                            {h.shares.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 font-mono text-right" style={{ color: "oklch(0.60 0.008 74)" }}>
                            {h.cost_basis > 0 ? formatCurrency(h.cost_basis) : "—"}
                          </td>
                          <td className="px-3 py-2" style={{ color: "oklch(0.52 0.008 74)" }}>
                            {h.sector || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {saveError && (
              <p className="text-xs" style={{ color: "oklch(0.64 0.16 28)" }}>
                {saveError}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving || !canSave}
                className="px-5 py-2 rounded-sm text-sm font-medium transition-opacity disabled:opacity-40"
                style={{ background: "oklch(0.72 0.14 74)", color: "oklch(0.08 0 0)" }}
              >
                {saving
                  ? "Saving…"
                  : canSave
                  ? `Save ${parsed.length} holdings to "${accountName.trim()}"`
                  : "Enter an account name above"}
              </button>
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="px-5 py-2 rounded-sm text-sm text-muted-foreground hover:text-foreground transition-colors"
                  style={{ background: "oklch(0.12 0 0)" }}
                >
                  Cancel
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
