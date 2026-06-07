"use client";

import { useState, useEffect } from "react";

interface OneDriveFile {
  id: string;
  name: string;
  path: string;
  size: number;
  lastModified: string;
}

interface SheetSelection {
  filePath: string;
  fileName: string;
  sheetName: string;
}

interface Props {
  onSave: (portfolio: SheetSelection, budget: SheetSelection) => void;
  onCancel: () => void;
  initialPortfolio?: { filePath: string; sheetName: string };
  initialBudget?: { filePath: string; sheetName: string };
}

type Step = "pick-portfolio-file" | "pick-portfolio-sheet" | "pick-budget-file" | "pick-budget-sheet" | "confirm";

export function OneDriveFilePicker({ onSave, onCancel, initialPortfolio, initialBudget }: Props) {
  const [step, setStep] = useState<Step>("pick-portfolio-file");
  const [files, setFiles] = useState<OneDriveFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [sheets, setSheets] = useState<{ id: string; name: string }[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [portfolio, setPortfolio] = useState<Partial<SheetSelection>>({});
  const [budget, setBudget] = useState<Partial<SheetSelection>>({});

  // Load files on mount
  useEffect(() => {
    fetch("/api/graph/files")
      .then((r) => r.json())
      .then((data) => {
        if (data.files) setFiles(data.files);
        else setFilesError(data.error ?? "Could not load files.");
      })
      .catch(() => setFilesError("Could not reach OneDrive."))
      .finally(() => setLoadingFiles(false));
  }, []);

  const loadSheets = async (path: string) => {
    setLoadingSheets(true);
    setSheets([]);
    const res = await fetch(`/api/graph/sheets?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    setSheets(data.sheets ?? []);
    setLoadingSheets(false);
  };

  const selectPortfolioFile = async (file: OneDriveFile) => {
    setPortfolio({ filePath: file.path, fileName: file.name });
    await loadSheets(file.path);
    setStep("pick-portfolio-sheet");
  };

  const selectPortfolioSheet = (sheetName: string) => {
    setPortfolio((p) => ({ ...p, sheetName }));
    setStep("pick-budget-file");
  };

  const selectBudgetFile = async (file: OneDriveFile) => {
    setBudget({ filePath: file.path, fileName: file.name });
    await loadSheets(file.path);
    setStep("pick-budget-sheet");
  };

  const selectBudgetSheet = (sheetName: string) => {
    setBudget((b) => ({ ...b, sheetName }));
    setStep("confirm");
  };

  const handleSave = () => {
    if (portfolio.filePath && portfolio.fileName && portfolio.sheetName &&
        budget.filePath && budget.fileName && budget.sheetName) {
      onSave(
        { filePath: portfolio.filePath, fileName: portfolio.fileName, sheetName: portfolio.sheetName },
        { filePath: budget.filePath, fileName: budget.fileName, sheetName: budget.sheetName }
      );
    }
  };

  const stepLabels: Record<Step, string> = {
    "pick-portfolio-file":  "Select portfolio file",
    "pick-portfolio-sheet": "Select portfolio sheet",
    "pick-budget-file":     "Select budget file",
    "pick-budget-sheet":    "Select budget sheet",
    "confirm":              "Confirm selection",
  };

  return (
    <div
      className="rounded-sm border border-border overflow-hidden"
      style={{ background: "oklch(0.10 0 0)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <p className="text-sm font-medium text-foreground">{stepLabels[step]}</p>
        <div className="flex items-center gap-2">
          {/* Step indicator */}
          {(["pick-portfolio-file","pick-portfolio-sheet","pick-budget-file","pick-budget-sheet","confirm"] as Step[]).map((s, i) => (
            <span
              key={s}
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: s === step
                  ? "oklch(0.72 0.14 74)"
                  : ["pick-portfolio-file","pick-portfolio-sheet","pick-budget-file","pick-budget-sheet","confirm"].indexOf(s) < ["pick-portfolio-file","pick-portfolio-sheet","pick-budget-file","pick-budget-sheet","confirm"].indexOf(step)
                  ? "oklch(0.40 0 0)"
                  : "oklch(0.22 0 0)",
              }}
              aria-hidden
            />
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 min-h-[200px]">

        {/* Loading files */}
        {loadingFiles && (
          <div className="flex items-center gap-2 py-8 justify-center">
            <div className="skeleton w-4 h-4 rounded-full" />
            <span className="text-sm text-muted-foreground">Loading OneDrive files…</span>
          </div>
        )}

        {/* Error */}
        {filesError && (
          <p className="text-sm py-8 text-center" style={{ color: "oklch(0.64 0.16 28)" }}>
            {filesError}
          </p>
        )}

        {/* File list */}
        {!loadingFiles && !filesError && (step === "pick-portfolio-file" || step === "pick-budget-file") && (
          <div className="flex flex-col gap-0.5">
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No Excel files found on your OneDrive.
              </p>
            ) : (
              files.map((file) => (
                <button
                  key={file.id}
                  onClick={() => step === "pick-portfolio-file" ? selectPortfolioFile(file) : selectBudgetFile(file)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-sm text-left transition-colors duration-150 hover:bg-accent group"
                >
                  <ExcelIcon />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{file.path}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    Select →
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        {/* Sheet list */}
        {(step === "pick-portfolio-sheet" || step === "pick-budget-sheet") && (
          <div className="flex flex-col gap-0.5">
            {loadingSheets ? (
              <div className="flex items-center gap-2 py-8 justify-center">
                <div className="skeleton w-4 h-4 rounded-full" />
                <span className="text-sm text-muted-foreground">Loading sheets…</span>
              </div>
            ) : sheets.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No sheets found in this file.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-2">
                  From: <span className="text-foreground">{step === "pick-portfolio-sheet" ? portfolio.fileName : budget.fileName}</span>
                </p>
                {sheets.map((sheet) => (
                  <button
                    key={sheet.id}
                    onClick={() => step === "pick-portfolio-sheet" ? selectPortfolioSheet(sheet.name) : selectBudgetSheet(sheet.name)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-sm text-left transition-colors duration-150 hover:bg-accent group"
                  >
                    <SheetIcon />
                    <span className="text-sm text-foreground flex-1">{sheet.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      Select →
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* Confirm */}
        {step === "confirm" && (
          <div className="flex flex-col gap-4 py-2">
            <ConfirmRow
              label="Portfolio"
              file={portfolio.fileName ?? ""}
              sheet={portfolio.sheetName ?? ""}
              onEdit={() => setStep("pick-portfolio-file")}
            />
            <ConfirmRow
              label="Budget"
              file={budget.fileName ?? ""}
              sheet={budget.sheetName ?? ""}
              onEdit={() => setStep("pick-budget-file")}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-border">
        <button
          onClick={() => {
            if (step === "pick-portfolio-file") { onCancel(); return; }
            const prev: Record<Step, Step> = {
              "pick-portfolio-file":  "pick-portfolio-file",
              "pick-portfolio-sheet": "pick-portfolio-file",
              "pick-budget-file":     "pick-portfolio-sheet",
              "pick-budget-sheet":    "pick-budget-file",
              "confirm":              "pick-budget-sheet",
            };
            setStep(prev[step]);
          }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
        >
          {step === "pick-portfolio-file" ? "Cancel" : "← Back"}
        </button>

        {step === "confirm" && (
          <button
            onClick={handleSave}
            className="text-xs px-4 py-1.5 rounded-sm font-medium transition-opacity duration-150"
            style={{ background: "oklch(0.72 0.14 74)", color: "oklch(0.08 0 0)" }}
          >
            Save selection
          </button>
        )}
      </div>
    </div>
  );
}

function ConfirmRow({ label, file, sheet, onEdit }: { label: string; file: string; sheet: string; onEdit: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
        <p className="text-sm text-foreground">{file}</p>
        <p className="text-xs text-muted-foreground">Sheet: {sheet}</p>
      </div>
      <button
        onClick={onEdit}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 shrink-0 mt-0.5"
      >
        Change
      </button>
    </div>
  );
}

function ExcelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect width="16" height="16" rx="2" fill="oklch(0.52 0.12 145)" />
      <path d="M4 5l2.5 3L4 11h1.5l1.75-2.2L9 11h1.5L8 8l2.5-3H9L7.25 7.2 5.5 5H4z" fill="white" />
    </svg>
  );
}

function SheetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="1" stroke="oklch(0.52 0.008 74)" strokeWidth="1.2" />
      <line x1="2" y1="6" x2="14" y2="6" stroke="oklch(0.52 0.008 74)" strokeWidth="1.2" />
      <line x1="6" y1="6" x2="6" y2="14" stroke="oklch(0.52 0.008 74)" strokeWidth="1.2" />
    </svg>
  );
}
