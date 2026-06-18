/**
 * Account types — the normalized buckets every account is tagged with.
 *
 * Three buckets: Brokerage and Retirement are *invested*; Cash is cash-like
 * (HYSA / checking / money-market sweep). Stored per-account in the
 * `account_meta` table; the dashboard groups & filters the performance chart by
 * these. When an account has no stored type yet we fall back to a name heuristic
 * so existing accounts classify sensibly until the user sets one.
 */

export type AccountType = "brokerage" | "retirement" | "cash";

export interface AccountTypeDef {
  id: AccountType;
  label: string;
  /** Whether holdings in this type count as invested (vs. cash-like). */
  invested: boolean;
}

export const ACCOUNT_TYPES: AccountTypeDef[] = [
  { id: "brokerage", label: "Brokerage", invested: true },
  { id: "retirement", label: "Retirement", invested: true },
  { id: "cash", label: "Cash", invested: false },
];

export const DEFAULT_ACCOUNT_TYPE: AccountType = "brokerage";

const BY_ID = new Map(ACCOUNT_TYPES.map((t) => [t.id, t]));

export function accountTypeLabel(type: AccountType): string {
  return BY_ID.get(type)?.label ?? "Brokerage";
}

export function isInvestedType(type: AccountType): boolean {
  return BY_ID.get(type)?.invested ?? true;
}

/** Coerce an arbitrary stored string to a known type (defensive). */
export function normalizeAccountType(raw: string | null | undefined): AccountType {
  const v = (raw ?? "").toLowerCase();
  return v === "retirement" || v === "cash" || v === "brokerage" ? v : DEFAULT_ACCOUNT_TYPE;
}

/**
 * Best-effort type guess from an account name, used only when no explicit type
 * has been saved. Keeps the legacy HYSA/checking/cash → "cash" behavior and
 * routes obvious retirement names to "retirement".
 */
export function guessAccountType(name: string): AccountType {
  const n = name.toLowerCase();
  if (/\b(hysa|checking|savings|cash|money\s*market)\b/.test(n)) return "cash";
  if (/\b(roth|ira|401\s*k|403\s*b|retire|pension|sep)\b/.test(n)) return "retirement";
  return "brokerage";
}

/** Resolve an account's type: explicit stored type, else name-based guess. */
export function resolveAccountType(
  account: string,
  stored: Record<string, AccountType | string> | null | undefined,
): AccountType {
  const explicit = stored?.[account];
  if (explicit) return normalizeAccountType(explicit as string);
  return guessAccountType(account);
}
