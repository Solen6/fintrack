/**
 * Minimal Alpaca REST client (server-side only — never import into client code,
 * it reads secret keys). Covers the Trading API (paper) and Market Data API.
 *
 * Env vars (.env.local):
 *   ALPACA_API_KEY_ID       — your paper API key id
 *   ALPACA_API_SECRET_KEY   — your paper API secret
 *   ALPACA_TRADING_BASE_URL — defaults to the paper trading endpoint
 *   ALPACA_DATA_BASE_URL    — defaults to the market-data endpoint
 *
 * Paper trading base: https://paper-api.alpaca.markets
 * Live trading base:  https://api.alpaca.markets   (only when you go live)
 * Market data base:   https://data.alpaca.markets
 */

const KEY_ID = process.env.ALPACA_API_KEY_ID;
const SECRET = process.env.ALPACA_API_SECRET_KEY;
const TRADING_BASE = process.env.ALPACA_TRADING_BASE_URL ?? "https://paper-api.alpaca.markets";
const DATA_BASE = process.env.ALPACA_DATA_BASE_URL ?? "https://data.alpaca.markets";

export const alpacaConfigured = Boolean(KEY_ID && SECRET);

export class AlpacaError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AlpacaError";
    this.status = status;
  }
}

function authHeaders(): HeadersInit {
  if (!KEY_ID || !SECRET) {
    throw new AlpacaError("Alpaca API keys are not configured (set ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY).", 503);
  }
  return {
    "APCA-API-KEY-ID": KEY_ID,
    "APCA-API-SECRET-KEY": SECRET,
  };
}

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new AlpacaError(`Alpaca ${path} → ${res.status} ${detail}`, res.status);
  }
  return res.json() as Promise<T>;
}

/* ─── Trading API ─── */
export const trading = {
  get: <T>(path: string) => request<T>(TRADING_BASE, path),
  post: <T>(path: string, body: unknown) =>
    request<T>(TRADING_BASE, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  delete: <T>(path: string) => request<T>(TRADING_BASE, path, { method: "DELETE" }),
};

/* ─── Market Data API ─── */
export const data = {
  get: <T>(path: string) => request<T>(DATA_BASE, path),
};

/* ─── Common response shapes (partial — extend as needed) ─── */
export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  last_equity: string;
  buying_power: string;
  pattern_day_trader: boolean;
}
