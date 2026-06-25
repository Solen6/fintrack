import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("news_sources")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sources: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const name = (body.name ?? "").trim();
  const url = (body.url ?? "").trim();

  if (!name || !url) return NextResponse.json({ error: "name and url required" }, { status: 400 });
  if (!url.startsWith("http")) return NextResponse.json({ error: "invalid url" }, { status: 400 });

  const { data, error } = await supabase
    .from("news_sources")
    .insert({ user_id: user.id, name, url })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ source: data }, { status: 201 });
}
