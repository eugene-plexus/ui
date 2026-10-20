/**
 * The context the console plans for (CX4): the Library's
 * `guidanceContextLength`, "Context to plan for" in Settings. Every fit
 * verdict is judged at it (Home's first model, Discover, the Library), and
 * Run on llama.cpp never starts a model below it. Read once per page load and
 * shared, so two screens never show two numbers.
 */
import { useEffect, useState } from "react";

import { api } from "./api";

/** The Library's own default, while its answer is on the way. */
export const DEFAULT_PLANNED_CONTEXT = 16384;

/** The one setting, on the Settings page. */
export const PLANNED_CONTEXT_HREF = "/config?sel=library#guidanceContextLength";

let known: number | null = null;
let asking: Promise<number | null> | null = null;

export async function readPlannedContext(): Promise<number | null> {
  if (known !== null) return known;
  asking ??= api
    .get<Record<string, unknown>>("library", "/v1/config")
    .then((config) => {
      const value = config.guidanceContextLength;
      known = typeof value === "number" && value > 0 ? value : null;
      return known;
    })
    .catch(() => null)
    .finally(() => {
      asking = null;
    });
  return asking;
}

/** The planned context, or null until the Library answers (or if it does not). */
export function usePlannedContext(): number | null {
  const [value, setValue] = useState<number | null>(known);
  useEffect(() => {
    let cancelled = false;
    void readPlannedContext().then((v) => {
      if (!cancelled && v !== null) setValue(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return value;
}

export function resetPlannedContextForTests(): void {
  known = null;
  asking = null;
}
