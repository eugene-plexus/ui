"use client";

import { useCallback, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { FirstModelCard } from "@/components/home/FirstModelCard";
import { MachineStrip } from "@/components/home/MachineStrip";
import { ReachCard } from "@/components/home/ReachCard";
import { RunningCard } from "@/components/home/RunningCard";
import { TryItCard } from "@/components/home/TryItCard";
import { UseFromAppsCard } from "@/components/home/UseFromAppsCard";
import { api } from "@/lib/api";
import { PROXY, listModels } from "@/lib/completions";
import { guessGatewayBaseUrl } from "@/lib/diagnostic";
import { chatModels, firstModelState, machineStrip } from "@/lib/home";
import { type Sources, buildRows } from "@/lib/inferenceRows";
import { localTargetNode } from "@/lib/nodeBudget";
import type {
  ComponentList,
  ComponentPlacementList,
  DriversInfo,
  EngineList,
  LibraryModelList,
  ModelList,
  NodeIdentity,
  RoutingTableView,
  RuntimeList,
  RuntimePlacementList,
} from "@/lib/types";
import { usePolling } from "@/lib/usePolling";
import { useSetupGate } from "@/lib/useSetupGate";
import { useTasks } from "@/lib/useTasks";

/**
 * Home: the install root's landing page.
 *
 * **Design:** `specs/docs/design/hobbyist-ux.md` §6.1, built as slice S1.
 * Its §0.3 measured what a new person met here before: the playground,
 * with a disabled composer reading "Waiting…" and nothing saying what to
 * do about it. This page is task-shaped instead — this machine, then the
 * one thing to do next, then a model to try, then what is running — and
 * each card is present only while it applies (P8: every state has a next
 * step). The playground is at `/playground`, unchanged, as the install
 * root's second page.
 *
 * **Every source is soft.** This is the page a person lands on after
 * signing in, which restarts every supervised child, and the page they
 * open when something is wrong. A component that does not answer costs
 * its own line and nothing else: the strip says "unknown" for that piece,
 * the first-model card says the library did not answer, and the Running
 * card simply has fewer rows. No error banners on landing.
 *
 * Two pollers, on the playground's and Inference's cadences: the slow one
 * (15 s) reads what this machine has and what the gateway routes to; the
 * fast one (5 s) reads the inference join for the Running card. Both stop
 * while the tab is hidden. The tasks tray's own poll supplies the
 * downloads the first-model card shows.
 *
 * **Since S3:** when exactly one model is on disk, the first card runs it
 * in one click — the state a person is in the moment their first download
 * finishes — and the run's progress renders in the card and in the tray.
 *
 * **Since S4:** "Use it from your apps" — the address, a long-lived key
 * and the model id, with a recipe per app — appears as soon as the
 * gateway routes to something. §0.8 measured what it replaces: nothing.
 *
 * **Since S5:** "Reach it from other devices" — one switch, and three
 * honest lines about the three separate things that have to be true
 * before a phone can open this page. It sits below the apps card because
 * it is the answer to "it works here, why not there", which is a
 * question a person only has once the first two cards have worked.
 *
 * **Not here yet, by plan:** "Needs attention" (S7), and the recommended
 * model in the first card (S6).
 */

const SLOW_POLL_MS = 15000;
const FAST_POLL_MS = 5000;

export default function HomePage() {
  const gate = useSetupGate();
  const ready = gate === "ready";

  const [node, setNode] = useState<NodeIdentity | null>(null);
  const [engines, setEngines] = useState<EngineList | null>(null);
  const [library, setLibrary] = useState<LibraryModelList | null>(null);
  const [libraryFailed, setLibraryFailed] = useState(false);
  const [models, setModels] = useState<ModelList | null>(null);
  const [gatewayFailed, setGatewayFailed] = useState(false);
  const [sources, setSources] = useState<Sources | null>(null);
  // The local agent's component list, for the gateway's PORT — the only
  // part of its address that survives the trip to a browser reached
  // through the proxy. `guessGatewayBaseUrl` explains why.
  const [components, setComponents] = useState<ComponentList | null>(null);
  const { tasks } = useTasks();

  const loadSlow = useCallback(async () => {
    const [nodeResult, enginesResult, libraryResult, modelsResult, componentsResult] =
      await Promise.all([
        api.get<NodeIdentity>("agent", "/v1/node").catch(() => null),
        api.get<EngineList>("agent", "/v1/engines").catch(() => null),
        api.get<LibraryModelList>("library", "/v1/models").catch(() => null),
        listModels(PROXY).catch(() => null),
        api.get<ComponentList>("agent", "/v1/components").catch(() => null),
      ]);
    setNode(nodeResult);
    setEngines(enginesResult);
    if (componentsResult !== null) setComponents(componentsResult);
    // The last good answer is kept and the failure is flagged beside it,
    // so the card can say "did not answer" without the count flickering
    // to zero on one missed poll.
    if (libraryResult !== null) setLibrary(libraryResult);
    setLibraryFailed(libraryResult === null);
    if (modelsResult !== null) setModels(modelsResult);
    setGatewayFailed(modelsResult === null);
  }, []);

  // The Inference screen's four soft reads, for the Running card.
  const loadFast = useCallback(async () => {
    const [drivers, routing, placement, runtimes] = await Promise.all([
      api.get<DriversInfo>("gateway", "/v1/admin/drivers").catch(() => null),
      api.get<RoutingTableView>("gateway", "/v1/admin/routing").catch(() => null),
      api.get<ComponentPlacementList>("control", "/v1/components").catch(() => null),
      api.get<RuntimePlacementList>("control", "/v1/runtimes").catch(() => null),
    ]);
    const localRuntimes =
      runtimes === null
        ? await api.get<RuntimeList>("agent", "/v1/runtimes").catch(() => null)
        : null;
    setSources({ drivers, routing, placement, runtimes, localRuntimes });
  }, []);

  usePolling(loadSlow, SLOW_POLL_MS, ready);
  usePolling(loadFast, FAST_POLL_MS, ready);

  const chat = useMemo(() => chatModels(models), [models]);
  // Null until the gateway has answered once; a gateway that fails on the
  // first read counts as "routes to nothing", because waiting on it would
  // leave a person with models on disk looking at an empty page.
  const routable = models !== null ? chat.length : gatewayFailed ? 0 : null;
  const strip = useMemo(
    () => machineStrip({ node, engines, library, libraryFailed }),
    [node, engines, library, libraryFailed],
  );
  const state = useMemo(
    () => firstModelState({ library, libraryFailed, routable, engines }),
    [library, libraryFailed, routable, engines],
  );
  // Home is about the machine the browser is served from, so Run from
  // here runs here (S3). Another node is chosen on the Library's picker.
  const here = useMemo(() => localTargetNode(node), [node]);
  const rows = useMemo(
    () => (sources ? buildRows(sources, node?.name ?? null) : []),
    [sources, node],
  );
  const downloads = useMemo(() => tasks.filter((t) => t.kind === "download"), [tasks]);
  // The address a harness would use, guessed the same way the playground's
  // diagnostic panel guesses it — and, like there, labelled a guess and
  // correctable, because a container that publishes 8080 as 8280 makes it
  // wrong in exactly the way a harness handed the same numbers would be.
  const gatewayPortUrl = useMemo(
    () =>
      typeof window === "undefined" || components === null
        ? null
        : guessGatewayBaseUrl(
            (components.components ?? []).map((c) => ({
              kind: String(c.kind ?? ""),
              url: c.url ?? "",
              advertiseUrl: c.advertiseUrl ?? undefined,
            })),
            { protocol: window.location.protocol, hostname: window.location.hostname },
          ),
    [components],
  );

  if (gate === "checking") {
    return (
      <main className="relative z-10 flex h-screen items-center justify-center">
        <p className="font-ui text-xs text-[color:var(--muted)]">Checking setup state…</p>
      </main>
    );
  }

  return (
    <AppShell>
      <main data-testid="home" className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
          <MachineStrip strip={strip} />
          <FirstModelCard state={state} downloads={downloads} node={here} />
          {chat.length > 0 && <TryItCard models={chat} />}
          {chat.length > 0 && (
            <UseFromAppsCard
              models={chat}
              gatewayPortUrl={gatewayPortUrl}
              placement={sources?.placement ?? null}
              localNode={node?.name ?? null}
            />
          )}
          <ReachCard reach={node?.reach ?? null} onChanged={() => void loadSlow()} />
          <RunningCard rows={rows} />
        </div>
      </main>
    </AppShell>
  );
}
