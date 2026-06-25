// Client-safe metadata for the built-in news providers.
// Kept out of the API route so client components can import it without
// pulling in server-only modules (next/headers, supabase server client).

export const BUILTIN_SOURCES = [
  { key: "finnhub", name: "Finnhub", desc: "Company news for your portfolio tickers" },
  { key: "alphavantage", name: "Alpha Vantage", desc: "Market-wide financial news & sentiment" },
] as const;

export type BuiltinKey = (typeof BUILTIN_SOURCES)[number]["key"];
export type BuiltinPrefs = Record<BuiltinKey, boolean>;

export const BUILTIN_KEYS = BUILTIN_SOURCES.map((s) => s.key) as BuiltinKey[];

export const DEFAULT_BUILTIN_PREFS: BuiltinPrefs = { finnhub: true, alphavantage: true };
