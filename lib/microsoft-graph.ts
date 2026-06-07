/* ─── Microsoft Graph API client ─── */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_URL = `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;

export const MICROSOFT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "Files.Read",
].join(" ");

export function getMicrosoftAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id:     process.env.MICROSOFT_CLIENT_ID!,
    response_type: "code",
    redirect_uri:  `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/microsoft/callback`,
    scope:         MICROSOFT_SCOPES,
    state,
    response_mode: "query",
    prompt:        "select_account",
  });
  return `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize?${params}`;
}

export interface TokenResponse {
  access_token:  string;
  refresh_token: string;
  expires_in:    number;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      code,
      redirect_uri:  `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/microsoft/callback`,
      grant_type:    "authorization_code",
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
      scope:         MICROSOFT_SCOPES,
    }),
  });
  if (!res.ok) throw new Error("Token refresh failed");
  return res.json();
}

/* ─── Excel data fetching ─── */

export interface SheetRange {
  values: (string | number | boolean | null)[][];
}

export async function getWorksheetRange(
  accessToken: string,
  filePath: string,
  sheetName: string
): Promise<SheetRange> {
  const encodedPath = encodeURIComponent(filePath);
  const url = `${GRAPH_BASE}/me/drive/root:/${encodedPath}:/workbook/worksheets/${sheetName}/usedRange`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error ${res.status}: ${err}`);
  }

  return res.json();
}

export async function listWorksheets(
  accessToken: string,
  filePath: string
): Promise<{ id: string; name: string }[]> {
  const encodedPath = encodeURIComponent(filePath);
  const url = `${GRAPH_BASE}/me/drive/root:/${encodedPath}:/workbook/worksheets`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    next: { revalidate: 0 },
  });

  if (!res.ok) throw new Error(`Could not list worksheets: ${res.status}`);
  const data = await res.json();
  return data.value ?? [];
}

/* ─── Excel → app type parsers ─── */

import type { Holding } from "./types";
import type { Transaction, BudgetCategoryId } from "./budget-data";

/**
 * Expected columns (row 0 = headers, ignored):
 * A: Ticker | B: Account | C: Shares | D: Cost Basis | E: Sector | F: Notes
 */
export function parseHoldingsSheet(range: SheetRange): Holding[] {
  const [_header, ...rows] = range.values;
  const holdings: Holding[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue; // skip empty rows

    const ticker    = String(row[0] ?? "").trim().toUpperCase();
    const account   = String(row[1] ?? "").trim().toLowerCase().replace(/\s+/g, "") as Holding["account"];
    const shares    = parseFloat(String(row[2] ?? "0"));
    const costBasis = parseFloat(String(row[3] ?? "0"));
    const sector    = String(row[4] ?? "").trim() || "Unknown";
    const notes     = row[5] ? String(row[5]).trim() : undefined;

    if (!ticker || isNaN(shares) || isNaN(costBasis)) continue;

    // Normalize account names from Excel to app IDs
    const accountMap: Record<string, Holding["account"]> = {
      brokerage:    "brokerage",
      "roth":       "roth",
      "rothira":    "roth",
      "roth ira":   "roth",
      hysa:         "hysa",
      checking:     "checking",
    };

    const normalizedAccount = accountMap[account] ?? "brokerage";

    holdings.push({
      id:           `excel-${i}`,
      ticker,
      name:         ticker, // real name fetched from market data API later
      sector,
      shares,
      costBasis,
      currentPrice: costBasis, // placeholder — updated by market data API
      account:      normalizedAccount,
      notes,
    });
  }

  return holdings;
}

/**
 * Expected columns (row 0 = headers, ignored):
 * A: Date (YYYY-MM-DD) | B: Category | C: Description | D: Amount
 * Income rows: Category = "Income", Amount = positive number
 */
export function parseTransactionsSheet(range: SheetRange): {
  transactions: Transaction[];
  incomeByMonth: Record<string, number>;
} {
  const [_header, ...rows] = range.values;
  const transactions: Transaction[] = [];
  const incomeByMonth: Record<string, number> = {};

  const categoryMap: Record<string, BudgetCategoryId> = {
    "subscriptions":  "subscriptions",
    "subscription":   "subscriptions",
    "groceries/gas":  "groceries",
    "groceries":      "groceries",
    "gas":            "groceries",
    "entertainment":  "entertainment",
    "eating out":     "eatingout",
    "eatingout":      "eatingout",
    "dining":         "eatingout",
    "medical":        "medical",
    "health":         "medical",
    "gifts":          "gifts",
    "gift":           "gifts",
    "miscellaneous":  "miscellaneous",
    "misc":           "miscellaneous",
    "dates":          "dates",
    "date":           "dates",
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;

    const dateRaw    = String(row[0] ?? "").trim();
    const categoryRaw = String(row[1] ?? "").trim().toLowerCase();
    const description = String(row[2] ?? "").trim();
    const amount      = parseFloat(String(row[3] ?? "0"));

    if (!dateRaw || isNaN(amount)) continue;

    // Handle Excel serial date numbers (days since 1900-01-01)
    let date = dateRaw;
    if (/^\d+$/.test(dateRaw)) {
      const excelEpoch = new Date(1899, 11, 30);
      excelEpoch.setDate(excelEpoch.getDate() + parseInt(dateRaw));
      date = excelEpoch.toISOString().split("T")[0];
    }

    const monthKey = date.slice(0, 7); // "YYYY-MM"

    if (categoryRaw === "income") {
      incomeByMonth[monthKey] = (incomeByMonth[monthKey] ?? 0) + amount;
      continue;
    }

    const category = categoryMap[categoryRaw] ?? "miscellaneous";

    transactions.push({
      id:          `excel-${i}`,
      category,
      description: description || category,
      amount:      Math.abs(amount),
      date,
    });
  }

  return { transactions, incomeByMonth };
}
