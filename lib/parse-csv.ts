export interface ParsedHolding {
  ticker:     string;
  name:       string;
  shares:     number;
  cost_basis: number;
  account:    string;
  sector:     string;
}

export interface ParseResult {
  holdings: ParsedHolding[];
  errors:   string[];
  source:   "fidelity" | "generic";
}

/* ─── Fidelity CSV format detection ─── */
function isFidelityFormat(headers: string[]): boolean {
  return headers.some(h =>
    h.toLowerCase().includes("average cost basis") ||
    h.toLowerCase().includes("account name")
  );
}

/* ─── Parse a CSV string into rows ─── */
function parseCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  // Remove BOM if present
  const clean = text.replace(/^﻿/, "").trim();

  for (const line of clean.split("\n")) {
    if (!line.trim()) continue;
    const cols: string[] = [];
    let inQuote = false;
    let current = "";

    for (const ch of line) {
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        cols.push(current.trim().replace(/^"|"$/g, ""));
        current = "";
      } else {
        current += ch;
      }
    }
    cols.push(current.trim().replace(/^"|"$/g, ""));
    rows.push(cols);
  }
  return rows;
}

/* ─── Main parser ─── */
export function parsePortfolioCSV(text: string): ParseResult {
  const errors: string[] = [];
  const holdings: ParsedHolding[] = [];
  let skippedBonds = 0;

  const rows = parseCSVRows(text);
  if (rows.length < 2) {
    return { holdings: [], errors: ["File appears empty or unreadable."], source: "generic" };
  }

  // Find header row — skip any leading info rows Fidelity adds
  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    if (
      row.some(c => c.toLowerCase().includes("symbol")) ||
      row.some(c => c.toLowerCase().includes("ticker"))
    ) {
      headerIdx = i;
      break;
    }
  }

  const headers = rows[headerIdx].map(h => h.toLowerCase().trim());
  const isFidelity = isFidelityFormat(headers);
  const source = isFidelity ? "fidelity" : "generic";

  // Column index helpers
  const col = (names: string[]): number => {
    for (const name of names) {
      const idx = headers.findIndex(h => h.includes(name.toLowerCase()));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const tickerIdx       = col(["symbol", "ticker"]);
  const nameIdx         = col(["description", "name", "security"]);
  const sharesIdx       = col(["quantity", "shares"]);
  const costTotalIdx    = col(["cost basis total"]);
  const costPerShareIdx = col(["average cost basis", "cost basis per share", "avg cost", "cost/share", "purchase price"]);
  const accountIdx      = col(["account name", "account type", "account"]);
  const sectorIdx       = col(["sector"]);

  if (tickerIdx === -1 || sharesIdx === -1) {
    return {
      holdings: [],
      errors: ["Could not find required columns (Symbol/Ticker and Quantity/Shares). Make sure you're uploading a Fidelity positions CSV."],
      source,
    };
  }

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;

    // ─── Ignore bonds / CDs — this app tracks them via the Add Bond form, not
    // CSV import. Must run BEFORE the sanitizer below, which strips a 9-char
    // CUSIP (e.g. 91282CJK5) down to a bogus equity ticker (CJK) that would
    // otherwise leak in as a fake stock with `face value` as its share count. ───
    const rawSymbol = (row[tickerIdx] ?? "").trim().toUpperCase();
    const descRaw = nameIdx !== -1 ? (row[nameIdx] ?? "") : "";
    // A CUSIP is exactly 9 alphanumerics with at least one digit — never a real
    // equity/ETF ticker (those are 1–5 chars; "BRK.B"'s dot fails the char class).
    const isCusip = /^[0-9A-Z]{9}$/.test(rawSymbol) && /[0-9]/.test(rawSymbol);
    // Bond/CD descriptions carry a coupon rate (e.g. 4.250%) AND a maturity date.
    const looksLikeBondDesc =
      /\d+(?:\.\d+)?%/.test(descRaw) &&
      /\b(?:19|20)\d{2}\b|\d{1,2}\/\d{1,2}\/\d{2,4}/.test(descRaw);
    const isCd = /CERTIFICATE OF DEPOSIT|\bFDIC\b/.test(descRaw.toUpperCase());
    if (isCusip || looksLikeBondDesc || isCd) {
      skippedBonds++;
      continue;
    }

    const ticker = row[tickerIdx]?.trim().toUpperCase().replace(/[^A-Z.]/g, "");
    if (!ticker || ticker.length === 0 || ticker === "SYMBOL") continue;

    // Skip cash, money market, and pending rows
    if (["SPAXX", "FDRXX", "FZSXX", "FCASH", "--", ""].includes(ticker)) continue;
    if (ticker.startsWith("**") || ticker.startsWith("Pending")) continue;

    const name   = nameIdx !== -1 ? (row[nameIdx]?.trim() ?? ticker) : ticker;
    const shares = parseFloat((row[sharesIdx] ?? "0").replace(/[,$]/g, ""));

    // Prefer "Cost Basis Total" (Fidelity's precise dollar total) over per-share,
    // which Fidelity rounds to 2 decimal places causing compounding error on many shares.
    const totalRaw    = costTotalIdx    !== -1 ? row[costTotalIdx]?.replace(/[,$]/g, "")    : "";
    const perShareRaw = costPerShareIdx !== -1 ? row[costPerShareIdx]?.replace(/[,$]/g, "") : "";
    const costTotal   = totalRaw    ? parseFloat(totalRaw)    : NaN;
    const costPerShare = perShareRaw ? parseFloat(perShareRaw) : NaN;
    const cost = !isNaN(costTotal) && shares > 0
      ? costTotal / shares   // back-compute precise per-share from the total
      : !isNaN(costPerShare)
        ? costPerShare
        : 0;

    const accountRaw = accountIdx !== -1 ? row[accountIdx]?.trim().toLowerCase() : "";
    const account = normalizeAccount(accountRaw);
    const sector  = sectorIdx !== -1 ? (row[sectorIdx]?.trim() ?? "") : "";

    if (isNaN(shares) || shares <= 0) {
      errors.push(`Row ${i + 1}: skipped ${ticker} — invalid shares value.`);
      continue;
    }

    holdings.push({ ticker, name, shares, cost_basis: isNaN(cost) ? 0 : cost, account, sector });
  }

  if (skippedBonds > 0) {
    errors.push(
      `Skipped ${skippedBonds} bond/CD ${skippedBonds === 1 ? "row" : "rows"} — add fixed income with the “Add bond” button.`,
    );
  }

  return { holdings, errors, source };
}

function normalizeAccount(raw: string): string {
  if (!raw) return "brokerage";
  if (raw.includes("roth")) return "roth";
  if (raw.includes("ira")) return "roth";
  if (raw.includes("checking")) return "checking";
  if (raw.includes("saving") || raw.includes("hysa")) return "hysa";
  return "brokerage";
}
