"use client";

import type { MachineStrip as Strip } from "@/lib/home";
import type { ComputeDevice } from "@/lib/types";
import { MemoryUsage } from "@/components/MemoryUsage";

/**
 * Separate device readings preserve multi-card and shared-memory semantics;
 * adding their capacities would imply a single pool a model could use.
 */
export function MachineStrip({
  strip,
  devices = [],
  memoryStale = false,
}: {
  strip: Strip;
  devices?: ComputeDevice[];
  memoryStale?: boolean;
}) {
  const gpus = devices.filter((device) => device.kind !== "cpu");
  const memoryDevices = gpus.length ? gpus : devices.filter((device) => device.kind === "cpu");
  return (
    <section data-testid="home-machine" className="section-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-ui text-base font-semibold">{strip.name}</h2>
        <p className="font-ui flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-[color:var(--muted)]">
          {/* Keyed by position as well as text: two identical cards in one
            box print two identical lines, and a key on the text alone
            gave React two children it could not tell apart. */}
          {memoryDevices.length === 0 &&
            strip.devices.map((line, index) => (
              <span key={`${index}:${line}`} className="tabular-nums">
                {line}
              </span>
            ))}
          {memoryDevices.length > 0 && gpus.length === 0 && <span>no GPU</span>}
          <span>{strip.engine}</span>
          <span>{strip.models}</span>
        </p>
      </div>
      {memoryDevices.length > 0 && (
        <div
          className={`mt-3 grid gap-4 border-t border-[color:var(--border)] pt-3 ${memoryDevices.length > 1 ? "sm:grid-cols-2" : ""}`}
        >
          {memoryDevices.map((device, index) => (
            <MemoryUsage key={`${device.kind}:${index}`} device={device} />
          ))}
        </div>
      )}
      {memoryStale && devices.length > 0 && (
        <p className="font-ui mt-3 text-xs text-[color:var(--muted)]" role="status">
          Machine did not answer; showing last reported memory.
        </p>
      )}
    </section>
  );
}
