"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export interface Profile {
  name: string;
  email: string;
  initial: string;
  loading: boolean;
}

/** Title-case an email local part: "carter.rowe" → "Carter Rowe". */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(" ") || local || "Account";
}

function deriveName(user: User): string {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const explicit = String(meta.full_name ?? meta.name ?? "").trim();
  return explicit || nameFromEmail(user.email ?? "");
}

/**
 * The signed-in user's display profile, read live from Supabase auth.
 * Replaces the old hardcoded profile so each account shows its own identity.
 * Name comes from user_metadata (full_name/name) if set, else derived from the email.
 */
export function useProfile(): Profile {
  const [profile, setProfile] = useState<Profile>({ name: "", email: "", initial: "", loading: true });

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    const apply = (user: User | null) => {
      if (!active) return;
      if (!user) {
        setProfile({ name: "", email: "", initial: "", loading: false });
        return;
      }
      const name = deriveName(user);
      const email = user.email ?? "";
      const initial = (name.trim()[0] || email[0] || "?").toUpperCase();
      setProfile({ name, email, initial, loading: false });
    };

    supabase.auth.getUser().then(({ data }) => apply(data.user));

    // Keep in sync when the user updates their profile (USER_UPDATED) or signs in/out.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => apply(session?.user ?? null));

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return profile;
}
