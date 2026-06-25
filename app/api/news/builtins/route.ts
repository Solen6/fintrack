import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  BUILTIN_KEYS,
  DEFAULT_BUILTIN_PREFS,
  type BuiltinKey,
  type BuiltinPrefs,
} from "@/lib/news-builtins";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("news_builtin_prefs")
    .select("source_key, enabled")
    .eq("user_id", user.id);

  // Degrade gracefully if the migration hasn't been run yet → all enabled
  if (error) return NextResponse.json({ builtins: DEFAULT_BUILTIN_PREFS });

  const builtins: BuiltinPrefs = { ...DEFAULT_BUILTIN_PREFS };
  for (const row of data ?? []) {
    if ((BUILTIN_KEYS as string[]).includes(row.source_key)) {
      builtins[row.source_key as BuiltinKey] = row.enabled;
    }
  }
  return NextResponse.json({ builtins });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const key = body.key as string;
  if (!(BUILTIN_KEYS as string[]).includes(key)) {
    return NextResponse.json({ error: "invalid key" }, { status: 400 });
  }

  const { error } = await supabase
    .from("news_builtin_prefs")
    .upsert(
      {
        user_id: user.id,
        source_key: key,
        enabled: body.enabled ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,source_key" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
