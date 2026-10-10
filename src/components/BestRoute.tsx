"use client";

import { useState } from "react";

import { type BetterRoute, betterRouteWhy } from "@/lib/eligibility";
import { engineName } from "@/lib/issues";

/**
 * Run's question when preparing suits this machine better (LS9, Troy's B54
 * change): two routes, the recommended one chosen. *Prepare* hands the page
 * the preparing engine's control (its context, its disk, then it starts like
 * Run); *Run now* hands it the as-is engine's Run. Asked, never silent: the
 * person sees both and can take the other.
 */
export function BestRoute({
  route,
  prepare,
  runNow,
}: {
  route: BetterRoute;
  /** The preparing engine's control. */
  prepare: React.ReactNode;
  /** Run with the engine that runs it as it is. */
  runNow: React.ReactNode;
}) {
  const [choice, setChoice] = useState<"prepare" | "now">("prepare");
  const prepared = engineName(route.prepare.engine);
  const asIs = engineName(route.asIs.engine);
  return (
    <section data-testid="best-route" className="flex flex-col gap-2 text-sm">
      <p className="font-ui font-semibold">
        Best on this machine: prepare for {prepared}, then run
      </p>
      <p className="text-[color:var(--muted)]">{betterRouteWhy(route, engineName)}</p>
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">How to run it</legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="route"
            checked={choice === "prepare"}
            onChange={() => setChoice("prepare")}
            className="mt-1"
          />
          <span>
            Prepare for {prepared}, then run{" "}
            <span className="text-status-success">(recommended)</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="route"
            checked={choice === "now"}
            onChange={() => setChoice("now")}
            className="mt-1"
          />
          <span>
            Run now with {asIs}
            {route.asIs.fit?.verdict === "no"
              ? ": it does not fit here, so it may not start"
              : ": part of the model runs from system memory, slower"}
          </span>
        </label>
      </fieldset>
      <div data-testid={choice === "prepare" ? "best-route-prepare" : "best-route-now"}>
        {choice === "prepare" ? prepare : runNow}
      </div>
    </section>
  );
}
