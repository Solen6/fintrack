"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatCurrency, formatPercent } from "@/lib/format";

/* ─── Types (mirror the API) ─── */
type Scope = "private" | "global";
type Status = "upcoming" | "active" | "ended";
const ASSET_CLASSES = ["STOCK", "OPTION", "FUTURE", "FOREX"] as const;
type AssetClass = (typeof ASSET_CLASSES)[number];

interface Competition {
  id: string;
  name: string;
  description: string | null;
  scope: Scope;
  status: Status;
  startingCash: number;
  startsAt: string;
  endsAt: string;
  allowedAssetClasses: AssetClass[];
  entrants: number;
  joined: boolean;
  isCreator: boolean;
  inviteCode: string | null;
}
interface LeaderRow {
  userId: string;
  handle: string;
  avatar: string | null;
  returnPct: number;
  equity: number;
  sharpe: number | null;
  maxDrawdown: number;
  scoreUpdatedAt: string | null;
  isMe: boolean;
}
interface FeedRow {
  id: string;
  handle: string;
  symbol: string;
  assetClass: string;
  side: string;
  qty: number;
  price: number | null;
  filledAt: string | null;
  isMe: boolean;
}
interface Profile { handle: string; avatar: string | null }
interface CareerStat {
  userId: string;
  handle: string;
  avatar: string | null;
  wins: number;
  podiums: number;
  played: number;
  isMe: boolean;
}

type Board = "return" | "sharpe" | "drawdown";
const BOARDS: { key: Board; label: string }[] = [
  { key: "return", label: "Total Return" },
  { key: "sharpe", label: "Risk-Adjusted" },
  { key: "drawdown", label: "Lowest Drawdown" },
];

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";

export function CompetitionsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The selected competition lives in the URL (?id=…) so it's reload-safe,
  // shareable, and back/forward-aware — the URL is the single source of truth.
  const selectedId = searchParams.get("id");
  const view: "list" | "detail" = selectedId ? "detail" : "list";

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [global, setGlobal] = useState<Competition[]>([]);
  const [mine, setMine] = useState<Competition[]>([]);
  const [career, setCareer] = useState<CareerStat[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Competition | null>(null);
  const [myAccountId, setMyAccountId] = useState<string | null>(null);
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [board, setBoard] = useState<Board>("return");
  const [detailLoading, setDetailLoading] = useState(false);

  const [modal, setModal] = useState<null | "create" | "join" | "handle">(null);
  const [busy, setBusy] = useState(false);

  /* ── loaders ── */
  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/profile");
      const json = await res.json();
      setProfile(json.profile ?? null);
    } finally {
      setProfileLoaded(true);
    }
  }, []);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/competitions");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load competitions.");
      setGlobal(json.global ?? []);
      setMine(json.mine ?? []);
      setCareer(json.career ?? []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Failed to load competitions.");
    }
  }, []);

  const refreshDetail = useCallback(async (id: string) => {
    const [lb, fd] = await Promise.all([
      fetch(`/api/competitions/${id}/leaderboard`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/competitions/${id}/feed`).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (lb) { setRows(lb.rows ?? []); setDetail(lb.competition ?? null); }
    if (fd) setFeed(fd.feed ?? []);
  }, []);

  // Navigation just changes the URL; the effect below reacts and loads the data.
  const openDetail = useCallback((id: string) => {
    router.push(`/competitions?id=${encodeURIComponent(id)}`, { scroll: false });
  }, [router]);

  const backToList = useCallback(() => {
    router.push("/competitions", { scroll: false });
    loadList();
  }, [router, loadList]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const d = await fetch(`/api/competitions/${id}`).then((r) => (r.ok ? r.json() : null));
      if (d) { setDetail(d.competition); setMyAccountId(d.myAccountId ?? null); }
      await refreshDetail(id);
    } finally {
      setDetailLoading(false);
    }
  }, [refreshDetail]);

  useEffect(() => { loadProfile(); loadList(); }, [loadProfile, loadList]);

  // Load the selected competition whenever the URL id changes (click, reload,
  // back/forward). Clearing the id returns to the list.
  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  // Live refresh of standings + feed while viewing a competition.
  useEffect(() => {
    if (!selectedId) return;
    const t = setInterval(() => refreshDetail(selectedId), 20_000);
    return () => clearInterval(t);
  }, [selectedId, refreshDetail]);

  /* ── actions ── */
  async function join(comp: Competition, inviteCode?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/competitions/${comp.id}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error ?? "Could not join."); return false; }
      await loadList();
      await openDetail(comp.id);
      return true;
    } finally { setBusy(false); }
  }

  async function leave(comp: Competition) {
    if (!window.confirm(`Leave "${comp.name}"? Your sandbox account will be removed.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/competitions/${comp.id}/leave`, { method: "POST" });
      if (!res.ok) { alert((await res.json()).error); return; }
      backToList();
    } finally { setBusy(false); }
  }

  async function remove(comp: Competition) {
    if (!window.confirm(`Delete "${comp.name}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/competitions/${comp.id}`, { method: "DELETE" });
      if (!res.ok) { alert((await res.json()).error); return; }
      backToList();
    } finally { setBusy(false); }
  }

  return (
    <>
      {view === "detail" ? (
        <CompetitionDetail
          comp={detail}
          loading={detailLoading}
          rows={rows}
          feed={feed}
          board={board}
          setBoard={setBoard}
          myAccountId={myAccountId}
          profile={profile}
          busy={busy}
          onBack={backToList}
          onJoin={join}
          onLeave={leave}
          onDelete={remove}
          onSetHandle={() => setModal("handle")}
        />
      ) : (
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-[1100px] flex flex-col gap-6">
        {/* header */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-foreground">Competitions</h1>
            <p className="text-xs text-muted-foreground">Compete on a sandboxed $100k — global leaderboards or private leagues.</p>
          </div>
          <HandleChip profile={profile} loaded={profileLoaded} onClick={() => setModal("handle")} />
          <button onClick={() => setModal("join")} className="text-xs px-3 py-1.5 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-input transition-colors">Join by code</button>
          <button onClick={() => setModal("create")} className="text-xs px-3 py-1.5 rounded-sm font-medium" style={{ background: "var(--primary)", color: "oklch(0.08 0 0)" }}>Create</button>
        </div>

        {listError && <p className="text-xs" style={{ color: "var(--negative)" }}>{listError}</p>}

        <HallOfFame career={career} />

        <Section title="Your competitions">
          {mine.length === 0 ? (
            <Empty>You haven&apos;t joined any competitions yet. Join a global one below or create your own.</Empty>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {mine.map((c) => <CompetitionCard key={c.id} comp={c} onOpen={() => openDetail(c.id)} />)}
            </div>
          )}
        </Section>

        <Section title="Global">
          {global.length === 0 ? (
            <Empty>No global competitions yet — be the first to create one.</Empty>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {global.map((c) => (
                <CompetitionCard key={c.id} comp={c} onOpen={() => openDetail(c.id)} onJoin={!c.joined ? () => join(c) : undefined} busy={busy} />
              ))}
            </div>
          )}
        </Section>
      </div>
      </div>
      )}

      {modal === "create" && (
        <CreateModal
          busy={busy}
          onClose={() => setModal(null)}
          onCreate={async (payload) => {
            setBusy(true);
            try {
              const res = await fetch("/api/competitions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
              const json = await res.json();
              if (!res.ok) { alert(json.error ?? "Could not create."); return; }
              setModal(null);
              await loadList();
              await openDetail(json.competition.id);
            } finally { setBusy(false); }
          }}
        />
      )}
      {modal === "join" && (
        <JoinCodeModal
          busy={busy}
          onClose={() => setModal(null)}
          onLookup={async (code) => {
            const res = await fetch(`/api/competitions?code=${encodeURIComponent(code)}`);
            if (!res.ok) return null;
            return (await res.json()).competition as Competition;
          }}
          onJoin={async (comp, code) => { const ok = await join(comp, code); if (ok) setModal(null); }}
        />
      )}
      {modal === "handle" && (
        <HandleModal
          current={profile?.handle ?? ""}
          busy={busy}
          onClose={() => setModal(null)}
          onSave={async (handle) => {
            setBusy(true);
            try {
              const res = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle }) });
              const json = await res.json();
              if (!res.ok) { alert(json.error ?? "Could not save handle."); return; }
              setProfile(json.profile);
              setModal(null);
            } finally { setBusy(false); }
          }}
        />
      )}
    </>
  );
}

/* ─── List pieces ─── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground rounded-md border border-border bg-card px-4 py-6 text-center">{children}</p>;
}

function HandleChip({ profile, loaded, onClick }: { profile: Profile | null; loaded: boolean; onClick: () => void }) {
  if (!loaded) return null;
  return (
    <button onClick={onClick} className="text-xs px-3 py-1.5 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-input transition-colors">
      {profile?.handle ? <>@{profile.handle}</> : "Set handle"}
    </button>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { color: string; bg: string; label: string }> = {
    upcoming: { color: "var(--steel)", bg: "oklch(0.16 0.03 240)", label: "Upcoming" },
    active: { color: "var(--positive)", bg: "oklch(0.16 0.04 152)", label: "Active" },
    ended: { color: "oklch(0.64 0.008 74)", bg: "oklch(0.16 0 0)", label: "Ended" },
  };
  const c = map[status];
  return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-sm" style={{ color: c.color, background: c.bg }}>{c.label}</span>;
}

function CompetitionCard({ comp, onOpen, onJoin, busy }: { comp: Competition; onOpen: () => void; onJoin?: () => void; busy?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card p-4 flex flex-col gap-2 hover:border-input transition-colors">
      <div className="flex items-start justify-between gap-2">
        <button onClick={onOpen} className="text-sm font-medium text-foreground text-left hover:underline truncate">{comp.name}</button>
        <StatusPill status={comp.status} />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{comp.scope === "global" ? "Global" : "Private"}</span>
        <span>·</span>
        <span>{comp.entrants} {comp.entrants === 1 ? "player" : "players"}</span>
        <span>·</span>
        <span>{formatCurrency(comp.startingCash)}</span>
      </div>
      <div className="text-xs text-muted-foreground">{fmtDate(comp.startsAt)} – {fmtDate(comp.endsAt)}</div>
      {comp.allowedAssetClasses.length > 0 && (
        <div className="text-[10px] text-muted-foreground">Only: {comp.allowedAssetClasses.join(", ")}</div>
      )}
      <div className="flex items-center gap-2 mt-1">
        <button onClick={onOpen} className="text-xs px-2.5 py-1 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-input transition-colors">
          {comp.joined ? "Open" : "View"}
        </button>
        {onJoin && comp.status !== "ended" && (
          <button onClick={onJoin} disabled={busy} className="text-xs px-2.5 py-1 rounded-sm font-medium disabled:opacity-50" style={{ background: "var(--primary)", color: "oklch(0.08 0 0)" }}>Join</button>
        )}
      </div>
    </div>
  );
}

/* ─── Hall of Fame: career podium + standings ─── */
function HallOfFame({ career }: { career: CareerStat[] }) {
  return (
    <Section title="Hall of Fame">
      {career.length === 0 ? (
        <Empty>No champions yet — win a competition to claim the top of the podium.</Empty>
      ) : (
        <>
          <Podium career={career} />
          <CareerStandings career={career} />
        </>
      )}
    </Section>
  );
}

const MEDALS = ["🥇", "🥈", "🥉"];
const PODIUM_SLOTS = [
  { rank: 2, h: 76, color: "oklch(0.70 0.02 240)", bg: "oklch(0.16 0.02 240)" },
  { rank: 1, h: 104, color: "var(--primary)", bg: "oklch(0.18 0.05 74)" },
  { rank: 3, h: 60, color: "oklch(0.62 0.07 60)", bg: "oklch(0.15 0.03 60)" },
];

function Podium({ career }: { career: CareerStat[] }) {
  const top = career.slice(0, 3);
  const order = [top[1], top[0], top[2]]; // 2nd · 1st · 3rd, left → right
  return (
    <div className="rounded-md border border-border bg-card px-4 pt-5 flex items-end justify-center gap-3 sm:gap-5">
      {PODIUM_SLOTS.map((slot, i) => {
        const p = order[i];
        if (!p) return <div key={slot.rank} className="w-24" />;
        return (
          <div key={slot.rank} className="flex flex-col items-center gap-1.5 w-24">
            <span className="text-2xl leading-none" aria-hidden>{MEDALS[slot.rank - 1]}</span>
            <span className="text-sm font-medium text-foreground truncate max-w-full" title={p.handle}>
              {p.handle}{p.isMe && <span className="text-[10px] text-muted-foreground"> (you)</span>}
            </span>
            <div className="w-full rounded-t-sm flex flex-col items-center justify-center gap-0.5 pt-2" style={{ height: slot.h, background: slot.bg, borderTop: `2px solid ${slot.color}` }}>
              <span className="font-mono text-xl leading-none" style={{ color: slot.color }}>{p.wins}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{p.wins === 1 ? "win" : "wins"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CareerStandings({ career }: { career: CareerStat[] }) {
  return (
    <div className="rounded-md border border-border bg-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
            <th className="text-left py-2.5 px-4 font-medium">#</th>
            <th className="text-left py-2.5 px-2 font-medium">Player</th>
            <th className="text-right py-2.5 px-2 font-medium">Wins</th>
            <th className="text-right py-2.5 px-2 font-medium">Podiums</th>
            <th className="text-right py-2.5 px-2 font-medium">Played</th>
            <th className="text-right py-2.5 px-4 font-medium">Record</th>
          </tr>
        </thead>
        <tbody>
          {career.map((c, i) => (
            <tr key={c.userId} className="border-b border-border/60 last:border-0" style={c.isMe ? { background: "oklch(0.16 0.04 74 / 0.25)" } : {}}>
              <td className="py-2.5 px-4 font-mono text-muted-foreground">{i + 1}</td>
              <td className="py-2.5 px-2 text-foreground truncate">{c.handle}{c.isMe && <span className="text-[10px] text-muted-foreground"> (you)</span>}</td>
              <td className="py-2.5 px-2 text-right font-mono" style={{ color: c.wins > 0 ? "var(--primary)" : "var(--muted-foreground)" }}>{c.wins}</td>
              <td className="py-2.5 px-2 text-right font-mono text-foreground">{c.podiums}</td>
              <td className="py-2.5 px-2 text-right font-mono text-muted-foreground">{c.played}</td>
              <td className="py-2.5 px-4 text-right font-mono text-muted-foreground">{c.wins}–{c.played - c.wins}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Detail view ─── */
/** Has this entry actually done anything yet? Idle entries are excluded from the
 *  risk boards so "never traded" (0% / 0 drawdown / null Sharpe) can't win them. */
function isActive(r: LeaderRow): boolean {
  return r.sharpe != null || r.maxDrawdown > 0 || Math.abs(r.returnPct) > 1e-9;
}

function rankRows(rows: LeaderRow[], board: Board): LeaderRow[] {
  const copy = [...rows];
  if (board === "return") {
    copy.sort((a, b) => b.returnPct - a.returnPct);
  } else if (board === "sharpe") {
    // Highest Sharpe first; unscored (null) entries sink to the bottom. Explicit
    // null handling avoids a NaN comparator (which makes sort order undefined).
    copy.sort((a, b) => {
      if (a.sharpe == null && b.sharpe == null) return 0;
      if (a.sharpe == null) return 1;
      if (b.sharpe == null) return -1;
      return b.sharpe - a.sharpe;
    });
  } else {
    // Lowest drawdown first — but only among entries that have traded; idle
    // entries (drawdown 0 by default) sort last so they don't top the board.
    copy.sort((a, b) => {
      const aa = isActive(a), ba = isActive(b);
      if (aa !== ba) return aa ? -1 : 1;
      if (!aa) return 0;
      return a.maxDrawdown - b.maxDrawdown;
    });
  }
  return copy;
}

function CompetitionDetail({
  comp, loading, rows, feed, board, setBoard, myAccountId, profile, busy, onBack, onJoin, onLeave, onDelete, onSetHandle,
}: {
  comp: Competition | null;
  loading: boolean;
  rows: LeaderRow[];
  feed: FeedRow[];
  board: Board;
  setBoard: (b: Board) => void;
  myAccountId: string | null;
  profile: Profile | null;
  busy: boolean;
  onBack: () => void;
  onJoin: (c: Competition) => void;
  onLeave: (c: Competition) => void;
  onDelete: (c: Competition) => void;
  onSetHandle: () => void;
}) {
  const ranked = rankRows(rows, board);
  const myRank = ranked.findIndex((r) => r.isMe);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[1100px] flex flex-col gap-5">
        <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground transition-colors self-start">← Competitions</button>

        {!comp ? (
          loading ? <div className="skeleton rounded-md" style={{ height: 120 }} /> : <Empty>Competition not found.</Empty>
        ) : (
          <>
            {/* header */}
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-semibold text-foreground truncate">{comp.name}</h1>
                  <StatusPill status={comp.status} />
                </div>
                {comp.description && <p className="text-sm text-muted-foreground mt-1">{comp.description}</p>}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
                  <span>{comp.scope === "global" ? "Global" : "Private"}</span>
                  <span>·</span>
                  <span>{comp.entrants} {comp.entrants === 1 ? "player" : "players"}</span>
                  <span>·</span>
                  <span>{formatCurrency(comp.startingCash)} start</span>
                  <span>·</span>
                  <span>{fmtDate(comp.startsAt)} – {fmtDate(comp.endsAt)}</span>
                  {comp.allowedAssetClasses.length > 0 && <><span>·</span><span>Only: {comp.allowedAssetClasses.join(", ")}</span></>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {comp.joined && myAccountId ? (
                  <Link href={`/paper?account=${encodeURIComponent(myAccountId)}`} className="text-xs px-3 py-1.5 rounded-sm font-medium" style={{ background: "var(--primary)", color: "oklch(0.08 0 0)" }}>
                    {comp.status === "ended" ? "Review" : "Trade"}
                  </Link>
                ) : comp.status !== "ended" ? (
                  <button onClick={() => onJoin(comp)} disabled={busy} className="text-xs px-3 py-1.5 rounded-sm font-medium disabled:opacity-50" style={{ background: "var(--primary)", color: "oklch(0.08 0 0)" }}>Join</button>
                ) : null}
                {comp.joined && comp.status === "upcoming" && (
                  <button onClick={() => onLeave(comp)} disabled={busy} className="text-xs px-2.5 py-1.5 rounded-sm border border-border text-muted-foreground hover:text-foreground transition-colors">Leave</button>
                )}
                {comp.isCreator && (
                  <button onClick={() => onDelete(comp)} disabled={busy} className="text-xs px-2.5 py-1.5 rounded-sm border border-border text-muted-foreground hover:text-foreground transition-colors">Delete</button>
                )}
              </div>
            </div>

            {/* invite code (creator/joined of a private comp) */}
            {comp.inviteCode && comp.scope === "private" && (
              <div className="rounded-md border border-border bg-card px-4 py-2.5 flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Invite code</span>
                <code className="font-mono text-foreground tracking-wider">{comp.inviteCode}</code>
                <button onClick={() => navigator.clipboard?.writeText(comp.inviteCode!)} className="text-muted-foreground hover:text-foreground transition-colors ml-1">Copy</button>
              </div>
            )}

            {/* handle nudge */}
            {comp.joined && !profile?.handle && (
              <div className="rounded-md border border-border bg-card px-4 py-2.5 flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">You&apos;ll show as <span className="text-foreground">Anonymous</span> on the leaderboard until you set a handle.</span>
                <button onClick={onSetHandle} className="text-foreground hover:underline shrink-0">Set handle</button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* leaderboard */}
              <div className="lg:col-span-2 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex rounded-sm overflow-hidden border border-border text-xs font-medium">
                    {BOARDS.map((b) => {
                      const on = board === b.key;
                      return (
                        <button key={b.key} onClick={() => setBoard(b.key)} className="px-3 py-1 transition-colors" style={{ background: on ? "var(--primary)" : "transparent", color: on ? "oklch(0.08 0 0)" : "var(--muted-foreground)" }}>
                          {b.label}
                        </button>
                      );
                    })}
                  </div>
                  {myRank >= 0 && <span className="text-xs text-muted-foreground">Your rank: <span className="text-foreground font-medium">#{myRank + 1}</span></span>}
                </div>
                <Leaderboard ranked={ranked} board={board} loading={loading} />
              </div>

              {/* live feed */}
              <div className="lg:col-span-1 flex flex-col gap-3">
                <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Live trades</h2>
                <TradeFeed feed={feed} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Leaderboard({ ranked, board, loading }: { ranked: LeaderRow[]; board: Board; loading: boolean }) {
  if (loading && ranked.length === 0) return <div className="skeleton rounded-md" style={{ height: 240 }} />;
  if (ranked.length === 0) return <Empty>No players yet.</Empty>;
  return (
    <div className="rounded-md border border-border bg-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
            <th className="text-left py-2.5 px-4 font-medium">#</th>
            <th className="text-left py-2.5 px-2 font-medium">Player</th>
            <th className="text-right py-2.5 px-2 font-medium" style={board === "return" ? { color: "var(--primary)" } : {}}>Return</th>
            <th className="text-right py-2.5 px-2 font-medium" style={board === "sharpe" ? { color: "var(--primary)" } : {}}>Sharpe</th>
            <th className="text-right py-2.5 px-2 font-medium" style={board === "drawdown" ? { color: "var(--primary)" } : {}}>Max DD</th>
            <th className="text-right py-2.5 px-4 font-medium">Equity</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((r, i) => (
            <tr key={r.userId} className="border-b border-border/60 last:border-0" style={r.isMe ? { background: "oklch(0.16 0.04 74 / 0.25)" } : {}}>
              <td className="py-2.5 px-4 font-mono text-muted-foreground">{i + 1}</td>
              <td className="py-2.5 px-2 text-foreground truncate">
                {r.handle}{r.isMe && <span className="text-[10px] text-muted-foreground"> (you)</span>}
              </td>
              <td className="py-2.5 px-2 text-right font-mono" style={{ color: r.returnPct >= 0 ? "var(--positive)" : "var(--negative)" }}>{formatPercent(r.returnPct)}</td>
              <td className="py-2.5 px-2 text-right font-mono text-foreground">{r.sharpe != null ? r.sharpe.toFixed(2) : "—"}</td>
              <td className="py-2.5 px-2 text-right font-mono text-muted-foreground">{r.maxDrawdown > 0 ? `${r.maxDrawdown.toFixed(1)}%` : "—"}</td>
              <td className="py-2.5 px-4 text-right font-mono text-foreground">{formatCurrency(r.equity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradeFeed({ feed }: { feed: FeedRow[] }) {
  if (feed.length === 0) return <Empty>No trades yet — be the first to move.</Empty>;
  return (
    <div className="rounded-md border border-border bg-card divide-y divide-border/60 max-h-[520px] overflow-y-auto">
      {feed.map((f) => (
        <div key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
          <span className="font-mono text-[10px] w-9 shrink-0" style={{ color: f.side === "BUY" ? "var(--positive)" : "var(--negative)" }}>{f.side}</span>
          <span className="text-foreground truncate flex-1 min-w-0">
            <span className="text-muted-foreground">{f.handle}</span> {f.qty}× <span className="font-mono">{f.symbol}</span>
          </span>
          <span className="font-mono text-xs text-muted-foreground shrink-0">{f.price != null ? formatCurrency(f.price) : "—"}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Modals ─── */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "oklch(0.04 0 0 / 0.62)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-[min(94vw,520px)] max-h-[92vh] overflow-y-auto rounded-md border border-border bg-popover p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-sm border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-ring";
const labelCls = "text-xs uppercase tracking-wide text-muted-foreground";

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CreateModal({ busy, onClose, onCreate }: { busy: boolean; onClose: () => void; onCreate: (p: Record<string, unknown>) => void }) {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86_400_000);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<Scope>("private");
  const [startingCash, setStartingCash] = useState(100_000);
  const [startsAt, setStartsAt] = useState(toLocalInput(now));
  const [endsAt, setEndsAt] = useState(toLocalInput(in30));
  const [classes, setClasses] = useState<Set<AssetClass>>(new Set(ASSET_CLASSES));

  const toggle = (c: AssetClass) => setClasses((prev) => {
    const next = new Set(prev);
    if (next.has(c)) next.delete(c); else next.add(c);
    if (next.size === 0) next.add(c); // never allow zero
    return next;
  });

  const submit = () => {
    if (!name.trim()) { alert("Name is required."); return; }
    onCreate({
      name: name.trim(),
      description: description.trim() || null,
      scope,
      startingCash,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      allowedAssetClasses: [...classes],
    });
  };

  return (
    <Modal title="Create competition" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="June Showdown" autoFocus /></Field>
        <Field label="Description"><input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={280} placeholder="Optional" /></Field>
        <Field label="Scope">
          <div className="flex rounded-sm overflow-hidden border border-border text-xs font-medium w-fit">
            {(["private", "global"] as Scope[]).map((sc) => (
              <button key={sc} onClick={() => setScope(sc)} className="px-3.5 py-1 transition-colors" style={{ background: scope === sc ? "var(--primary)" : "transparent", color: scope === sc ? "oklch(0.08 0 0)" : "var(--muted-foreground)" }}>
                {sc === "private" ? "Private (invite)" : "Global"}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Starting cash">
          <input type="number" className={inputCls + " font-mono"} value={startingCash} min={1000} step={1000} onChange={(e) => setStartingCash(Number(e.target.value))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts"><input type="datetime-local" className={inputCls + " font-mono"} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></Field>
          <Field label="Ends"><input type="datetime-local" className={inputCls + " font-mono"} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></Field>
        </div>
        <Field label="Allowed instruments">
          <div className="flex flex-wrap gap-1.5">
            {ASSET_CLASSES.map((c) => {
              const on = classes.has(c);
              return (
                <button key={c} onClick={() => toggle(c)} className="text-xs px-2.5 py-1 rounded-sm border transition-colors" style={{ borderColor: on ? "var(--primary)" : "var(--border)", color: on ? "var(--primary)" : "var(--muted-foreground)", background: on ? "oklch(0.16 0.04 74)" : "transparent" }}>
                  {c}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-sm border border-border text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          <button onClick={submit} disabled={busy} className="text-xs px-3 py-1.5 rounded-sm font-medium disabled:opacity-50" style={{ background: "var(--primary)", color: "oklch(0.08 0 0)" }}>Create</button>
        </div>
      </div>
    </Modal>
  );
}

function JoinCodeModal({ busy, onClose, onLookup, onJoin }: {
  busy: boolean;
  onClose: () => void;
  onLookup: (code: string) => Promise<Competition | null>;
  onJoin: (comp: Competition, code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [found, setFound] = useState<Competition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  const lookup = async () => {
    if (!code.trim()) return;
    setLooking(true); setError(null); setFound(null);
    try {
      const c = await onLookup(code.trim().toUpperCase());
      if (!c) setError("No competition with that code.");
      else setFound(c);
    } finally { setLooking(false); }
  };

  return (
    <Modal title="Join by invite code" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input className={inputCls + " font-mono tracking-wider"} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="A1B2C3D4" maxLength={8} autoFocus />
          <button onClick={lookup} disabled={looking} className="text-xs px-3 py-1.5 rounded-sm border border-border text-muted-foreground hover:text-foreground transition-colors shrink-0">Find</button>
        </div>
        {error && <p className="text-xs" style={{ color: "var(--negative)" }}>{error}</p>}
        {found && (
          <div className="rounded-md border border-border bg-card p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground truncate">{found.name}</span>
              <StatusPill status={found.status} />
            </div>
            <div className="text-xs text-muted-foreground">{found.entrants} players · {formatCurrency(found.startingCash)} · {fmtDate(found.startsAt)} – {fmtDate(found.endsAt)}</div>
            <button onClick={() => onJoin(found, code.trim().toUpperCase())} disabled={busy || found.status === "ended"} className="text-xs px-3 py-1.5 rounded-sm font-medium self-start disabled:opacity-50" style={{ background: "var(--primary)", color: "oklch(0.08 0 0)" }}>
              {found.joined ? "Open" : found.status === "ended" ? "Ended" : "Join"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function HandleModal({ current, busy, onClose, onSave }: { current: string; busy: boolean; onClose: () => void; onSave: (h: string) => void }) {
  const [handle, setHandle] = useState(current);
  return (
    <Modal title="Your handle" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">This is the name other players see on leaderboards and the trade feed. 3–20 letters, numbers, or underscores.</p>
        <input className={inputCls + " font-mono"} value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={20} placeholder="trader_jane" autoFocus />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-sm border border-border text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          <button onClick={() => onSave(handle.trim())} disabled={busy || !handle.trim()} className="text-xs px-3 py-1.5 rounded-sm font-medium disabled:opacity-50" style={{ background: "var(--primary)", color: "oklch(0.08 0 0)" }}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={labelCls}>{label}</span>
      {children}
    </div>
  );
}
