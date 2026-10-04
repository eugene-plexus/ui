"use client";

/**
 * Every machine's own answer to "what do you run, and is there newer",
 * read through `node:<name>` the way every other per-node read is, so one
 * console sees and updates them all (Troy: update Amish_Station from the
 * NAS's page).
 *
 * Every 15 s, and every 3 s while one of them is updating, because an
 * update restarts that machine's Eugene and the page should notice it is
 * back without anyone reloading.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";
import { targetFor } from "./nodeBudget";
import type { NodeIdentity } from "./types";
import { usePolling } from "./usePolling";
import { refreshIssues } from "./useIssues";

export interface NodeReading {
  name: string;
  /** The proxy target that reaches this machine's agent. */
  target: string;
  identity: NodeIdentity | null;
  /** Whether a read has come back at all yet, answered or not. */
  loaded: boolean;
}

const EVERY_MS = 15_000;
const WHILE_UPDATING_MS = 3_000;

export function useNodeUpdates(names: string[] | null, updating: boolean) {
  const [localName, setLocalName] = useState<string | null | undefined>(undefined);
  const [readings, setReadings] = useState<Record<string, NodeReading>>({});
  const previousVersions = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<NodeIdentity>("agent", "/v1/node")
      .then((me) => !cancelled && setLocalName(me.name ?? null))
      .catch(() => !cancelled && setLocalName(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const read = useCallback(async () => {
    if (!names || localName === undefined) return;
    const results = await Promise.all(
      names.map(async (name): Promise<NodeReading> => {
        const target = targetFor(name, localName);
        try {
          return {
            name,
            target,
            identity: await api.get<NodeIdentity>(target, "/v1/node"),
            loaded: true,
          };
        } catch {
          // Down, or restarting after an update: not an error to show here,
          // the card says the machine did not answer.
          return { name, target, identity: null, loaded: true };
        }
      }),
    );
    setReadings(Object.fromEntries(results.map((r) => [r.name, r])));
    const versions = JSON.stringify(
      results.map((r) => [
        r.name,
        r.identity?.install,
        r.identity?.update?.available,
        r.identity?.update?.last,
        r.identity?.update?.running,
      ]),
    );
    if (previousVersions.current !== null && previousVersions.current !== versions)
      void refreshIssues();
    previousVersions.current = versions;
  }, [names, localName]);

  usePolling(
    read,
    updating ? WHILE_UPDATING_MS : EVERY_MS,
    names !== null && localName !== undefined,
  );

  return { readings, refresh: read, localName };
}
