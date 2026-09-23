"use client";

import { useId } from "react";
import Link from "next/link";

import type { ClientKeyLimits } from "@/lib/types";

export const DEFAULT_CLIENT_LIMITS: ClientKeyLimits = {
  localOnly: false,
  allowedModels: null,
  maxConcurrentRequests: 2,
  requestsPerMinute: 60,
};

export function ClientKeyLimitsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: ClientKeyLimits;
  onChange: (value: ClientKeyLimits) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const selected = value.allowedModels != null;
  const field =
    "rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1";
  return (
    <fieldset disabled={disabled} className="font-ui basis-full space-y-2 text-sm">
      <legend className="mb-2 font-semibold">Key permissions and limits</legend>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.localOnly === true}
          onChange={(e) => onChange({ ...value, localOnly: e.target.checked })}
        />
        Local-only inference: never fall back to cloud or unconfirmed endpoints
      </label>
      <p className="text-[color:var(--muted)]">
        Models Eugene runs locally qualify automatically. For other local servers, confirm Endpoint
        trust in the driver’s Provider settings. Cloud subscriptions remain external.{" "}
        <Link href="/inference/" className="underline">
          Find the driver
        </Link>
        .
      </p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={!selected}
          onChange={(e) => onChange({ ...value, allowedModels: e.target.checked ? null : [] })}
        />
        Allow all models, including models added later
      </label>
      {selected && (
        <label className="block" htmlFor={`${id}-models`}>
          Allowed model IDs (one per line)
          <textarea
            id={`${id}-models`}
            className={`${field} mt-1 block w-full font-mono`}
            rows={3}
            value={(value.allowedModels ?? []).join("\n")}
            onChange={(e) => onChange({ ...value, allowedModels: e.target.value.split("\n") })}
          />
          <span className="block text-[color:var(--muted)]">
            Use exact IDs from Models. For an alias, allow both its name and each target it may use.
            Leave empty to deny every model.
          </span>
        </label>
      )}
      <div className="flex flex-wrap gap-3">
        <label>
          Concurrent requests{" "}
          <input
            aria-label="Concurrent requests"
            className={`${field} w-20`}
            type="number"
            min={1}
            max={64}
            required
            value={value.maxConcurrentRequests ?? 2}
            onChange={(e) => onChange({ ...value, maxConcurrentRequests: Number(e.target.value) })}
          />
        </label>
        <label>
          Requests per minute{" "}
          <input
            aria-label="Requests per minute"
            className={`${field} w-24`}
            type="number"
            min={1}
            max={10000}
            required
            value={value.requestsPerMinute ?? 60}
            onChange={(e) => onChange({ ...value, requestsPerMinute: Number(e.target.value) })}
          />
        </label>
      </div>
      <p className="text-[color:var(--muted)]">
        Shared across gateways. Waking and streaming count as active requests. Accepted requests
        count toward the rolling minute even if cancelled or failed.
      </p>
    </fieldset>
  );
}

export function cleanClientLimits(value: ClientKeyLimits): ClientKeyLimits {
  return {
    ...value,
    allowedModels:
      value.allowedModels == null
        ? null
        : [...new Set(value.allowedModels.map((s) => s.trim()).filter(Boolean))],
  };
}

export function describeClientLimits(value?: ClientKeyLimits | null): string {
  if (!value) return "Legacy / unrestricted: all models, no per-key limits";
  const models =
    value.allowedModels == null
      ? "All models"
      : value.allowedModels.length === 0
        ? "No models allowed"
        : value.allowedModels.join(", ");
  return `${models}${value.localOnly ? " · Local-only" : ""} · ${value.maxConcurrentRequests ?? 2} concurrent · ${value.requestsPerMinute ?? 60}/minute`;
}
