"use client";

/**
 * Wizard screen: One machine, or reachable from others.
 *
 * One screen per module since M9. Nothing here reads or writes the
 * install - a screen renders the draft and reports edits upwards, and
 * every write happens once, in `page.tsx`, when Start is pressed.
 */

import type { DeploymentMode } from "../draft";
import { Radio } from "../fields";

export function ScreenDeployment({
  value,
  onChange,
}: {
  value: DeploymentMode;
  onChange: (v: DeploymentMode) => void;
}) {
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Deployment</h2>
      <p className="mb-6 text-sm text-[color:var(--muted)]">
        Where do the parts of Eugene live? This determines whether the next screens ask for host
        addresses.
      </p>
      <Radio
        checked={value === "local"}
        onChange={() => onChange("local")}
        label="All on this machine (recommended)"
        description="Every component runs as a local process. The agent handles spawning and supervision; you won't need to think about ports."
      />
      <Radio
        checked={value === "networked"}
        onChange={() => onChange("networked")}
        label="Across a network"
        description="Some or all components run on other machines. You'll be asked for host:port for each one."
      />
    </section>
  );
}

/**
 * An external backend: something already serving that the agent does not
 * supervise - Ollama, LM Studio, a Claude or ChatGPT subscription, any
 * OpenAI-compatible URL.
 *
 * This screen was briefly removed on the reasoning that the agent declares a
 * companion inference-driver per runtime, so there was nothing to configure.
 * That is true of engines the agent *starts*. It is false of everything here:
 * an already-running Ollama has no runtime, so it never gets a companion, and
 * without this screen there was no way to reach one from setup at all.
 *
 * The version before that could only PATCH a driver that already existed, and
 * on a fresh install none did - so it warned and did nothing. This one
 * creates the component.
 */
