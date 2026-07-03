"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/* ──────────────────────────────────────────────────────────────────────────
   Private mode — hides the user's own money (account balances, holding values,
   realized/unrealized P&L, cash, dividend income, report figures) so the app
   can be opened in public or screen-shared without exposing net worth.

   Percentages, share counts and public market prices stay visible.

   Design:
   • The toggle state lives in a context (drives the nav button) and persists
     per-device in localStorage under `fintrack:private`.
   • The actual masking is done in CSS via an `is-private` class on <html>
     (see app/globals.css + the pre-paint script in app/layout.tsx). Doing it
     in CSS — instead of conditionally rendering in React — means <Sensitive>
     renders identically on the server and client (no hydration mismatch) and
     there is no flash of real balances on load: the inline script sets the
     class before first paint.
   • In private mode the real text is hidden via `visibility:hidden` (so it is
     never painted → absent from screenshots, not selectable) and replaced with
     dots. Width is preserved, so toggling causes no layout shift.
   ────────────────────────────────────────────────────────────────────────── */

const STORAGE_KEY = "fintrack:private";

/** Placeholder for masked money where a <Sensitive> span can't be used
    (e.g. SVG chart axis/labels rendered by Recharts). */
export const MONEY_MASK = "••••";

interface PrivacyContextValue {
  /** True when sensitive figures are masked. */
  hidden: boolean;
  toggle: () => void;
  setHidden: (v: boolean) => void;
}

const PrivacyContext = createContext<PrivacyContextValue>({
  hidden: false,
  toggle: () => {},
  setHidden: () => {},
});

function syncClass(v: boolean) {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("is-private", v);
  }
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  // Start `false` so SSR and the first client render agree. The inline head
  // script has already applied the <html> class for a stored-on state, so
  // there's no flash; we reconcile React state to the stored value on mount.
  const [hidden, setHiddenState] = useState(false);

  useEffect(() => {
    let stored = false;
    try {
      stored = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {}
    setHiddenState(stored);
    syncClass(stored);
  }, []);

  const persist = useCallback((v: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {}
    syncClass(v);
  }, []);

  const setHidden = useCallback(
    (v: boolean) => {
      setHiddenState(v);
      persist(v);
    },
    [persist],
  );

  const toggle = useCallback(() => {
    setHiddenState((prev) => {
      const next = !prev;
      persist(next);
      return next;
    });
  }, [persist]);

  return (
    <PrivacyContext.Provider value={{ hidden, toggle, setHidden }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy(): PrivacyContextValue {
  return useContext(PrivacyContext);
}

/**
 * Marks a sensitive money value (balance, holding value, P&L, income). Renders
 * its children in a `.fin-sensitive` span; CSS masks it when <html> carries the
 * `is-private` class. Safe in any client component — no hooks, no hydration
 * concerns. Percentages and share counts should be left OUTSIDE this wrapper.
 */
export function Sensitive({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={className ? `fin-sensitive ${className}` : "fin-sensitive"}>
      {children}
    </span>
  );
}
