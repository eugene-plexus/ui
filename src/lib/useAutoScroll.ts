"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export interface AutoScrollOptions {
  /**
   * When `true`, every dependency change scrolls to the bottom regardless
   * of where the user has scrolled to. When `false` (default), only
   * auto-scroll if the user was already near the bottom — the
   * conventional "sticky bottom" behaviour.
   */
  forceOnUpdate?: boolean;
  /**
   * Pixels from the bottom that count as "at bottom" for sticky-scroll
   * purposes. Generous-ish so a scroll to within a couple of lines of
   * the bottom still pins.
   */
  threshold?: number;
}

export interface AutoScroll {
  scrollRef: RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  scrollToBottom: () => void;
}

/**
 * Drive a scroll container so that:
 *   - It re-pins to the bottom when `dependency` changes (always for
 *     `forceOnUpdate`, sticky-bottom otherwise).
 *   - `isAtBottom` reflects whether the user is currently near the
 *     bottom — UI uses it to show / hide a "jump to bottom" button.
 */
export function useAutoScroll(
  dependency: unknown,
  { forceOnUpdate = false, threshold = 32 }: AutoScrollOptions = {},
): AutoScroll {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [threshold]);

  // We deliberately exclude `isAtBottom` from the dependency list — we want
  // to react to *content* changes, not to scroll-position changes. Use the
  // ref instead so we read the latest value without re-running.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (forceOnUpdate || isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [dependency, forceOnUpdate]);

  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  return { scrollRef, isAtBottom, scrollToBottom };
}
