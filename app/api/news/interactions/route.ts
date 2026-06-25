import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface ArticleState {
  read: boolean;
  saved: boolean;
  deleted: boolean;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("news_interactions")
    .select("article_url, is_read, is_saved, is_deleted")
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const interactions: Record<string, ArticleState> = {};
  for (const row of data ?? []) {
    interactions[row.article_url] = {
      read: row.is_read,
      saved: row.is_saved,
      deleted: row.is_deleted,
    };
  }
  return NextResponse.json({ interactions });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const url = (body.url ?? "").trim();
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });

  const { error } = await supabase
    .from("news_interactions")
    .upsert(
      {
        user_id: user.id,
        article_url: url,
        is_read: body.read ?? false,
        is_saved: body.saved ?? false,
        is_deleted: body.deleted ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,article_url" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
