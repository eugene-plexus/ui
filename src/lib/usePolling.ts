"use client";

import { useEffect } from "react";

/**
 * Run something now and then every `intervalMs`, while the tab is visible.
 *
 * Every dashboard screen here polls rather than subscribes — a status
 * changes on a component's own cadence, so there is nothing for a push
 * channel to deliver sooner, and a socket that reconnects is one that
 * can silently stop. What none of them did was stop when nobody was
 * looking: a Home tab left open behind a game kept five endpoints busy
 * every few seconds for nothing. A hidden tab skips its ticks and runs
 * once, immediately, when it is shown again, so what the person sees on
 * return is current rather than up to one interval stale.
 *
 * `run` should be stable (`useCallback`) or the interval restarts on
 * every render. `enabled: false` runs nothing, which is how a page waits
 * for its sign-in gate.
 */
export function usePolling(
  run: () => void | Promise<void>,
  intervalMs: number,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void run();
    };
    tick();
    const id = setInterval(tick, intervalMs);
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [run, intervalMs, enabled]);
}
