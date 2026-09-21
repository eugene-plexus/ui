"use client";

import type { MachineStrip as Strip } from "@/lib/home";

/**
 * The strip across the top of Home: this machine, in one line.
 *
 * Name, card(s) with total and free memory, engine, models on disk — the
 * four facts a person needs before any decision on the page below, each
 * from its own source and each saying "unknown" on its own when that
 * source did not answer. `lib/home.ts` writes the words; this lays them
 * out and wraps them at phone width.
 */
export function MachineStrip({ strip }: { strip: Strip }) {
  return (
    <section
      data-testid="home-machine"
      className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3"
    >
      <h2 className="font-ui text-sm font-semibold">{strip.name}</h2>
      <p className="font-ui mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-[color:var(--muted)]">
        {strip.devices.map((line) => (
          <span key={line} className="tabular-nums">
            {line}
          </span>
        ))}
        <span>{strip.engine}</span>
        <span>{strip.models}</span>
      </p>
    </section>
  );
}
