"use client";

import { formatBytes } from "@/components/FitBadge";
import type { ComputeDevice } from "@/lib/types";

export function MemoryUsage({ device }: { device: ComputeDevice }) {
  const name = device.kind === "cpu" ? "System memory" : (device.name ?? device.kind);
  const total = device.memoryTotalBytes;
  const free = device.memoryFreeBytes;
  // A capacity without a free reading cannot tell us how full the device is.
  const measured =
    typeof total === "number" &&
    Number.isFinite(total) &&
    total > 0 &&
    typeof free === "number" &&
    Number.isFinite(free) &&
    free >= 0 &&
    free <= total;
  const used = measured ? total - free : null;
  const percent = measured ? (used! / total) * 100 : null;
  const detail = measured
    ? `${formatBytes(free)} free of ${formatBytes(total)}`
    : typeof total === "number" && Number.isFinite(total) && total > 0
      ? `${formatBytes(total)} capacity · usage unavailable`
      : typeof free === "number" && Number.isFinite(free) && free >= 0
        ? `${formatBytes(free)} free · capacity and usage unavailable`
        : "Memory usage unavailable";

  return (
    <div className="min-w-0 space-y-2">
      <div className="font-ui flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className="min-w-0 font-medium break-words">{name}</span>
        {percent !== null && (
          <span className="text-xs text-[color:var(--muted)] tabular-nums">
            {Math.round(percent)}% used
          </span>
        )}
      </div>
      {percent !== null ? (
        <div
          role="meter"
          aria-label={`${name} memory used`}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={used!}
          aria-valuetext={`${formatBytes(used!)} used; ${detail}${device.sharedMemory ? "; shared with system memory" : ""}`}
          className="h-2.5 overflow-hidden rounded-full border border-[color:var(--border)] bg-[color:var(--panel-soft)]"
        >
          <div className="h-full bg-[color:var(--accent-left)]" style={{ width: `${percent}%` }} />
        </div>
      ) : (
        <div
          aria-hidden
          className="visual-hatch h-2.5 rounded-full border border-dashed border-[color:var(--border)] text-[color:var(--border)]"
        />
      )}
      <p className="font-ui text-xs text-[color:var(--muted)] tabular-nums">{detail}</p>
      {device.sharedMemory && (
        <p className="font-ui text-xs text-[color:var(--muted)]">Shared with system memory</p>
      )}
    </div>
  );
}
