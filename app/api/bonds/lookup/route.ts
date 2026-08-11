import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Resolve a Treasury CUSIP to its issue terms, so the Add Bond form can fill
 * itself in the way Add Position already does from a ticker.
 *
 * Source: TreasuryDirect's public securities API (no key, no rate limit
 * published). It is the ISSUER's own record, so the coupon rate and maturity it
 * returns are authoritative — which matters more here than the name, because
 * those two fields are exactly what lib/bond-lifecycle.ts pays coupons from. A
 * typo'd coupon rate silently pays the wrong money forever.
 *
 * ⚠️ SCOPE: Treasuries only. TreasuryDirect has no record of agency paper or
 * brokered CDs, and there is no free CUSIP→terms feed for either, so those
 * simply don't resolve and the form stays manual — the same outcome as an
 * unknown ticker in Add Position. This route says so via `found: false` rather
 * than guessing.
 *
 * Auth-gated like the rest of /api: this is a logged-in convenience, not a
 * public CUSIP proxy.
 */

interface TreasuryRecord {
  cusip?: string;
  /* ⚠️ `securityType` is the broad CATEGORY and lies about the interesting
     cases: a TIPS and a floating-rate note both come back as "Note". `type` is
     the real one (Bill | Note | Bond | TIPS | FRN | CMB) — verified against
     live records for all five. Label off `type`, never `securityType`. */
  type?: string;
  securityType?: string;
  securityTerm?: string; // "7-Year"
  interestRate?: string; // "4.375000" — empty on a bill and on every floater
  floatingRate?: string; // "Yes" | "No"
  maturityDate?: string; // "2033-07-31T00:00:00"
  issueDate?: string;
}

export interface BondLookup {
  found: boolean;
  cusip: string;
  name?: string;
  couponRate?: number;
  couponFreq?: number;
  maturityDate?: string; // yyyy-mm-dd
  issueDate?: string; // yyyy-mm-dd
  securityType?: string;
  /** A floating-rate note: its coupon resets and we deliberately don't fill one. */
  floating?: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  Bill: "U.S. Treasury Bill",
  Note: "U.S. Treasury Note",
  Bond: "U.S. Treasury Bond",
  TIPS: "U.S. Treasury TIPS",
  FRN: "U.S. Treasury FRN",
  CMB: "U.S. Treasury Cash Management Bill",
};

/** Coupon payments per year by security type. */
function freqFor(securityType: string): number {
  // Bills are zero-coupon (sold at a discount, redeemed at par) — 2 is just the
  // form's default and is never used, since the rate is 0.
  if (securityType === "FRN") return 4; // floaters pay quarterly
  return 2; // Notes, Bonds and TIPS all pay semiannually
}

const isoDay = (s: string | undefined) => (s ? s.slice(0, 10) : undefined);

function buildName(securityType: string, rate: number, maturity: string | undefined): string {
  const parts = [TYPE_LABEL[securityType] ?? "U.S. Treasury"];
  // A bill has no coupon and a floater's isn't fixed, so quoting "0%" would
  // read as a mistake rather than as the defining feature of the security.
  if (Number.isFinite(rate) && rate > 0) parts.push(`${trimRate(rate)}%`);
  if (maturity) {
    const [y, m, d] = maturity.split("-");
    parts.push(`${m}/${d}/${y}`);
  }
  return parts.join(" ");
}

/** "4.375000" → "4.375"; "4.000000" → "4". */
function trimRate(rate: number): string {
  return String(Number(rate.toFixed(6)));
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = (new URL(request.url).searchParams.get("cusip") ?? "").trim().toUpperCase();
  // A CUSIP is exactly 9 alphanumerics — the same shape lib/parse-csv.ts uses to
  // spot bond rows in a Fidelity export.
  if (!/^[0-9A-Z]{9}$/.test(raw)) {
    return NextResponse.json({ found: false, cusip: raw } satisfies BondLookup);
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      `https://www.treasurydirect.gov/TA_WS/securities/search?cusip=${encodeURIComponent(raw)}&format=json`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; fintrack/1.0)" },
        signal: ctrl.signal,
        // A security's issue terms never change once auctioned, so this is
        // cacheable for as long as we like. A day keeps a freshly-auctioned
        // CUSIP from being unresolvable for a week.
        next: { revalidate: 86_400 },
      },
    ).finally(() => clearTimeout(timer));

    if (!res.ok) return NextResponse.json({ found: false, cusip: raw } satisfies BondLookup);
    const rows = (await res.json()) as TreasuryRecord[];
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ found: false, cusip: raw } satisfies BondLookup);
    }

    /* A CUSIP can come back more than once — a reopened security is auctioned
       again under the same CUSIP. The terms that matter here (coupon, maturity)
       are identical across reopenings by definition, so take the record that
       actually carries a rate; an announced-but-not-yet-priced auction has an
       empty interestRate and would otherwise blank the field. */
    const rec = rows.find((r) => Number(r.interestRate) > 0) ?? rows[0];
    const maturityDate = isoDay(rec.maturityDate);
    const securityType = rec.type || rec.securityType || "";
    const floating = rec.floatingRate === "Yes" || securityType === "FRN";
    const parsed = Number(rec.interestRate);
    const rate = Number.isFinite(parsed) ? parsed : 0;

    return NextResponse.json({
      found: true,
      cusip: raw,
      name: buildName(securityType, rate, maturityDate),
      /* A floater's coupon resets off the 13-week bill and lib/bond-math.ts
         only models a FIXED coupon, so we send NO rate rather than the 0 the
         feed reports. Filling 0 would look successful and then quietly pay
         nothing forever — the worst of both outcomes. The form says so and
         leaves the field to the user. */
      couponRate: floating ? undefined : rate,
      couponFreq: freqFor(securityType),
      maturityDate,
      issueDate: isoDay(rec.issueDate),
      securityType,
      floating,
    } satisfies BondLookup);
  } catch {
    // Unreachable feed or a timeout — indistinguishable from "not a Treasury"
    // as far as the form is concerned: leave the fields alone.
    return NextResponse.json({ found: false, cusip: raw } satisfies BondLookup);
  }
}
