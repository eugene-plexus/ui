"use client";

/**
 * Discover's two questions (library-sources-and-engines.md, LS2): which
 * engines the picked node has, and what the Library judges of models not
 * downloaded yet, by the facts its catalogue answers carry.
 */

import { useEffect, useMemo, useState } from "react";

import { ApiError, api, describeError } from "./api";
import {
  eligibilityEngines,
  type EligibilityCandidate,
  type EligibilityList,
  type ModelEligibility,
} from "./eligibility";
import type { EngineDescriptor, EngineList } from "./types";

/** The picked node's engines as its own agent reports them; null while
 * asked, and the previous node's are never shown as this one's. */
export function useNodeEngines(target: string | null): {
  engines: EngineDescriptor[] | null;
  error: string | null;
} {
  const [engines, setEngines] = useState<EngineDescriptor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEngines(null);
    setError(null);
    if (target === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.get<EngineList>(target, "/v1/engines");
        if (!cancelled) setEngines(list.engines ?? []);
      } catch (err) {
        if (cancelled || (err instanceof ApiError && err.status === 401)) return;
        setError(describeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);
  return { engines, error };
}

/**
 * The Library's verdicts on `candidates`, by their ids. `older` when the
 * Library predates candidates (404 before LS1, 422 before LS2): the page
 * then shows no dots rather than a guess of its own.
 */
export function useCandidateEligibility(
  engines: EngineDescriptor[] | null,
  candidates: EligibilityCandidate[],
): { byId: Map<string, ModelEligibility> | null; older: boolean } {
  const [byId, setById] = useState<Map<string, ModelEligibility> | null>(null);
  const [older, setOlder] = useState(false);
  // Keyed by content: a parent re-rendering with an equal list must not
  // ask again, and a different list must never show the last one's dots.
  const key = useMemo(() => JSON.stringify(candidates), [candidates]);
  useEffect(() => {
    setById(null);
    setOlder(false);
    const asked = JSON.parse(key) as EligibilityCandidate[];
    if (engines === null || asked.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const judged = await api.post<EligibilityList>("library", "/v1/eligibility", {
          candidates: asked,
          engines: eligibilityEngines(engines),
        });
        if (!cancelled) setById(new Map(judged.models.map((m) => [m.modelId, m])));
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 422)) setOlder(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engines, key]);
  return { byId, older };
}
