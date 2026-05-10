"use client";

import { useEffect, useState } from "react";

export type FontSize = "small" | "default" | "large" | "xlarge";

const STORAGE_KEY = "eugene-font-size";
const DEFAULT_FONT_SIZE: FontSize = "default";
const VALID: ReadonlySet<FontSize> = new Set(["small", "default", "large", "xlarge"]);

/**
 * Maps the named size to a root font-size in pixels. All Tailwind text
 * utilities are rem-based in v4, so changing the root size scales every
 * `text-sm`, `text-base`, etc. proportionally. Tiny chrome labels that
 * use absolute pixel values (e.g. `text-[10px]`) intentionally stay
 * fixed — they're reference-sized chrome, not content.
 */
const PX: Record<FontSize, string> = {
  small: "14px",
  default: "16px",
  large: "18px",
  xlarge: "20px",
};

export const FONT_SIZE_LABELS: Record<FontSize, string> = {
  small: "Small",
  default: "Default",
  large: "Large",
  xlarge: "Extra Large",
};

export function useFontSize(): readonly [FontSize, (next: FontSize) => void] {
  const [size, setSizeState] = useState<FontSize>(DEFAULT_FONT_SIZE);

  useEffect(() => {
    const stored = readStored();
    setSizeState(stored);
    document.documentElement.style.fontSize = PX[stored];
  }, []);

  function setSize(next: FontSize): void {
    setSizeState(next);
    document.documentElement.style.fontSize = PX[next];
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }

  return [size, setSize] as const;
}

function readStored(): FontSize {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && VALID.has(raw as FontSize)) return raw as FontSize;
  } catch {
    // ignore
  }
  return DEFAULT_FONT_SIZE;
}
