/**
 * Competition domain logic: status, trade-rule enforcement, and leaderboard
 * scoring. A competition entry is a sandboxed paper account; its score is
 * derived from that account's daily equity snapshots (paper_snapshots).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./supabase/admin";
import type { AssetClass } from "./paper-types";

export type CompetitionScope = "private" | "global";
export type CompetitionStatus = "upcoming" | "active" | "ended";

export interface CompetitionRules {
  allowedAssetClasses?: AssetClass[];   // empty/absent = all four allowed
}

export interface CompetitionRow {
  id: string;
  creator_id: string;
  name: string;
  description: string | null;
  scope: CompetitionScope;
  invite_code: string | null;
  starting_cash: number;
  rules: CompetitionRules;
  starts_at: string;
  ends_at: string;
  created_at: string;
}

/** Client-facing shape of a competition (no creator_id / raw rules leaked). */
export interface CompetitionView {
  id: string;
  name: string;
  description: string | null;
  scope: CompetitionScope;
  status: CompetitionStatus;
  startingCash: number;
  startsAt: string;
  endsAt: string;
  allowedAssetClasses: AssetClass[];
  entrants: number;
  joined: boolean;
  isCreator: boolean;
  inviteCode: string | null;     // exposed only to the creator or a joined member
}

export function serializeCompetition(
  c: CompetitionRow,
  opts: { entrants: number; joined: boolean; meId: string }
): CompetitionView {
  const isCreator = c.creator_id === opts.meId;
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    scope: c.scope,
    status: competitionStatus(c),
    startingCash: Number(c.starting_cash),
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    allowedAssetClasses: c.rules?.allowedAssetClasses ?? [],
    entrants: opts.entrants,
    joined: opts.joined,
    isCreator,
    inviteCode: isCreator || opts.joined ? c.invite_code : null,
  };
}

/** A competition's lifecycle phase relative to now. */
export function competitionStatus(c: { starts_at: string; ends_at: string }, nowMs = Date.now()): CompetitionStatus {
  const start = Date.parse(c.starts_at);
  const end = Date.parse(c.ends_at);
  if (nowMs < start) return "upcoming";
  if (nowMs > end) return "ended";
  return "active";
}

/**
 * Throw a user-facing error if a trade isn't allowed in the account's
 * competition: trading only inside the window, and only in allowed asset
 * classes. A no-op for normal (non-competition) accounts.
 */
export async function assertTradeAllowed(
  db: SupabaseClient,
  account: { competition_id: string | null },
  assetClass: AssetClass
): Promise<void> {
  if (!account.competition_id) return;
  const { data } = await db.from("competitions").select("*").eq("id", account.competition_id).maybeSingle();
  const comp = data as CompetitionRow | null;
  if (!comp) return;   // competition was deleted — leave the orphaned sandbox tradable

  const status = competitionStatus(comp);
  if (status === "upcoming") throw new Error("This competition hasn't started yet.");
  if (status === "ended") throw new Error("This competition has ended — trading is closed.");

  const allowed = comp.rules?.allowedAssetClasses;
  if (allowed && allowed.length > 0 && !allowed.includes(assetClass)) {
    throw new Error(`This competition allows only: ${allowed.join(", ")}.`);
  }
}

/**
 * Join a competition: create a sandboxed paper account seeded with the
 * competition's starting cash (tagged with competition_id) and an entry row.
 * Idempotent — returns the existing entry if already joined. Rolls back the
 * sandbox account if the entry insert loses a join race.
 */
export async function joinCompetition(
  db: SupabaseClient,
  userId: string,
  comp: CompetitionRow
): Promise<{ entryId: string; accountId: string; alreadyJoined: boolean }> {
  const { data: existing } = await db
    .from("competition_entries")
    .select("id, account_id")
    .eq("competition_id", comp.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return { entryId: existing.id, accountId: existing.account_id, alreadyJoined: true };

  const { data: acc, error: accErr } = await db
    .from("paper_accounts")
    .insert({
      user_id: userId,
      name: comp.name.slice(0, 40),
      cash: comp.starting_cash,
      starting_cash: comp.starting_cash,
      competition_id: comp.id,
    })
    .select("id")
    .single();
  if (accErr || !acc) throw new Error(accErr?.message ?? "Could not create competition account.");

  const { data: entry, error: entryErr } = await db
    .from("competition_entries")
    .insert({ competition_id: comp.id, user_id: userId, account_id: acc.id })
    .select("id")
    .single();
  if (entryErr || !entry) {
    // Lost a join race (or other failure) — drop the orphan sandbox account.
    await db.from("paper_accounts").delete().eq("id", acc.id);
    const { data: raced } = await db
      .from("competition_entries")
      .select("id, account_id")
      .eq("competition_id", comp.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (raced) return { entryId: raced.id, accountId: raced.account_id, alreadyJoined: true };
    throw new Error(entryErr?.message ?? "Could not join competition.");
  }
  return { entryId: entry.id, accountId: acc.id, alreadyJoined: false };
}

/* ─── Scoring ─── */

export interface EntryScore {
  lastEquity: number;
  lastReturnPct: number;
  sharpe: number | null;     // null until ≥2 daily returns exist or if flat
  maxDrawdown: number;       // percent (0+)
}

/** Annualized Sharpe of a daily-return series (risk-free ≈ 0 for a contest). */
function sharpeRatio(returns: number[]): number | null {
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  if (sd < 1e-9) return null;           // no variation → undefined ratio
  return (mean / sd) * Math.sqrt(252);
}

/** Worst peak-to-trough drawdown of an equity series, as a positive percent. */
function maxDrawdownPct(series: number[]): number {
  let peak = series[0] ?? 0;
  let worst = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > worst) worst = dd;
  }
  return worst * 100;
}

/**
 * Derive an entry's leaderboard score from its equity snapshots (oldest→newest)
 * and its starting cash. Day-1 return is measured against starting cash so a
 * one-day-old entry still ranks.
 */
export function scoreFromSnapshots(snaps: { equity: number }[], startingCash: number): EntryScore {
  if (snaps.length === 0) {
    return { lastEquity: startingCash, lastReturnPct: 0, sharpe: null, maxDrawdown: 0 };
  }
  const equities = snaps.map((s) => Number(s.equity));
  const lastEquity = equities[equities.length - 1];
  const lastReturnPct = startingCash > 0 ? ((lastEquity - startingCash) / startingCash) * 100 : 0;

  const returns: number[] = [];
  let prev = startingCash;
  for (const eq of equities) {
    if (prev > 0) returns.push((eq - prev) / prev);
    prev = eq;
  }

  return {
    lastEquity,
    lastReturnPct,
    sharpe: sharpeRatio(returns),
    maxDrawdown: maxDrawdownPct([startingCash, ...equities]),
  };
}

/**
 * Recompute and persist the score for every competition entry a user owns.
 * Run by the cron AFTER captureSnapshot, so it reads the freshest equity.
 * Uses the (admin/service-role) client, which bypasses RLS to write scores.
 */
export async function scoreUserEntries(db: SupabaseClient, userId: string): Promise<number> {
  const { data: entries } = await db
    .from("competition_entries")
    .select("id, account_id")
    .eq("user_id", userId);
  const list = (entries ?? []) as { id: string; account_id: string }[];
  if (list.length === 0) return 0;

  let scored = 0;
  for (const e of list) {
    const { data: acc } = await db
      .from("paper_accounts")
      .select("starting_cash")
      .eq("id", e.account_id)
      .maybeSingle();
    if (!acc) continue;

    const { data: snaps } = await db
      .from("paper_snapshots")
      .select("equity, snapshot_date")
      .eq("account_id", e.account_id)
      .order("snapshot_date");

    const score = scoreFromSnapshots((snaps ?? []) as { equity: number }[], Number(acc.starting_cash));
    await db
      .from("competition_entries")
      .update({
        last_equity: score.lastEquity,
        last_return_pct: score.lastReturnPct,
        sharpe: score.sharpe,
        max_drawdown: score.maxDrawdown,
        score_updated_at: new Date().toISOString(),
      })
      .eq("id", e.id);
    scored++;
  }
  return scored;
}

/**
 * Lazily refresh one competition entry's leaderboard score from live equity —
 * called when a player opens/trades their own competition sandbox, so the board
 * reflects current performance between daily cron runs. Snapshots today's equity
 * and recomputes the score. Uses the service-role client because the value is
 * server-computed (never user-supplied) and the entry's score columns are
 * deliberately not user-writable under RLS. No-op for non-competition accounts.
 */
export async function refreshEntryScore(
  account: { id: string; user_id: string; competition_id: string | null; starting_cash: number },
  equity: number,
  cash: number
): Promise<void> {
  if (!account.competition_id) return;
  const admin = createAdminClient();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  await admin.from("paper_snapshots").upsert(
    { user_id: account.user_id, account_id: account.id, snapshot_date: today, equity, cash },
    { onConflict: "account_id,snapshot_date" }
  );

  const { data: snaps } = await admin
    .from("paper_snapshots")
    .select("equity, snapshot_date")
    .eq("account_id", account.id)
    .order("snapshot_date");

  const score = scoreFromSnapshots((snaps ?? []) as { equity: number }[], Number(account.starting_cash));
  await admin
    .from("competition_entries")
    .update({
      last_equity: score.lastEquity,
      last_return_pct: score.lastReturnPct,
      sharpe: score.sharpe,
      max_drawdown: score.maxDrawdown,
      score_updated_at: new Date().toISOString(),
    })
    .eq("account_id", account.id);
}

/* ─── Finalization + career records ─── */

/**
 * Finalize every competition that has ended and isn't finalized yet: rank its
 * entries by total return (the primary board), write one frozen
 * competition_results row each (final_rank, return_pct, is_winner), then stamp
 * finalized_at so it scores exactly once. Returns the number finalized. Run by
 * the cron AFTER per-user scoring so final ranks use the freshest returns.
 */
export async function finalizeEndedCompetitions(db: SupabaseClient): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data: ended, error } = await db
    .from("competitions")
    .select("id")
    .lt("ends_at", nowIso)
    .is("finalized_at", null);
  if (error) return 0;   // pre-migration (finalized_at column missing)

  let finalized = 0;
  for (const comp of (ended ?? []) as { id: string }[]) {
    const { data: entries } = await db
      .from("competition_entries")
      .select("user_id, last_return_pct")
      .eq("competition_id", comp.id);

    const ranked = [...((entries ?? []) as { user_id: string; last_return_pct: number | null }[])]
      .sort((a, b) => Number(b.last_return_pct ?? 0) - Number(a.last_return_pct ?? 0));

    let rank = 1;
    for (const e of ranked) {
      await db.from("competition_results").upsert(
        {
          competition_id: comp.id,
          user_id: e.user_id,
          final_rank: rank,
          return_pct: Number(e.last_return_pct ?? 0),
          is_winner: rank === 1,
        },
        { onConflict: "competition_id,user_id" }
      );
      rank++;
    }
    await db.from("competitions").update({ finalized_at: nowIso }).eq("id", comp.id);
    finalized++;
  }
  return finalized;
}

export interface CareerStat {
  userId: string;
  handle: string;
  avatar: string | null;
  wins: number;       // 1st-place finishes
  podiums: number;    // top-3 finishes
  played: number;     // finalized competitions entered
}

/**
 * All-time career standings from competition_results, sorted for the podium
 * (wins, then podiums, then most played). Reads public-read tables, so it works
 * with the caller's authed client. Empty if the results table isn't there yet.
 */
export async function careerStandings(db: SupabaseClient): Promise<CareerStat[]> {
  const { data, error } = await db.from("competition_results").select("user_id, final_rank");
  if (error) return [];

  const agg = new Map<string, { wins: number; podiums: number; played: number }>();
  for (const r of (data ?? []) as { user_id: string; final_rank: number }[]) {
    const s = agg.get(r.user_id) ?? { wins: 0, podiums: 0, played: 0 };
    s.played++;
    if (r.final_rank === 1) s.wins++;
    if (r.final_rank <= 3) s.podiums++;
    agg.set(r.user_id, s);
  }
  const userIds = [...agg.keys()];
  if (userIds.length === 0) return [];

  const { data: profiles } = await db
    .from("public_profiles")
    .select("user_id, handle, avatar")
    .in("user_id", userIds);
  const profMap = new Map(
    ((profiles ?? []) as { user_id: string; handle: string; avatar: string | null }[]).map((p) => [p.user_id, p])
  );

  return userIds
    .map((uid) => {
      const s = agg.get(uid)!;
      const p = profMap.get(uid);
      return { userId: uid, handle: p?.handle ?? "Anonymous", avatar: p?.avatar ?? null, ...s };
    })
    .sort((a, b) => b.wins - a.wins || b.podiums - a.podiums || b.played - a.played);
}
