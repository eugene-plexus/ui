"use client";

import { useCallback, useEffect, useRef, useState, type RefCallback } from "react";

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
  /** Put on the scroll container: `ref={scrollRef}`. */
  scrollRef: RefCallback<HTMLDivElement>;
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
  // **A callback ref, because the container comes and goes.** The chat
  // log renders an empty-state line with no container until the first
  // message, and again after New. With an object ref the listener effect
  // ran once, at mount, found nothing and never ran again -- so on every
  // conversation that started empty `isAtBottomRef` stayed true for good:
  // each streamed token pulled someone reading back up to the bottom, and
  // the jump button never appeared. Holding the element in state re-runs
  // the effect whenever a new one mounts.
  const elRef = useRef<HTMLDivElement | null>(null);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    elRef.current = node;
    setEl(node);
  }, []);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [el, threshold]);

  // We deliberately exclude `isAtBottom` from the dependency list — we want
  // to react to *content* changes, not to scroll-position changes. Use the
  // ref instead so we read the latest value without re-running.
  useEffect(() => {
    const node = elRef.current;
    if (!node) return;
    if (forceOnUpdate || isAtBottomRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [dependency, forceOnUpdate]);

  function scrollToBottom() {
    const node = elRef.current;
    if (!node) return;
    node.scrollTo({
      top: node.scrollHeight,
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }

  return { scrollRef, isAtBottom, scrollToBottom };
}
