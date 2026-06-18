import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("closed_positions")
    .select("*")
    .eq("user_id", user.id)
    .order("closed_at", { ascending: false });

  if (error) {
    if (error.message?.includes("relation") && error.message?.includes("does not exist")) {
      return NextResponse.json({ closed: [], needsMigration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ closed: data ?? [] });
}
