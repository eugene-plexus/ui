"use client";

import { useId } from "react";
import Link from "next/link";

import type { ClientKeyLimits } from "@/lib/types";

export const DEFAULT_CLIENT_LIMITS: ClientKeyLimits = {
  localOnly: false,
  allowedModels: null,
  allowedTools: null,
  writeLogs: false,
  maxConcurrentRequests: 2,
  requestsPerMinute: 60,
};

/** Whether a key may have the hub search the web for it: `allowedTools`
 * null permits every tool, a list permits what it names (patterns with `*`),
 * and a local-only key never searches. The checkbox used to be on only for
 * null, so a key allowed exactly `["web_search"]` read as not allowed
 * (settings never lie, 2026-09-30). */
export function mayWebSearch(value: ClientKeyLimits): boolean {
  if (value.localOnly === true) return false;
  if (value.allowedTools == null) return true;
  return value.allowedTools.some((t) => toolPattern(t).test("web_search"));
}

function toolPattern(entry: string): RegExp {
  const escaped = entry
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

/** A number box that can be empty: empty is the field's default, said as
 * such, rather than a 0 (`Number("")`) that the server refuses. */
function whole(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

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
      {/* P8: web search is on for a key unless it is turned off here (design
          call #5). A local-only key never searches whatever this says. */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={mayWebSearch(value)}
          disabled={value.localOnly === true}
          onChange={(e) =>
            onChange({
              ...value,
              allowedTools: e.target.checked
                ? null
                : (value.allowedTools ?? []).filter((t) => !toolPattern(t).test("web_search")),
            })
          }
          data-testid="key-web-search"
        />
        Let apps using this key search the web
      </label>
      <p className="text-[color:var(--muted)]">
        When a model is asked to search, Eugene runs the search on your search account and sends the
        words searched for to the internet.{" "}
        {value.localOnly === true
          ? "A local-only key never searches."
          : "Turn this off to keep a key's prompts on this network."}
      </p>
      {/* C1: the agent's log ingress takes lines only from a key with this
          on. Every app Eugene installs gets it; any other key, on request. */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.writeLogs === true}
          onChange={(e) => onChange({ ...value, writeLogs: e.target.checked })}
          data-testid="key-write-logs"
        />
        Let apps using this key send their logs to Eugene
      </label>
      <p className="text-[color:var(--muted)]">
        What they send appears on the Logs page under the key&rsquo;s name. It lets them write logs
        and nothing else: reading the logs still needs you.
      </p>
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
            Use exact IDs from Models, or a pattern: <span className="font-mono">openrouter/*</span>{" "}
            allows every model of the connection named openrouter (
            <span className="font-mono">*</span> matches anything). For an alias, allow both its
            name and each target it may use. Leave empty to deny every model.
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
            value={value.maxConcurrentRequests ?? ""}
            placeholder="2 (default)"
            onChange={(e) =>
              onChange({ ...value, maxConcurrentRequests: whole(e.target.value) as number })
            }
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
            value={value.requestsPerMinute ?? ""}
            placeholder="60 (default)"
            onChange={(e) =>
              onChange({ ...value, requestsPerMinute: whole(e.target.value) as number })
            }
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
  const search = mayWebSearch(value) ? "" : " · No web search";
  const logs = value.writeLogs ? " · Sends logs" : "";
  return `${models}${value.localOnly ? " · Local-only" : ""}${search}${logs} · ${value.maxConcurrentRequests ?? 2} concurrent · ${value.requestsPerMinute ?? 60}/minute`;
}
