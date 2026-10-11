"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";

import { AppShell } from "@/components/AppShell";
import { LogsView } from "@/components/LogsView";
import { useTargetNode } from "@/lib/nodeBudget";
import { parseSelection } from "@/lib/resourceTree";

/**
 * Every machine's log, from whichever console is open (2026-09-27).
 *
 * `docker logs`, for the install. The tree decides the scope: the install
 * root is every machine on one timeline, a machine under Agents is that
 * machine alone. `?source=` opens on one source -- the Inference screen
 * links a stopped or crashed model straight to its engine's lines.
 * Each machine is read through `node:<name>`, and a machine that does not
 * answer says so in its own words rather than leaving a gap.
 */
export default function LogsPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const searchParams = useSearchParams();
  const selection = parseSelection(searchParams.get("sel"));
  const picker = useTargetNode();
  const oneMachine = selection?.type === "agent";
  const machines = useMemo(() => {
    if (!oneMachine) return picker.nodes;
    const found = picker.nodes.find((n) => (selection?.node ? n.name === selection.node : n.local));
    return found ? [found] : [];
  }, [oneMachine, picker.nodes, selection?.node]);
  return (
    <AppShell>
      <LogsView
        machines={machines}
        loaded={picker.loaded}
        everyMachine={!oneMachine}
        initialSource={searchParams.get("source")}
      />
    </AppShell>
  );
}
