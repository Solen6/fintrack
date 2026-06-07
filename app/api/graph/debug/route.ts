import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshAccessToken } from "@/lib/microsoft-graph";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: conn } = await supabase
    .from("microsoft_connections")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!conn) return NextResponse.json({ error: "No connection" });

  let accessToken = conn.access_token;
  if (new Date(conn.expires_at) < new Date(Date.now() + 60_000)) {
    const refreshed = await refreshAccessToken(conn.refresh_token);
    accessToken = refreshed.access_token;
  }

  const GRAPH = "https://graph.microsoft.com/v1.0";

  const [root, docs, special] = await Promise.all([
    fetch(`${GRAPH}/me/drive/root/children?$select=id,name,file,folder,size`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(r => r.json()),
    fetch(`${GRAPH}/me/drive/root:/Documents:/children?$select=id,name,file,folder,size`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(r => r.json()),
    fetch(`${GRAPH}/me/drive/special/documents/children?$select=id,name,file,folder,size`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(r => r.json()),
  ]);

  return NextResponse.json({ root, docs, special });
}
