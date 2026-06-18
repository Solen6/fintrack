import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { holdingId, shares: sharesToClose, salePrice } = body as {
    holdingId: string;
    shares: number;
    salePrice: number;
  };

  if (!holdingId || !sharesToClose || sharesToClose <= 0 || !salePrice || salePrice <= 0) {
    return NextResponse.json({ error: "holdingId, shares (>0), and salePrice (>0) are required" }, { status: 400 });
  }

  const { data: holding, error: fetchErr } = await supabase
    .from("holdings")
    .select("*")
    .eq("id", holdingId)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !holding) {
    return NextResponse.json({ error: "Holding not found" }, { status: 404 });
  }

  if (sharesToClose > holding.shares) {
    return NextResponse.json({ error: `Cannot close ${sharesToClose} shares — only ${holding.shares} held` }, { status: 400 });
  }

  const { error: insertErr } = await supabase.from("closed_positions").insert({
    user_id: user.id,
    ticker: holding.ticker,
    name: holding.name,
    shares: sharesToClose,
    cost_basis: holding.cost_basis,
    sale_price: salePrice,
    account: holding.account,
    notes: holding.notes,
  });

  if (insertErr) {
    if (insertErr.message?.includes("relation") && insertErr.message?.includes("does not exist")) {
      return NextResponse.json({ error: "Run supabase/closed-positions.sql in the SQL Editor first" }, { status: 503 });
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  const remaining = holding.shares - sharesToClose;
  if (remaining <= 0) {
    await supabase.from("holdings").delete().eq("id", holdingId).eq("user_id", user.id);
  } else {
    await supabase.from("holdings").update({ shares: remaining }).eq("id", holdingId).eq("user_id", user.id);
  }

  return NextResponse.json({ ok: true, remaining });
}
