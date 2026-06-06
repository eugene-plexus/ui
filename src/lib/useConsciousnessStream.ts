"use client";

import { useEffect, useRef, useState } from "react";

import {
  subscribeConsciousness,
  type ConnectionStatus,
  type ConsciousnessSubscription,
} from "./stream";
import type { ConsciousnessEvent } from "./types";

/**
 * Subscribe to Eugene's consciousness stream for the lifetime of a
 * component. Opens once when `enabled` flips true and closes on unmount /
 * when `enabled` flips false — it does NOT re-subscribe when `onEvent`
 * changes identity (the callback is read through a ref), so the page can
 * pass an inline handler without thrashing the connection.
 *
 * Returns the live connection status for a UI indicator.
 */
export function useConsciousnessStream(
  enabled: boolean,
  onEvent: (event: ConsciousnessEvent) => void,
): { status: ConnectionStatus } {
  const [status, setStatus] = useState<ConnectionStatus>("closed");

  // Keep the latest handler in a ref so re-renders don't tear down and
  // rebuild the stream (which would drop in-flight thoughts).
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!enabled) {
      setStatus("closed");
      return;
    }
    let sub: ConsciousnessSubscription | null = null;
    sub = subscribeConsciousness({
      onEvent: (e) => handlerRef.current(e),
      onStatus: setStatus,
    });
    return () => {
      sub?.close();
    };
  }, [enabled]);

  return { status };
}
