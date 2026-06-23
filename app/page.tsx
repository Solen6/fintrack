import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const holdings = [
    { t: "ANET", p: "312.55", d: "+2.14", pos: true },
    { t: "NVDA", p: "892.44", d: "-0.37", pos: false },
    { t: "LRCX", p: "788.90", d: "+1.54", pos: true },
    { t: "MSFT", p: "374.12", d: "+0.82", pos: true },
  ];

  const chain = [
    { iv1: "28.4", call: "6.80", k: "390", put: "5.10", iv2: "31.2", atm: false },
    { iv1: "26.1", call: "4.20", k: "400", put: "3.45", iv2: "29.7", atm: true },
    { iv1: "24.8", call: "2.45", k: "410", put: "1.82", iv2: "27.9", atm: false },
  ];

  const positions = [
    { sym: "AAPL", qty: "10", last: "$201.45", pnl: "+$122.50", pos: true },
    { sym: "NVDA", qty: "5",  last: "$892.44", pnl: "+$262.20", pos: true },
    { sym: "INTC", qty: "20", last: "$31.80",  pnl: "-$66.00",  pos: false },
  ];

  const board = [
    { rank: "1", handle: "qvr_trade",    ret: "+18.4%", sh: "2.41", me: false },
    { rank: "2", handle: "midnightmkts", ret: "+14.2%", sh: "1.87", me: false },
    { rank: "3", handle: "you",          ret: "+9.7%",  sh: "1.34", me: true  },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      {/* Top accent line */}
      <div className="h-px w-full bg-primary" />

      {/* Nav */}
      <nav
        className="sticky top-0 z-50 flex items-center justify-between px-6 py-3.5 border-b border-border"
        style={{ background: "oklch(0.08 0 0 / 0.92)", backdropFilter: "blur(8px)" }}
      >
        <span className="font-mono font-semibold tracking-[0.18em] text-primary text-sm">
          FINTRACK
        </span>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 mr-4">
            <span
              className="w-1.5 h-1.5 rounded-full bg-positive"
              style={{ animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }}
            />
            <span className="text-xs font-mono text-muted-foreground">Live · 4:02 PM ET</span>
          </div>
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
          >
            Log in
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium bg-primary text-primary-foreground px-4 py-1.5 rounded-sm hover:opacity-90 transition-opacity"
          >
            Create account
          </Link>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <section className="relative flex flex-col items-center justify-center min-h-[calc(100vh-45px)] text-center px-4 overflow-hidden">
        {/* Grid texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(oklch(0.72 0.14 74) 1px, transparent 1px), linear-gradient(90deg, oklch(0.72 0.14 74) 1px, transparent 1px)",
            backgroundSize: "72px 72px",
          }}
        />
        {/* Radial amber glow */}
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full opacity-[0.07]"
          style={{ background: "radial-gradient(ellipse, oklch(0.72 0.14 74), transparent 70%)" }}
        />

        <div className="relative z-10 max-w-3xl mx-auto">
          <div
            className="inline-flex items-center gap-2 border border-border px-3 py-1 rounded-full mb-10"
            style={{ background: "oklch(0.12 0 0)" }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full bg-primary"
              style={{ animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }}
            />
            <span className="text-xs font-mono text-muted-foreground tracking-[0.16em] uppercase">
              Precision instrument for self-directed investors
            </span>
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-[72px] font-semibold tracking-tight leading-[1.04] text-foreground mb-6">
            The Midnight
            <br />
            <span className="text-primary">Trading Desk.</span>
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
            One dashboard for every account. Live prices, consolidated holdings, a
            forward-looking calendar, and a paper-trading sandbox — without the noise.
          </p>

          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/login"
              className="bg-primary text-primary-foreground px-7 py-2.5 rounded-sm font-medium hover:opacity-90 transition-opacity text-sm"
            >
              Log In
            </Link>
            <Link
              href="/login"
              className="border border-border text-foreground px-7 py-2.5 rounded-sm font-medium hover:border-primary/50 hover:text-primary transition-colors text-sm"
            >
              Create Account
            </Link>
          </div>

          {/* Mini stat strip */}
          <div className="flex items-center justify-center gap-6 mt-14 flex-wrap">
            {[
              { label: "Asset classes", val: "4" },
              { label: "Data sources", val: "Live" },
              { label: "Starting paper cash", val: "$100k" },
              { label: "Gamification", val: "None" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="font-mono text-primary text-lg font-semibold">{s.val}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 flex flex-col items-center gap-1.5 text-muted-foreground">
          <span className="text-xs font-mono tracking-widest uppercase">Scroll</span>
          <div className="w-px h-8 bg-gradient-to-b from-border to-transparent" />
        </div>
      </section>

      {/* ─── Features ─── */}
      <section className="px-4 py-24 max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-2xl sm:text-3xl font-semibold text-foreground mb-3">
            Everything you need. Nothing you don&apos;t.
          </h2>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto">
            Precision tools for investors who already know what they&apos;re doing.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* — 1. Portfolio — */}
          <FeatureCard
            tag="Portfolio"
            title="Consolidated holdings"
            description="All brokerage, retirement, and cash accounts in one view. Live prices via Finnhub. Upload a Fidelity CSV and you're live in seconds."
          >
            <div className="bg-background border border-border rounded-sm overflow-hidden">
              <Row header>
                <Cell mono muted className="flex-1 px-3 py-2">TICKER</Cell>
                <Cell mono muted className="px-3 py-2 w-24 text-right">PRICE</Cell>
                <Cell mono muted className="px-3 py-2 w-16 text-right">TODAY</Cell>
              </Row>
              {holdings.map((r) => (
                <Row key={r.t}>
                  <Cell mono className="flex-1 px-3 py-2">{r.t}</Cell>
                  <Cell mono className="px-3 py-2 w-24 text-right">${r.p}</Cell>
                  <Cell mono className={`px-3 py-2 w-16 text-right ${r.pos ? "text-positive" : "text-negative"}`}>
                    {r.d}%
                  </Cell>
                </Row>
              ))}
              <div className="flex items-center justify-between px-3 py-2 border-t border-border">
                <span className="text-xs font-mono text-muted-foreground">Portfolio value</span>
                <span className="text-sm font-mono text-foreground">$98,412.40</span>
              </div>
            </div>
          </FeatureCard>

          {/* — 2. Market & Calendar — */}
          <FeatureCard
            tag="Market"
            title="Movers & macro calendar"
            description="Top gainers, losers, earnings, dividends, and Fed events — all forward-looking. Powered by Finnhub and TradingView."
          >
            <div className="bg-background border border-border rounded-sm p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Gainers", items: [["META", "+4.2%"], ["TSLA", "+2.8%"], ["ANET", "+2.1%"]] as [string,string][], pos: true },
                  { label: "Losers",  items: [["INTC", "-3.1%"], ["MU",   "-2.4%"], ["AMD",  "-1.8%"]] as [string,string][], pos: false },
                ].map((col) => (
                  <div key={col.label}>
                    <div className="text-xs font-mono text-muted-foreground tracking-widest uppercase mb-1.5">
                      {col.label}
                    </div>
                    {col.items.map(([t, d]) => (
                      <div key={t} className="flex justify-between text-xs font-mono py-0.5">
                        <span className="text-foreground">{t}</span>
                        <span className={col.pos ? "text-positive" : "text-negative"}>{d}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="border-t border-border pt-2.5 space-y-1.5">
                <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">
                  Upcoming events
                </div>
                {[
                  { date: "Jun 26", label: "NVDA earnings · after close", color: "text-primary" },
                  { date: "Jun 28", label: "PCE · 8:30 AM ET",            color: "text-steel" },
                  { date: "Jul 2",  label: "LRCX ex-div · $0.97",         color: "text-positive" },
                ].map((e) => (
                  <div key={e.date} className="flex gap-2 items-baseline text-xs font-mono">
                    <span className={`${e.color} w-12 shrink-0`}>{e.date}</span>
                    <span className="text-muted-foreground">{e.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </FeatureCard>

          {/* — 3. Options & Futures — */}
          <FeatureCard
            tag="Derivatives"
            title="Options & futures views"
            description="Full chain explorer with dual-sided call/put view. Strategy builder, P&L heatmap, IV analysis, and Greeks. Black-Scholes PoP estimates."
          >
            <div className="bg-background border border-border rounded-sm overflow-hidden">
              {/* Chain header */}
              <div className="flex items-center text-xs font-mono text-muted-foreground border-b border-border">
                <div className="w-12 px-2 py-1.5 text-right">IV</div>
                <div className="flex-1 px-2 py-1.5 text-right text-positive">CALL</div>
                <div className="w-16 px-2 py-1.5 text-center text-foreground">STRIKE</div>
                <div className="flex-1 px-2 py-1.5 text-negative">PUT</div>
                <div className="w-12 px-2 py-1.5">IV</div>
              </div>
              {chain.map((r) => (
                <div
                  key={r.k}
                  className={`flex items-center text-xs font-mono border-b border-border last:border-0 ${
                    r.atm ? "bg-primary/[0.06]" : ""
                  }`}
                >
                  <div className="w-12 px-2 py-1.5 text-right text-muted-foreground">{r.iv1}%</div>
                  <div className="flex-1 px-2 py-1.5 text-right text-positive">{r.call}</div>
                  <div
                    className={`w-16 px-2 py-1.5 text-center font-semibold ${
                      r.atm ? "text-primary" : "text-foreground"
                    }`}
                  >
                    {r.k}
                    {r.atm && <span className="ml-0.5 text-primary/60">◆</span>}
                  </div>
                  <div className="flex-1 px-2 py-1.5 text-negative">{r.put}</div>
                  <div className="w-12 px-2 py-1.5 text-muted-foreground">{r.iv2}%</div>
                </div>
              ))}
              {/* Greeks strip */}
              <div className="flex items-center gap-4 px-3 py-2 border-t border-border text-xs font-mono text-muted-foreground">
                <span>Δ <span className="text-foreground">0.47</span></span>
                <span>Γ <span className="text-foreground">0.021</span></span>
                <span>Θ <span className="text-negative">-0.08</span></span>
                <span>IV <span className="text-foreground">26.1%</span></span>
                <span className="ml-auto">PoP <span className="text-positive">52%</span></span>
              </div>
            </div>
          </FeatureCard>

          {/* — 4. Paper Trading — */}
          <FeatureCard
            tag="Paper Trading"
            title="Sandbox with real prices"
            description="Practice strategies risk-free across stocks, options, futures, and forex — all filled at live market prices. Realistic margin, order types, and an equity curve."
          >
            <div className="bg-background border border-border rounded-sm overflow-hidden">
              {/* Account metrics */}
              <div className="grid grid-cols-3 border-b border-border">
                {[
                  { label: "Equity",       val: "$101,247", hi: true  },
                  { label: "Buying Power", val: "$64,320",  hi: false },
                  { label: "Today P&L",    val: "+$1,247",  hi: true  },
                ].map((m) => (
                  <div key={m.label} className="px-3 py-2.5 border-r border-border last:border-0">
                    <div className="text-xs text-muted-foreground mb-0.5">{m.label}</div>
                    <div className={`font-mono text-xs font-semibold ${m.hi ? "text-positive" : "text-foreground"}`}>
                      {m.val}
                    </div>
                  </div>
                ))}
              </div>
              {/* Positions */}
              <div className="px-3 pt-2.5 pb-1">
                <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1.5">
                  Open positions
                </div>
                {positions.map((p) => (
                  <div
                    key={p.sym}
                    className="flex items-center text-xs font-mono py-1 border-b border-border/50 last:border-0"
                  >
                    <span className="text-foreground w-10">{p.sym}</span>
                    <span className="text-muted-foreground w-6 text-right">{p.qty}</span>
                    <span className="text-muted-foreground flex-1 text-right">{p.last}</span>
                    <span className={`w-20 text-right ${p.pos ? "text-positive" : "text-negative"}`}>{p.pnl}</span>
                  </div>
                ))}
              </div>
            </div>
          </FeatureCard>
        </div>
      </section>

      {/* ─── Competitions ─── */}
      <section className="border-y border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 py-14 flex flex-col md:flex-row items-start md:items-center gap-10">
          <div className="flex-1">
            <span className="inline-block border border-border text-xs font-mono text-primary px-2 py-0.5 rounded-full mb-3 tracking-widest uppercase">
              New
            </span>
            <h3 className="text-xl font-semibold text-foreground mb-2">
              Compete. Compare. Calibrate.
            </h3>
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
              Enter private or global paper-trading competitions. Leaderboards ranked by
              total return, Sharpe ratio, and max drawdown.
            </p>
          </div>
          {/* Mock leaderboard */}
          <div
            className="w-full max-w-sm border border-border rounded-sm overflow-hidden font-mono"
            style={{ background: "oklch(0.10 0 0)" }}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-border text-xs text-muted-foreground">
              <span className="w-4">#</span>
              <span className="flex-1 pl-3">Handle</span>
              <span className="w-16 text-right">Return</span>
              <span className="w-12 text-right">Sharpe</span>
            </div>
            {board.map((r) => (
              <div
                key={r.rank}
                className={`flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0 text-xs ${
                  r.me ? "bg-primary/[0.07]" : ""
                }`}
              >
                <span className={`w-4 ${r.me ? "text-primary" : "text-muted-foreground"}`}>{r.rank}</span>
                <span className={`flex-1 pl-3 ${r.me ? "text-primary" : "text-foreground"}`}>
                  {r.handle}
                  {r.me && <span className="ml-2 text-primary/60 text-[10px]">← you</span>}
                </span>
                <span className="w-16 text-right text-positive">{r.ret}</span>
                <span className={`w-12 text-right ${r.me ? "text-primary" : "text-muted-foreground"}`}>{r.sh}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Closing CTA ─── */}
      <section className="flex flex-col items-center justify-center py-32 px-4 text-center">
        <p className="text-xs font-mono text-muted-foreground tracking-[0.2em] uppercase mb-6">
          Precision · Clarity · Control
        </p>
        <h2 className="text-3xl sm:text-4xl font-semibold text-foreground mb-4 max-w-lg leading-tight">
          Your portfolio deserves a
          <br />
          <span className="text-primary">serious instrument.</span>
        </h2>
        <p className="text-muted-foreground text-sm mb-10 max-w-sm leading-relaxed">
          No gamification. No dopamine bait. No confetti. Just clean data and sharp
          tools for people who take their money seriously.
        </p>
        <div className="flex items-center gap-3 flex-wrap justify-center">
          <Link
            href="/login"
            className="bg-primary text-primary-foreground px-8 py-3 rounded-sm font-medium hover:opacity-90 transition-opacity text-sm"
          >
            Get started — it&apos;s free
          </Link>
          <Link
            href="/login"
            className="border border-border text-muted-foreground px-8 py-3 rounded-sm font-medium hover:text-foreground hover:border-primary/50 transition-colors text-sm"
          >
            Log in
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-5 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="font-mono text-primary font-semibold tracking-[0.18em] text-xs">FINTRACK</span>
          <span className="font-mono text-muted-foreground text-xs">fintrack · v0.1.0</span>
        </div>
      </footer>
    </div>
  );
}

/* ─── Primitive helpers ─── */

function FeatureCard({
  tag,
  title,
  description,
  children,
}: {
  tag: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-sm p-5 flex flex-col gap-4">
      <div>
        <span className="text-xs font-mono text-muted-foreground tracking-widest uppercase">
          {tag}
        </span>
        <h3 className="text-base font-semibold text-foreground mt-1">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Row({
  header,
  children,
}: {
  header?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center border-b border-border last:border-0 ${
        header ? "text-muted-foreground" : "text-foreground"
      }`}
    >
      {children}
    </div>
  );
}

function Cell({
  mono,
  muted,
  className,
  children,
}: {
  mono?: boolean;
  muted?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`text-xs ${mono ? "font-mono" : ""} ${muted ? "text-muted-foreground" : ""} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
