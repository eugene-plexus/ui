"use client";

import { useEffect, useMemo, useState } from "react";

import { PROXY, listModels } from "./completions";
import { contextLookup, type ContextLookup } from "./modelContext";
import type { ModelList } from "./types";

const REFRESH_MS = 15_000;

/**
 * The context window of every model the gateway serves, for a screen that
 * names models and does not otherwise read `GET /v1/models` (Inference,
 * Routing, Metrics). Read on mount and again every `REFRESH_MS`, the
 * gateway's own routing refresh, so a model that starts serving while the
 * page is open gains its window. Soft: a gateway that does not answer
 * keeps the last list, or leaves every name bare, and never breaks the page.
 */
export function useServedContexts(): ContextLookup {
  const [list, setList] = useState<ModelList | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      listModels(PROXY)
        .then((l) => {
          if (live) setList(l);
        })
        .catch(() => {});
    void read();
    const timer = setInterval(read, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return useMemo(() => contextLookup(list), [list]);
}
