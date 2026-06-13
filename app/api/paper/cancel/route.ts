import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* POST: cancel a PENDING order owned by the user */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const orderId = String(body.orderId ?? "");
  if (!orderId) return NextResponse.json({ error: "orderId is required." }, { status: 400 });

  const { data, error } = await supabase
    .from("paper_orders")
    .update({ status: "CANCELLED" })
    .eq("id", orderId)
    .eq("user_id", user.id)
    .eq("status", "PENDING")
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Order not found or not pending." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
