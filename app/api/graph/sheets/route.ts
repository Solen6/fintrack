import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listWorksheets, refreshAccessToken } from "@/lib/microsoft-graph";

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: conn } = await supabase
      .from("microsoft_connections")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!conn) return NextResponse.json({ connected: false });

    let accessToken = conn.access_token;
    if (new Date(conn.expires_at) < new Date(Date.now() + 60_000)) {
      const refreshed = await refreshAccessToken(conn.refresh_token);
      accessToken = refreshed.access_token;
      await supabase.from("microsoft_connections").update({
        access_token:  refreshed.access_token,
        refresh_token: refreshed.refresh_token ?? conn.refresh_token,
        expires_at:    new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        updated_at:    new Date().toISOString(),
      }).eq("user_id", user.id);
    }

    const sheets = await listWorksheets(accessToken, path);
    return NextResponse.json({ sheets });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
