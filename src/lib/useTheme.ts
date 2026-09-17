"use client";

import { useEffect, useState } from "react";

export type Theme = "plexus" | "modern" | "editorial" | "system";
export type ResolvedTheme = "plexus" | "modern" | "editorial";

const STORAGE_KEY = "eugene-theme";
// The default, in the one shape each caller needs: `system` is a valid
// STORED choice but never a rendered one, so the resolver's fallback
// must be typed as a theme that has tokens.
const DEFAULT_RESOLVED_THEME: ResolvedTheme = "plexus";
const DEFAULT_THEME: Theme = DEFAULT_RESOLVED_THEME;
// `system` only maps to plexus/modern — editorial is an explicit
// operator pick, not an OS-level concept.
const VALID_THEMES: ReadonlySet<Theme> = new Set(["plexus", "modern", "editorial", "system"]);
/**
 * Themes that no longer exist, and what they became. Dropping a retired
 * value instead would send everyone who had chosen the dark theme to a
 * light one, which reads as the preference being ignored rather than
 * as the theme being renamed. The pre-hydration script in `layout.tsx`
 * carries the same map inline, so the two agree on the first frame.
 */
const RETIRED_THEMES: Readonly<Record<string, Theme>> = { cyberpunk: "plexus" };

/**
 * Resolve `system` to a concrete theme via `prefers-color-scheme`.
 * Plexus is the dark theme, modern is the light theme, so the OS
 * preference maps cleanly. Falls back to `DEFAULT_THEME` during SSR /
 * when `matchMedia` isn't available — the same theme an operator gets
 * with nothing stored, so "we could not ask the OS" and "nobody has
 * chosen" land in the same place.
 *
 * **This fallback is a fifth place the default is spelled, and the
 * four-places comment in `layout.tsx` does not name it.** It was a
 * literal `"modern"` until the 2026-09-17 promotion, which is exactly
 * how a literal here drifts: nothing fails, the two answers just stop
 * agreeing on the one path that cannot ask the OS. Hence the constant.
 */
function resolveSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return DEFAULT_RESOLVED_THEME;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "plexus" : "modern";
}

function resolve(theme: Theme): ResolvedTheme {
  return theme === "system" ? resolveSystemTheme() : theme;
}

/**
 * Read the user's theme choice from `localStorage` and keep
 * `<html data-theme>` in sync with the *resolved* theme. The
 * pre-hydration script in `layout.tsx` does the same resolution before
 * paint to avoid a flash; this hook also subscribes to OS preference
 * changes so toggling system dark-mode flips Eugene live without a
 * reload.
 */
export function useTheme(): readonly [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    document.documentElement.dataset.theme = resolve(stored);
  }, []);

  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      document.documentElement.dataset.theme = resolveSystemTheme();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  function setTheme(next: Theme): void {
    setThemeState(next);
    document.documentElement.dataset.theme = resolve(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage can throw in private modes; the in-memory state still
      // applies, the choice just won't persist across reloads.
    }
  }

  return [theme, setTheme] as const;
}

function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const renamed = raw ? RETIRED_THEMES[raw] : undefined;
    if (renamed) return renamed;
    if (raw && VALID_THEMES.has(raw as Theme)) return raw as Theme;
  } catch {
    // ignore
  }
  return DEFAULT_THEME;
}
