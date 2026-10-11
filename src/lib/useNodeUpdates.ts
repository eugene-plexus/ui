"use client";

import { useMemo } from "react";
import { targetFor } from "./nodeBudget";
import type { NodeIdentity } from "./types";
import { useIssues } from "./useIssues";
import { versionDifference } from "./updates";

export interface NodeReading {
  name: string;
  target: string;
  identity: NodeIdentity | null;
  loaded: boolean;
}

/** Machines and Needs Attention subscribe to the very same reads. Speed
 * up the shared poll while an update is running; never start a second one. */
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
    difference: versionDifference(facts),
  };
}
