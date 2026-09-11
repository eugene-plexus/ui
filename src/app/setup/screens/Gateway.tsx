"use client";

/**
 * Wizard screen: Where the OpenAI-compatible endpoint listens.
 *
 * One screen per module since M9. Nothing here reads or writes the
 * install - a screen renders the draft and reports edits upwards, and
 * every write happens once, in `page.tsx`, when Start is pressed.
 */

import type { DeploymentMode } from "../draft";
import { HostPortRow } from "../fields";

export function ScreenGateway({
  mode,
  host,
  port,
  onChange,
}: {
  mode: DeploymentMode;
  host: string;
  port: number;
  onChange: (host: string, port: number) => void;
}) {
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Gateway</h2>
      <p className="mb-6 text-sm leading-relaxed text-[color:var(--muted)]">
        The gateway is the address you point a client at — anything that speaks the OpenAI API works
        unmodified. It resolves a model name to whichever driver serves it and falls back to another
        when one dies. Nothing to configure here beyond where it listens; defaults for temperature
        and token limits are on the Config page.
      </p>
      {mode === "networked" && <HostPortRow host={host} port={port} onChange={onChange} />}
    </section>
  );
}

/**
 * Where the operator's models already live.
 *
 * This replaced a Driver screen. A driver fronts exactly one backend, and
 * since M6 the agent declares one per runtime automatically - so at first-run
 * time there is no driver to configure and no way to make one, which is
 * exactly what the old screen kept asking about.
 *
 * What genuinely cannot be guessed is where the operator keeps their models.
 * Nothing here moves, renames or copies a file: the library scans these
 * directories in place. Delete us and the models are still there, correctly
 * named, where they were put.
 */
