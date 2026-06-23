"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import "./landing.css";

export default function LandingClient() {
  const spbRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const spb = spbRef.current;
    const nav = navRef.current;
    const glow = glowRef.current;

    const onScroll = () => {
      if (spb) {
        const total = document.documentElement.scrollHeight - window.innerHeight;
        spb.style.width = (total > 0 ? (window.scrollY / total) * 100 : 0) + "%";
      }
      if (nav) nav.classList.toggle("scrolled", window.scrollY > 20);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const glowMap: Record<string, { x: string; y: string }> = {
      "s-hero": { x: "50%", y: "40%" },
      "s-portfolio": { x: "78%", y: "50%" },
      "s-market": { x: "22%", y: "50%" },
      "s-options": { x: "78%", y: "50%" },
      "s-paper": { x: "22%", y: "50%" },
      "s-comps": { x: "50%", y: "50%" },
      "s-cta": { x: "50%", y: "50%" },
    };
    const sectionObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && glow) {
            const pos = glowMap[e.target.id];
            if (pos) {
              glow.style.left = pos.x;
              glow.style.top = pos.y;
            }
          }
        });
      },
      { threshold: 0.25 }
    );
    Object.keys(glowMap).forEach((id) => {
      const el = document.getElementById(id);
      if (el) sectionObs.observe(el);
    });

    const animObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("vis");
            animObs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    document.querySelectorAll(".lp-a, .lp-al, .lp-ar").forEach((el) => animObs.observe(el));

    return () => {
      window.removeEventListener("scroll", onScroll);
      sectionObs.disconnect();
      animObs.disconnect();
    };
  }, []);

  return (
    <div className="lp">
      <div className="lp-spb" ref={spbRef} />
      <div className="lp-glow" ref={glowRef} />

      {/* ═══ NAV ═══ */}
      <nav className="lp-nav" ref={navRef}>
        <span className="lp-nav-logo mono">FINTRACK</span>
        <div className="lp-nav-right">
          <div className="lp-live-pill">
            <span className="lp-live-dot" />
            <span className="mono lp-muted" style={{ fontSize: 11 }}>
              Live · 4:02 PM ET
            </span>
          </div>
          <Link href="/login" className="lp-btn-ghost">
            Log in
          </Link>
          <Link href="/login" className="lp-btn-amber">
            Create account
          </Link>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="lp-hero" id="s-hero">
        <div className="lp-hero-grid" />
        <div className="lp-hero-inner">
          <div className="lp-hero-badge">
            <span className="lp-hero-badge-dot" />
            <span className="lp-hero-badge-txt mono">
              Precision instrument for self-directed investors
            </span>
          </div>

          <h1 className="lp-hero-h1">
            The Midnight
            <br />
            <span className="amber">Trading Desk.</span>
          </h1>

          <p className="lp-hero-sub">
            One dashboard for every account. Live prices, consolidated holdings, a
            forward-looking calendar, and a paper-trading sandbox — without the noise.
          </p>

          <div className="lp-hero-ctas">
            <Link href="/login" className="lp-btn-hero-primary">
              Create account
            </Link>
            <Link href="/login" className="lp-btn-hero-outline">
              Log in
            </Link>
          </div>

          <div className="lp-stats-strip">
            <div style={{ textAlign: "center" }}>
              <div className="lp-stat-val mono">4</div>
              <div className="lp-stat-label">Asset classes</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div className="lp-stat-val mono" style={{ fontSize: 17, paddingTop: 2 }}>
                Live
              </div>
              <div className="lp-stat-label">Market data</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div className="lp-stat-val mono">$100k</div>
              <div className="lp-stat-label">Starting paper cash</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div className="lp-stat-val mono">None</div>
              <div className="lp-stat-label">Gamification</div>
            </div>
          </div>
        </div>

        <div className="lp-scroll-hint">
          <span className="lp-scroll-hint-txt mono">Scroll</span>
          <div className="lp-scroll-hint-line" />
        </div>
      </section>

      {/* ═══ FEATURE 1: PORTFOLIO ═══ */}
      <section className="lp-feature" id="s-portfolio">
        <div className="lp-feature-inner">
          <div>
            <span className="lp-f-tag mono lp-a lp-d1">Portfolio</span>
            <h2 className="lp-f-h2 lp-a lp-d2">
              Consolidated holdings,
              <br />
              <span className="amber">all in one place.</span>
            </h2>
            <p className="lp-f-desc lp-a lp-d3">
              All brokerage, retirement, and cash accounts in one view. Live prices via
              Finnhub. Upload a Fidelity CSV and you&apos;re live in seconds.
            </p>
            <div className="lp-f-bullets">
              <div className="lp-f-bullet lp-a lp-d3">
                <span className="lp-f-dot" />
                Multi-account grouping by type (brokerage, retirement, cash)
              </div>
              <div className="lp-f-bullet lp-a lp-d4">
                <span className="lp-f-dot" />
                Real-time prices, sectors, and daily change via Finnhub
              </div>
              <div className="lp-f-bullet lp-a lp-d5">
                <span className="lp-f-dot" />
                Holdings heatmap by daily change or total return
              </div>
              <div className="lp-f-bullet lp-a lp-d6">
                <span className="lp-f-dot" />
                Dividend history, corporate actions, DRIP support
              </div>
            </div>
          </div>

          <div className="lp-ar">
            <div className="lp-mock">
              <div className="lp-mock-hd">
                <span className="lp-mock-hd-title mono">Holdings · All Accounts</span>
                <div className="lp-mock-live">
                  <span className="lp-mock-live-dot" />
                  <span className="mono" style={{ fontSize: 10 }}>
                    Live
                  </span>
                </div>
              </div>
              <div className="lp-tr hd mono">
                <span className="lp-tc" style={{ width: 70 }}>
                  TICKER
                </span>
                <span className="lp-tc" style={{ width: 50, textAlign: "right" }}>
                  SHS
                </span>
                <span className="lp-tc" style={{ flex: 1, textAlign: "right" }}>
                  PRICE
                </span>
                <span className="lp-tc" style={{ width: 68, textAlign: "right" }}>
                  TODAY
                </span>
                <span className="lp-tc" style={{ width: 82, textAlign: "right" }}>
                  VALUE
                </span>
              </div>
              {[
                { t: "ANET", s: "24", p: "$312.55", d: "+2.14%", v: "$7,501", pos: true },
                { t: "NVDA", s: "10", p: "$892.44", d: "−0.37%", v: "$8,924", pos: false },
                { t: "LRCX", s: "12", p: "$788.90", d: "+1.54%", v: "$9,467", pos: true },
                { t: "MSFT", s: "20", p: "$374.12", d: "+0.82%", v: "$7,482", pos: true },
                { t: "KLAC", s: "8", p: "$741.20", d: "−1.20%", v: "$5,930", pos: false },
              ].map((r) => (
                <div className="lp-tr mono" key={r.t}>
                  <span className="lp-tc lp-fg" style={{ width: 70 }}>
                    {r.t}
                  </span>
                  <span className="lp-tc lp-muted" style={{ width: 50, textAlign: "right" }}>
                    {r.s}
                  </span>
                  <span className="lp-tc lp-fg" style={{ flex: 1, textAlign: "right" }}>
                    {r.p}
                  </span>
                  <span
                    className={`lp-tc ${r.pos ? "lp-pos" : "lp-neg"}`}
                    style={{ width: 68, textAlign: "right" }}
                  >
                    {r.d}
                  </span>
                  <span className="lp-tc lp-fg" style={{ width: 82, textAlign: "right" }}>
                    {r.v}
                  </span>
                </div>
              ))}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "9px 14px",
                  borderTop: "1px solid var(--lp-border)",
                  background: "var(--lp-card2)",
                }}
              >
                <span className="mono lp-muted" style={{ fontSize: 11 }}>
                  Portfolio value
                </span>
                <div>
                  <span className="lp-fg mono" style={{ fontSize: 13, fontWeight: 600 }}>
                    $98,412.40
                  </span>
                  <span className="lp-pos mono" style={{ fontSize: 11, marginLeft: 8 }}>
                    +$1,204 today
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FEATURE 2: MARKET & CALENDAR ═══ */}
      <section className="lp-feature lp-alt" id="s-market">
        <div className="lp-feature-inner flip">
          <div>
            <span className="lp-f-tag mono lp-a lp-d1">Market · Calendar</span>
            <h2 className="lp-f-h2 lp-a lp-d2">
              Every event,
              <br />
              <span className="amber">before it moves.</span>
            </h2>
            <p className="lp-f-desc lp-a lp-d3">
              Top gainers, losers, earnings, dividends, and Fed events — all
              forward-looking. Powered by Finnhub and TradingView&apos;s economic calendar.
            </p>
            <div className="lp-f-bullets">
              <div className="lp-f-bullet lp-a lp-d3">
                <span className="lp-f-dot" />
                Real-time market movers, most active, index strips
              </div>
              <div className="lp-f-bullet lp-a lp-d4">
                <span className="lp-f-dot" />
                Earnings, ex-dividends, FOMC, CPI, PCE, Jobs Report
              </div>
              <div className="lp-f-bullet lp-a lp-d5">
                <span className="lp-f-dot" />
                Fear &amp; Greed index + Treasury yield curve (2s10s spread)
              </div>
              <div className="lp-f-bullet lp-a lp-d6">
                <span className="lp-f-dot" />
                Commodity charts: Gold, Silver, WTI, Copper, Uranium
              </div>
            </div>
          </div>

          <div className="lp-al">
            <div className="lp-mock">
              <div className="lp-mock-hd">
                <span className="lp-mock-hd-title mono">Market · Movers</span>
                <div className="lp-mock-live">
                  <span className="lp-mock-live-dot" />
                  <span className="mono" style={{ fontSize: 10 }}>
                    Live
                  </span>
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  borderBottom: "1px solid var(--lp-border)",
                }}
              >
                {[
                  {
                    label: "Gainers",
                    pos: true,
                    items: [
                      ["META", "+4.2%"],
                      ["TSLA", "+2.8%"],
                      ["ANET", "+2.1%"],
                      ["AMD", "+1.9%"],
                    ] as [string, string][],
                  },
                  {
                    label: "Losers",
                    pos: false,
                    items: [
                      ["INTC", "−3.1%"],
                      ["MU", "−2.4%"],
                      ["QCOM", "−1.8%"],
                      ["WBD", "−1.4%"],
                    ] as [string, string][],
                  },
                ].map((col, ci) => (
                  <div
                    key={col.label}
                    style={{
                      padding: "11px 14px",
                      borderRight: ci === 0 ? "1px solid var(--lp-border)" : "none",
                    }}
                  >
                    <div
                      className="mono lp-muted"
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        marginBottom: 9,
                      }}
                    >
                      {col.label}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {col.items.map(([t, d]) => (
                        <div key={t} style={{ display: "flex", justifyContent: "space-between" }}>
                          <span className="lp-fg mono" style={{ fontSize: 12 }}>
                            {t}
                          </span>
                          <span
                            className={`${col.pos ? "lp-pos" : "lp-neg"} mono`}
                            style={{ fontSize: 12 }}
                          >
                            {d}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ padding: "11px 14px" }}>
                <div
                  className="mono lp-muted"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    marginBottom: 9,
                  }}
                >
                  Upcoming
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { c: "lp-amr", d: "Jun 26", l: "NVDA earnings · after close" },
                    { c: "lp-ste", d: "Jun 28", l: "PCE inflation · 8:30 AM ET" },
                    { c: "lp-pos", d: "Jul 2", l: "LRCX ex-div · $0.97/share" },
                    { c: "lp-ste", d: "Jul 9", l: "FOMC minutes release" },
                  ].map((e) => (
                    <div key={e.d} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                      <span
                        className={`${e.c} mono`}
                        style={{ fontSize: 11, width: 40, flexShrink: 0 }}
                      >
                        {e.d}
                      </span>
                      <span className="lp-muted mono" style={{ fontSize: 11 }}>
                        {e.l}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FEATURE 3: OPTIONS & FUTURES ═══ */}
      <section className="lp-feature" id="s-options">
        <div className="lp-feature-inner">
          <div>
            <span className="lp-f-tag mono lp-a lp-d1">Derivatives</span>
            <h2 className="lp-f-h2 lp-a lp-d2">
              The full chain.
              <br />
              <span className="amber">Not a simplified view.</span>
            </h2>
            <p className="lp-f-desc lp-a lp-d3">
              Full chain explorer with dual-sided call/put view. Strategy builder, P&amp;L
              heatmap, IV analysis, Greeks, and Black-Scholes PoP estimates.
            </p>
            <div className="lp-f-bullets">
              <div className="lp-f-bullet lp-a lp-d3">
                <span className="lp-f-dot" />
                Click-chain mode: click strikes to build multi-leg strategies
              </div>
              <div className="lp-f-bullet lp-a lp-d4">
                <span className="lp-f-dot" />
                P&amp;L heatmap with time decay, IV slider, earnings marker
              </div>
              <div className="lp-f-bullet lp-a lp-d5">
                <span className="lp-f-dot" />
                Auto-recognizes straddles, spreads, iron condors, and more
              </div>
              <div className="lp-f-bullet lp-a lp-d6">
                <span className="lp-f-dot" />
                Expected-move cone, breakeven curve, strategy R:R
              </div>
            </div>
          </div>

          <div className="lp-ar">
            <div className="lp-mock">
              <div className="lp-mock-hd">
                <span className="lp-mock-hd-title mono">Options Chain · ANET · $312.55</span>
                <div className="lp-mock-live">
                  <span className="lp-mock-live-dot" />
                  <span className="mono" style={{ fontSize: 10 }}>
                    Live
                  </span>
                </div>
              </div>
              <div className="lp-tr hd mono" style={{ background: "var(--lp-card2)" }}>
                <span className="lp-tc" style={{ width: 48, textAlign: "right" }}>
                  IV
                </span>
                <span className="lp-tc lp-pos" style={{ flex: 1, textAlign: "right" }}>
                  CALL
                </span>
                <span className="lp-tc" style={{ width: 60, textAlign: "center" }}>
                  STRIKE
                </span>
                <span className="lp-tc lp-neg" style={{ flex: 1, textAlign: "left" }}>
                  PUT
                </span>
                <span className="lp-tc" style={{ width: 48 }}>
                  IV
                </span>
              </div>
              {[
                { iv1: "28.4%", call: "6.80", k: "390", put: "5.10", iv2: "31.2%", atm: false },
                { iv1: "26.1%", call: "4.20", k: "400", put: "3.45", iv2: "29.7%", atm: true },
                { iv1: "24.8%", call: "2.45", k: "410", put: "1.82", iv2: "27.9%", atm: false },
                { iv1: "22.3%", call: "1.10", k: "420", put: "0.85", iv2: "25.6%", atm: false },
              ].map((r) => (
                <div className={`lp-tr mono ${r.atm ? "atm" : ""}`} key={r.k}>
                  <span
                    className="lp-tc lp-muted"
                    style={{ width: 48, textAlign: "right", fontSize: 11 }}
                  >
                    {r.iv1}
                  </span>
                  <span
                    className="lp-tc lp-pos"
                    style={{
                      flex: 1,
                      textAlign: "right",
                      fontSize: 11,
                      fontWeight: r.atm ? 600 : 400,
                    }}
                  >
                    {r.call}
                  </span>
                  <span
                    className={`lp-tc ${r.atm ? "lp-amr" : "lp-muted"}`}
                    style={{
                      width: 60,
                      textAlign: "center",
                      fontSize: 11,
                      fontWeight: r.atm ? 600 : 400,
                    }}
                  >
                    {r.k}
                    {r.atm ? "◆" : ""}
                  </span>
                  <span
                    className="lp-tc lp-neg"
                    style={{
                      flex: 1,
                      textAlign: "left",
                      paddingLeft: 8,
                      fontSize: 11,
                      fontWeight: r.atm ? 600 : 400,
                    }}
                  >
                    {r.put}
                  </span>
                  <span className="lp-tc lp-muted" style={{ width: 48, fontSize: 11 }}>
                    {r.iv2}
                  </span>
                </div>
              ))}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "8px 14px",
                  borderTop: "1px solid var(--lp-border)",
                  background: "var(--lp-card2)",
                }}
              >
                <span className="mono" style={{ fontSize: 11, color: "var(--lp-muted)" }}>
                  Δ <span className="lp-fg">0.47</span>
                </span>
                <span className="mono" style={{ fontSize: 11, color: "var(--lp-muted)" }}>
                  Γ <span className="lp-fg">0.021</span>
                </span>
                <span className="mono" style={{ fontSize: 11, color: "var(--lp-muted)" }}>
                  Θ <span className="lp-neg">−0.08</span>
                </span>
                <span className="mono" style={{ fontSize: 11, color: "var(--lp-muted)" }}>
                  IV <span className="lp-fg">26.1%</span>
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: "var(--lp-muted)", marginLeft: "auto" }}
                >
                  PoP <span className="lp-pos">52%</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FEATURE 4: PAPER TRADING ═══ */}
      <section className="lp-feature lp-alt" id="s-paper">
        <div className="lp-feature-inner flip">
          <div>
            <span className="lp-f-tag mono lp-a lp-d1">Paper Trading</span>
            <h2 className="lp-f-h2 lp-a lp-d2">
              Practice with real prices.
              <br />
              <span className="amber">Zero risk.</span>
            </h2>
            <p className="lp-f-desc lp-a lp-d3">
              A full sandbox across stocks, options, futures, and forex — filled at live
              market prices. Realistic margin, all order types, and a daily P&amp;L curve.
            </p>
            <div className="lp-f-bullets">
              <div className="lp-f-bullet lp-a lp-d3">
                <span className="lp-f-dot" />
                $100k starting cash with Reg-T margin enforcement
              </div>
              <div className="lp-f-bullet lp-a lp-d4">
                <span className="lp-f-dot" />
                Multi-leg options: spreads, iron condors, covered calls
              </div>
              <div className="lp-f-bullet lp-a lp-d5">
                <span className="lp-f-dot" />
                Combo positions trade as one unit — margin per strategy
              </div>
              <div className="lp-f-bullet lp-a lp-d6">
                <span className="lp-f-dot" />
                Daily equity curve + all order history persisted
              </div>
            </div>
          </div>

          <div className="lp-al">
            <div className="lp-mock">
              <div className="lp-mock-hd">
                <span className="lp-mock-hd-title mono">Paper Trading</span>
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--lp-amber)",
                    background: "oklch(0.72 0.14 74 / 0.10)",
                    padding: "2px 9px",
                    borderRadius: 100,
                    border: "1px solid oklch(0.72 0.14 74 / 0.2)",
                  }}
                >
                  SANDBOX
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3,1fr)",
                  borderBottom: "1px solid var(--lp-border)",
                }}
              >
                {[
                  { label: "Equity", val: "$101,247", pos: true },
                  { label: "Buying Power", val: "$64,320", pos: false },
                  { label: "Today P&L", val: "+$1,247", pos: true },
                ].map((m, mi) => (
                  <div
                    key={m.label}
                    style={{
                      padding: "10px 13px",
                      borderRight: mi < 2 ? "1px solid var(--lp-border)" : "none",
                    }}
                  >
                    <div className="lp-muted" style={{ fontSize: 10, marginBottom: 3 }}>
                      {m.label}
                    </div>
                    <div
                      className={`${m.pos ? "lp-pos" : "lp-fg"} mono`}
                      style={{ fontSize: 13, fontWeight: 600 }}
                    >
                      {m.val}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ padding: "10px 13px 5px" }}>
                <div
                  className="mono lp-muted"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  Open positions
                </div>
                {[
                  { sym: "AAPL", qty: "10", last: "$201.45", pnl: "+$122.50", pos: true },
                  { sym: "NVDA", qty: "5", last: "$892.44", pnl: "+$262.20", pos: true },
                  { sym: "INTC", qty: "20", last: "$31.80", pnl: "−$66.00", pos: false },
                  { sym: "SPY", qty: "2", last: "$559.90", pnl: "+$87.40", pos: true },
                ].map((p, pi, arr) => (
                  <div
                    key={p.sym}
                    className="mono"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 0",
                      borderBottom:
                        pi < arr.length - 1 ? "1px solid var(--lp-bsoft)" : "none",
                      fontSize: 12,
                    }}
                  >
                    <span className="lp-fg" style={{ width: 44 }}>
                      {p.sym}
                    </span>
                    <span className="lp-muted" style={{ width: 22, textAlign: "right" }}>
                      {p.qty}
                    </span>
                    <span className="lp-muted" style={{ flex: 1, textAlign: "right" }}>
                      {p.last}
                    </span>
                    <span
                      className={p.pos ? "lp-pos" : "lp-neg"}
                      style={{ width: 72, textAlign: "right" }}
                    >
                      {p.pnl}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ COMPETITIONS ═══ */}
      <section className="lp-comps" id="s-comps">
        <div className="lp-comps-inner">
          <div>
            <div
              className="lp-a mono"
              style={{
                display: "inline-block",
                border: "1px solid var(--lp-border)",
                fontSize: 10,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: "var(--lp-amber)",
                padding: "4px 12px",
                borderRadius: 100,
                marginBottom: 20,
              }}
            >
              New
            </div>
            <h2 className="lp-f-h2 lp-a lp-d1">
              Compete.
              <br />
              Compare. <span className="amber">Calibrate.</span>
            </h2>
            <p className="lp-f-desc lp-a lp-d2">
              Enter private or global paper-trading competitions. Leaderboards ranked by
              total return, Sharpe ratio, and max drawdown.
            </p>
            <div className="lp-f-bullets">
              <div className="lp-f-bullet lp-a lp-d3">
                <span className="lp-f-dot" />
                Private invite-code competitions with your group
              </div>
              <div className="lp-f-bullet lp-a lp-d4">
                <span className="lp-f-dot" />
                Three scoring boards: Return, Sharpe, Max Drawdown
              </div>
              <div className="lp-f-bullet lp-a lp-d5">
                <span className="lp-f-dot" />
                Live trade feed — see what others are buying and selling
              </div>
            </div>
          </div>

          <div className="lp-ar">
            <div className="lp-lb">
              <div className="lp-lb-hd mono">
                <span className="lp-lr">#</span>
                <span className="lp-lh">Handle</span>
                <span className="lp-lrt">Return</span>
                <span className="lp-lsh">Sharpe</span>
              </div>
              {[
                { r: "1", h: "qvr_trade", ret: "+18.4%", sh: "2.41", me: false, pos: true },
                { r: "2", h: "midnightmkts", ret: "+14.2%", sh: "1.87", me: false, pos: true },
                { r: "3", h: "you", ret: "+9.7%", sh: "1.34", me: true, pos: true },
                { r: "4", h: "delta_hedge", ret: "+7.1%", sh: "0.98", me: false, pos: true },
                { r: "5", h: "vix_trader_99", ret: "−2.3%", sh: "−0.21", me: false, pos: false },
              ].map((row) => (
                <div className={`lp-lb-row ${row.me ? "me" : ""}`} key={row.r}>
                  <span
                    className={`lp-lr ${row.me ? "lp-amr" : "lp-muted"} mono`}
                    style={{ fontSize: 12 }}
                  >
                    {row.r}
                  </span>
                  <span
                    className={`lp-lh ${row.me ? "lp-amr" : "lp-fg"} mono`}
                    style={{ fontSize: 12 }}
                  >
                    {row.h}
                    {row.me ? (
                      <span style={{ fontSize: 10, opacity: 0.55 }}> ← you</span>
                    ) : null}
                  </span>
                  <span
                    className={`lp-lrt ${row.pos ? "lp-pos" : "lp-neg"} mono`}
                    style={{ fontSize: 12 }}
                  >
                    {row.ret}
                  </span>
                  <span
                    className={`lp-lsh ${row.me ? "lp-amr" : "lp-muted"} mono`}
                    style={{ fontSize: 12 }}
                  >
                    {row.sh}
                  </span>
                </div>
              ))}
            </div>

            <div className="lp-feed">
              <div className="lp-feed-hd mono">Live feed</div>
              {[
                { h: "qvr_trade", c: "lp-amr", a: "bought 10 NVDA @ $892.44", t: "2m ago" },
                { h: "midnightmkts", c: "lp-ste", a: "sold SPY 560C 6/28", t: "5m ago" },
                { h: "delta_hedge", c: "lp-muted", a: "iron condor ANET", t: "12m ago" },
              ].map((f) => (
                <div className="lp-feed-row" key={f.h}>
                  <span className={`${f.c} mono`}>{f.h}</span>
                  <span className="lp-muted mono">{f.a}</span>
                  <span className="lp-feed-ts mono">{f.t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ CLOSING CTA ═══ */}
      <section className="lp-cta" id="s-cta">
        <p className="lp-cta-eye mono lp-a">Precision · Clarity · Control</p>
        <h2 className="lp-cta-h2 lp-a lp-d1">
          Your portfolio deserves a
          <br />
          <span className="amber">serious instrument.</span>
        </h2>
        <p className="lp-cta-sub lp-a lp-d2">
          No gamification. No dopamine bait. No confetti. Just clean data and sharp tools
          for people who take their money seriously.
        </p>
        <div
          className="lp-a lp-d3"
          style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}
        >
          <Link
            href="/login"
            className="lp-btn-hero-primary"
            style={{ fontSize: 15, padding: "13px 34px" }}
          >
            Get started — it&apos;s free
          </Link>
          <Link
            href="/login"
            className="lp-btn-hero-outline"
            style={{ fontSize: 15, padding: "13px 34px" }}
          >
            Log in
          </Link>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <span className="lp-nav-logo mono">FINTRACK</span>
          <span className="mono lp-muted" style={{ fontSize: 11 }}>
            fintrack · v0.1.0
          </span>
        </div>
      </footer>
    </div>
  );
}
