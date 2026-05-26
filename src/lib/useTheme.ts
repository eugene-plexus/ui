"use client";

import { useEffect, useState } from "react";

export type Theme = "cyberpunk" | "modern" | "editorial" | "system";
export type ResolvedTheme = "cyberpunk" | "modern" | "editorial";

const STORAGE_KEY = "eugene-theme";
const DEFAULT_THEME: Theme = "cyberpunk";
// `system` only maps to cyberpunk/modern — editorial is an explicit
// operator pick, not an OS-level concept.
const VALID_THEMES: ReadonlySet<Theme> = new Set([
  "cyberpunk",
  "modern",
  "editorial",
  "system",
]);

/**
 * Resolve `system` to a concrete theme via `prefers-color-scheme`.
 * Cyberpunk is the dark theme, modern is the light theme, so the OS
 * preference maps cleanly. Defaults to cyberpunk during SSR / when
 * `matchMedia` isn't available.
 */
function resolveSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "cyberpunk";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "cyberpunk" : "modern";
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
    if (raw && VALID_THEMES.has(raw as Theme)) return raw as Theme;
  } catch {
    // ignore
  }
  return DEFAULT_THEME;
}
