import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getWorksheetRange,
  refreshAccessToken,
  parseHoldingsSheet,
} from "@/lib/microsoft-graph";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Fetch connection
    const { data: conn, error: connErr } = await supabase
      .from("microsoft_connections")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (connErr || !conn) {
      return NextResponse.json({ connected: false });
    }

    // Refresh token if expired
    let accessToken = conn.access_token;
    if (new Date(conn.expires_at) < new Date(Date.now() + 60_000)) {
      const refreshed = await refreshAccessToken(conn.refresh_token);
      accessToken = refreshed.access_token;
      await supabase.from("microsoft_connections").update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token ?? conn.refresh_token,
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("user_id", user.id);
    }

    const filePath  = conn.portfolio_file_path  ?? "Documents/portfolio.xlsx";
    const sheetName = conn.portfolio_sheet_name ?? "Holdings";
    const range = await getWorksheetRange(accessToken, filePath, sheetName);
    const holdings = parseHoldingsSheet(range);

    return NextResponse.json({ connected: true, holdings });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Portfolio graph error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
