import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* ─── POST: batch-update dividend handling (DRIP vs cash) for many holdings in
   one request, so the "Manage dividends" modal saves all changes at once
   instead of one PATCH (and one reload) per security. ─── */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const items = body.items as Array<{ id: string; drip: boolean }> | undefined;
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "items array is required" }, { status: 400 });
  }

  // Group ids by target value → two bulk updates instead of N. RLS + the
  // user_id filter ensure a user can only flip their own holdings.
  const toReinvest = items.filter((i) => i.drip === true).map((i) => i.id);
  const toCash = items.filter((i) => i.drip === false).map((i) => i.id);

  if (toReinvest.length) {
    const { error } = await supabase
      .from("holdings")
      .update({ drip: true })
      .eq("user_id", user.id)
      .in("id", toReinvest);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (toCash.length) {
    const { error } = await supabase
      .from("holdings")
      .update({ drip: false })
      .eq("user_id", user.id)
      .in("id", toCash);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: items.length });
}
