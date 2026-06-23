import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Live trade feed for one competition: the most recent FILLED orders across all
 * entries, attributed by handle. Reads cross-user via the public-read policy on
 * paper_orders (FILLED + competition account only) — positions/cash stay private.
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: entries } = await supabase
    .from("competition_entries")
    .select("user_id, account_id")
    .eq("competition_id", id);
  const list = (entries ?? []) as { user_id: string; account_id: string }[];
  if (list.length === 0) return NextResponse.json({ feed: [] });

  const accountIds = list.map((e) => e.account_id);
  const acctToUser = new Map(list.map((e) => [e.account_id, e.user_id]));
  const userIds = [...new Set(list.map((e) => e.user_id))];

  const [{ data: orders }, { data: profiles }] = await Promise.all([
    supabase
      .from("paper_orders")
      .select("id, account_id, symbol, asset_class, side, shares, price, filled_at")
      .in("account_id", accountIds)
      .eq("status", "FILLED")
      .order("filled_at", { ascending: false })
      .limit(60),
    supabase.from("public_profiles").select("user_id, handle, avatar").in("user_id", userIds),
  ]);

  const profMap = new Map(
    ((profiles ?? []) as { user_id: string; handle: string; avatar: string | null }[]).map((p) => [p.user_id, p])
  );

  const feed = ((orders ?? []) as {
    id: string;
    account_id: string;
    symbol: string;
    asset_class: string;
    side: string;
    shares: number;
    price: number | null;
    filled_at: string | null;
  }[]).map((o) => {
    const uid = acctToUser.get(o.account_id);
    const prof = uid ? profMap.get(uid) : undefined;
    return {
      id: o.id,
      handle: prof?.handle ?? "Anonymous",
      avatar: prof?.avatar ?? null,
      symbol: o.symbol,
      assetClass: o.asset_class,
      side: o.side,
      qty: Number(o.shares),
      price: o.price != null ? Number(o.price) : null,
      filledAt: o.filled_at,
      isMe: uid === user.id,
    };
  });

  return NextResponse.json({ feed });
}
