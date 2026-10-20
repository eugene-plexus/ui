"use client";

import { useState } from "react";

import { ConfirmButton } from "@/components/ConfirmButton";
import { api, describeError } from "@/lib/api";
import { nodeLabel } from "@/lib/nodeLabels";

/** The facts about one machine that change what removing it does. */
export interface RemovalFacts {
  name: string;
  label?: string | null;
  reachable: boolean;
  standby: boolean;
  /** Owners of the job sites it hosts, by name. */
  siteOwners: readonly string[];
}

/**
 * What the confirm says, one sentence each (CX6). The first two always:
 * the key is revoked, and the way back is to join again. The rest only
 * when they are true of this machine.
 */
export function removalWarnings(facts: RemovalFacts): string[] {
  const out = [
    "Its key is revoked now, so the other machines stop trusting it.",
    "To come back, it must join again with a new token.",
  ];
  if (facts.reachable)
    out.push(
      "It is running now. Its programs keep running on it, but this install stops sending it work.",
    );
  if (facts.standby)
    out.push(
      "It is the standby. The install has no standby until you choose another; " +
        "the machine deletes its copy of the install's records when it next checks in.",
    );
  for (const owner of facts.siteOwners)
    out.push(`It hosts ${owner}'s job site. The job site stays; remove it on Job Sites.`);
  out.push("Model files on its disk stay there.");
  return out;
}

/**
 * "Remove from install" on a Machines row (CX6): `DELETE /v1/nodes/{name}`
 * at the root, asked first.
 *
 * Offered on every machine except the root's own, and more plainly on one
 * that is down: a sold or rebuilt box is the usual reason. The root also
 * refuses its own machine and the last running gateway (409); its words
 * are shown as they come.
 */
export function RemoveMachine({
  facts,
  onRemoved,
}: {
  facts: RemovalFacts;
  onRemoved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const shown = nodeLabel(facts);
  const remove = async () => {
    setError(null);
    try {
      await api.delete("control", `/v1/nodes/${encodeURIComponent(facts.name)}`);
      onRemoved();
    } catch (e) {
      setError(describeError(e));
    }
  };
  return (
    <div className="mt-1" data-testid={`remove-machine-${facts.name}`}>
      <ConfirmButton
        label="Remove from install"
        confirmLabel="Remove and revoke its key"
        ariaLabel={`Remove ${shown} from install`}
        prompt={
          <span data-testid="remove-machine-prompt">
            Remove {shown}? {removalWarnings(facts).join(" ")}
          </span>
        }
        onConfirm={remove}
        className={
          facts.reachable
            ? "text-[0.6875rem] text-[color:var(--muted)] underline"
            : "rounded border border-[color:var(--border)] px-2 py-0.5 text-sm"
        }
        confirmClassName="text-status-error"
      />
      {error && (
        <p role="alert" className="text-status-error mt-1 max-w-md text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
