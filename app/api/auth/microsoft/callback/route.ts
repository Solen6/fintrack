import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCodeForTokens } from "@/lib/microsoft-graph";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code  = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state"); // user_id we passed as state

  const base = process.env.NEXT_PUBLIC_APP_URL!;

  if (error || !code || !state) {
    return NextResponse.redirect(`${base}/accounts?error=microsoft_auth_failed`);
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || user.id !== state) {
      return NextResponse.redirect(`${base}/accounts?error=state_mismatch`);
    }

    const tokens = await exchangeCodeForTokens(code);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Upsert connection record
    const { error: dbError } = await supabase
      .from("microsoft_connections")
      .upsert({
        user_id:       user.id,
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at:    expiresAt,
        updated_at:    new Date().toISOString(),
      }, { onConflict: "user_id" });

    if (dbError) throw dbError;

    return NextResponse.redirect(`${base}/accounts?connected=true`);
  } catch (err) {
    console.error("Microsoft auth callback error:", err);
    return NextResponse.redirect(`${base}/accounts?error=token_exchange_failed`);
  }
}
