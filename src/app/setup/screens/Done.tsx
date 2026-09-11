"use client";

/**
 * Wizard screen: The summary, and the Start button.
 *
 * One screen per module since M9. Nothing here reads or writes the
 * install - a screen renders the draft and reports edits upwards, and
 * every write happens once, in `page.tsx`, when Start is pressed.
 *
 * Since the cut to five screens this also absorbs what the Gateway screen
 * used to say. The difference is that the gateway row is now **read from
 * the topology** rather than echoed back from the draft: the old screen
 * collected a host and port that Start never wrote anywhere, so the
 * summary confidently reported an address the install did not use. When
 * the topology is not an answer yet - an unauthenticated read on an
 * install with no passphrase 401s - the row says so rather than guessing.
 */

import { providerLabel } from "@/lib/agent";
import type { Component } from "@/lib/types";

import { requiredKindsMissing, type WizardDraft } from "../draft";

export function ScreenDone({
  draft,
  knownComponents,
  topologyKnown,
  starting,
  startMessage,
  startError,
}: {
  draft: WizardDraft;
  knownComponents: Component[];
  topologyKnown: boolean;
  starting: boolean;
  startMessage: string | null;
  startError: string | null;
}) {
  const gateway = knownComponents.find((c) => c.kind === "gateway");
  const summary: { label: string; value: string }[] = [
    {
      label: "Gateway",
      value: gateway
        ? (gateway.advertiseUrl ?? gateway.url)
        : topologyKnown
          ? "not declared on this node"
          : "declared by the agent on first boot",
    },
    {
      label: "Model directories",
      value:
        draft.modelRoots.filter((r) => r.trim()).join(", ") ||
        "none yet — add them from Config, or use Discover",
    },
    {
      label: "Backend",
      value: draft.backend.provider
        ? providerLabel(draft.backend.provider) +
          (draft.backend.modelId ? ` · ${draft.backend.modelId}` : "")
        : "none yet — add one from Config",
    },
    {
      label: "Security",
      value:
        draft.securityMode === "os_keyring"
          ? "master key in the OS keyring (auto-unlock)"
          : "passphrase prompt on startup",
    },
  ];

  // The agent declares these itself on a first boot. If one is missing, its
  // package is missing from the agent's environment - a real error, not a
  // step the operator forgot.
  // Only when the list is an answer. Unauthenticated, it is not one, and the
  // real check happens at Start with a token - see requiredKindsMissing.
  const missingKinds = topologyKnown ? requiredKindsMissing(knownComponents) : [];

  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Ready</h2>
      <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
        Start writes all of this at once. Nothing has been saved yet.
      </p>
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-3 text-sm">
        {summary.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-[color:var(--muted)]">{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <MissingTopologyHints missingKinds={missingKinds} />
      <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
        The gateway address above is what you point a client at &mdash; anything that speaks the
        OpenAI API works unmodified. It resolves a model name to whichever driver serves it and
        falls back to another when one dies, so there is no routing table to maintain by hand.
      </p>
      <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
        Afterwards: the Runtimes page is where you start an engine and confirm it reached{" "}
        <span className="font-mono">ready</span>, the playground picks up any model the gateway can
        route to, and Config holds everything this wizard did not ask about &mdash; theme, font
        size, generation defaults. To add a second machine, mint a join token on the Nodes page and
        run <span className="font-mono">eugene-plexus-agent join</span> over there; a worker is
        never onboarded through a browser.
      </p>
      {starting && startMessage && (
        <p className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs text-[color:var(--muted)]">
          {startMessage}
        </p>
      )}
      {startError && (
        <p className="status-error rounded-[var(--radius)] border px-3 py-2 text-xs">
          {startError}
        </p>
      )}
    </section>
  );
}

/**
 * Every install has one control root, one gateway and one library, and the
 * agent declares them itself on its first boot. So a missing one is not a
 * step the operator skipped - it means that component's package is missing
 * from the agent's environment, and no amount of clicking here will fix it.
 *
 * This used to warn that no inference-driver existed and let Start proceed
 * anyway, which is how a first run could report success against an install
 * with nothing in it. Drivers are companions of runtimes now; there is
 * nothing to warn about before a model is launched.
 */
export function MissingTopologyHints({ missingKinds }: { missingKinds: readonly string[] }) {
  if (missingKinds.length === 0) return null;
  return (
    <div className="status-warn mb-4 rounded-[var(--radius)] border px-3 py-2 text-xs">
      <p className="mb-1 font-medium">Missing from this node: {missingKinds.join(", ")}</p>
      <p>
        The agent declares these on a first boot, so this means their packages are not installed in
        the agent&rsquo;s environment. Install them there and restart the agent &mdash;{" "}
        <span className="font-mono">bootstrap.ps1</span> does this for every component.
      </p>
    </div>
  );
}
