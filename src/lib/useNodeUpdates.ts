"use client";

import { useMemo } from "react";
import { targetFor } from "./nodeBudget";
import { unexplainedVersionDifference } from "./issues";
import type { NodeIdentity } from "./types";
import { useIssues } from "./useIssues";

export interface NodeReading {
  name: string;
  target: string;
  identity: NodeIdentity | null;
  loaded: boolean;
}

/** Machines and Needs Attention subscribe to the very same reads. Speed
 * up the shared poll while an update is running; never start a second one.
 *
 * `difference` is the one nothing else explains: while a machine has an
 * update on offer, or is running one, that is what Machines says about it,
 * on its card. */
export function useNodeUpdates(names: string[] | null, updating: boolean) {
  const { facts, loaded, reload, checkingUpdates } = useIssues(
    names === null ? 30_000 : updating ? 3_000 : 15_000,
  );
  const localName = facts.find((node) => node.local)?.name ?? null;
  const readings = useMemo(
    () =>
      Object.fromEntries(
        (names ?? []).map((name) => {
          const node = facts.find((item) => item.name === name);
          const reading: NodeReading = {
            name,
            target: targetFor(name, localName),
            identity: node?.identity ?? null,
            loaded,
          };
          return [name, reading];
        }),
      ),
    [names, facts, loaded, localName],
  );
  return {
    readings,
    refresh: reload,
    localName,
    checkingUpdates,
    difference: unexplainedVersionDifference(facts),
  };
}
