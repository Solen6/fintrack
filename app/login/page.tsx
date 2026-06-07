"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
      } else {
        window.location.href = "/portfolio";
      }
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setError(error.message);
      } else {
        setMessage("Check your email to confirm your account.");
      }
    }

    setLoading(false);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "oklch(0.08 0 0)" }}
    >
      <div className="w-full max-w-sm px-6">
        {/* Logo */}
        <div className="mb-8 text-center">
          <span
            className="text-2xl font-semibold tracking-tight"
            style={{ color: "oklch(0.72 0.14 74)" }}
          >
            fintrack
          </span>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "signin" ? "Sign in to your account" : "Create an account"}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs text-muted-foreground">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="h-9 px-3 text-sm rounded-sm border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors duration-150"
              style={{ background: "oklch(0.12 0 0)" }}
              placeholder="you@example.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs text-muted-foreground">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              className="h-9 px-3 text-sm rounded-sm border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors duration-150"
              style={{ background: "oklch(0.12 0 0)" }}
              placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"}
            />
          </div>

          {/* Error / success messages */}
          {error && (
            <p
              className="text-xs px-3 py-2 rounded-sm"
              style={{
                background: "oklch(0.15 0.04 28)",
                color: "oklch(0.80 0.12 28)",
              }}
            >
              {error}
            </p>
          )}
          {message && (
            <p
              className="text-xs px-3 py-2 rounded-sm"
              style={{
                background: "oklch(0.14 0.04 74)",
                color: "oklch(0.80 0.10 74)",
              }}
            >
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="h-9 mt-1 text-sm font-medium rounded-sm transition-opacity duration-150 disabled:opacity-50"
            style={{
              background: "oklch(0.72 0.14 74)",
              color: "oklch(0.08 0 0)",
            }}
          >
            {loading
              ? "Please wait…"
              : mode === "signin"
              ? "Sign in"
              : "Create account"}
          </button>
        </form>

        {/* Toggle mode */}
        <p className="text-xs text-muted-foreground text-center mt-5">
          {mode === "signin" ? "No account?" : "Already have an account?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setMessage(null);
            }}
            className="text-foreground hover:underline transition-colors duration-150"
          >
            {mode === "signin" ? "Create one" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
