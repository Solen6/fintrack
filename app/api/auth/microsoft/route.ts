import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMicrosoftAuthUrl } from "@/lib/microsoft-graph";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL!));
  }

  // Use user ID as state for CSRF protection
  const authUrl = getMicrosoftAuthUrl(user.id);
  return NextResponse.redirect(authUrl);
}
