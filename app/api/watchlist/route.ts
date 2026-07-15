import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchQuote, fetchQuotes } from "@/lib/finnhub";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;

export interface WatchlistItem {
  id: string;
  ticker: string;
  name: string | null;
  addedAt: string;      // ISO timestamp
  addedPrice: number | null;
  price: number | null;
  dayPct: number | null;
  sincePct: number | null; // vs added_price — "% gain since started watching"
}

/** Company name at add time (Finnhub profile2, free tier). Best-effort. */
async function fetchName(ticker: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.name === "string" && data.name ? data.name : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: rows, error } = await supabase
    .from("watchlist")
    .select("id,ticker,name,added_at,added_price")
    .eq("user_id", user.id)
    .order("added_at", { ascending: true });
  if (error) {
    // Table not migrated yet → surface a setup hint instead of a bare 500.
    const setup = /schema cache|does not exist|PGRST205/i.test(error.message);
    return NextResponse.json(
      { error: setup ? "Watchlist table missing — run supabase/watchlist-reminders.sql" : error.message },
      { status: setup ? 503 : 500 },
    );
  }

  const tickers = (rows ?? []).map((r) => (r.ticker as string).toUpperCase());
  const quotes = tickers.length > 0 ? await fetchQuotes(tickers) : {};

  const items: WatchlistItem[] = (rows ?? []).map((r) => {
    const t = (r.ticker as string).toUpperCase();
    const q = quotes[t];
    const price = q?.price ?? null;
    const addedPrice = r.added_price != null ? Number(r.added_price) : null;
    return {
      id: r.id as string,
      ticker: t,
      name: (r.name as string | null) ?? null,
      addedAt: r.added_at as string,
      addedPrice,
      price,
      dayPct: q?.changePct ?? null,
      sincePct:
        price != null && addedPrice != null && addedPrice > 0
          ? ((price - addedPrice) / addedPrice) * 100
          : null,
    };
  });

  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
    return NextResponse.json({ error: "Enter a valid ticker" }, { status: 400 });
  }

  // Baseline price + name at the moment watching starts. A ticker Finnhub
  // can't quote (typo, delisted) is rejected rather than stored dead.
  const [quote, name] = await Promise.all([fetchQuote(ticker), fetchName(ticker)]);
  if (!quote || !(quote.price > 0)) {
    return NextResponse.json({ error: `No quote for ${ticker}` }, { status: 404 });
  }

  const { data: row, error } = await supabase
    .from("watchlist")
    .insert({
      user_id: user.id,
      ticker,
      name,
      added_price: quote.price,
    })
    .select("id")
    .single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return NextResponse.json({ error: `${ticker} is already on your watchlist` }, { status: 409 });
    }
    const setup = /schema cache|does not exist|PGRST205/i.test(error.message);
    return NextResponse.json(
      { error: setup ? "Watchlist table missing — run supabase/watchlist-reminders.sql" : error.message },
      { status: setup ? 503 : 500 },
    );
  }

  return NextResponse.json({ ok: true, id: row.id, ticker, price: quote.price });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabase.from("watchlist").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
