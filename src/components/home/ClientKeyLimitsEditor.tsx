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
  // Row 11. A band and a queue bound at their defaults are not sent
  // (`cleanClientLimits`): the root fills them in, as a root a release behind,
  // which refuses fields it does not know, needs.
  maxQueuedRequests: 8,
};

/** A key's queue band (row 11), in the words a person reads. */
export const BAND_LABELS: Record<NonNullable<ClientKeyLimits["band"]>, string> = {
  interactive: "Interactive",
  background: "Background",
  sheddable: "Dropped first when busy",
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
            Use exact IDs from Models, or a pattern such as{" "}
            <span className="font-mono">openrouter/*</span> (every model of the connection named
            openrouter). For an alias, allow its name and each target it may use. Empty denies every
            model.
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
      {/* Row 11: past its limit a request waits in line instead of being refused. */}
      <div className="flex flex-wrap gap-3">
        <label>
          Priority{" "}
          <select
            aria-label="Priority"
            className={field}
            value={value.band ?? "interactive"}
            onChange={(e) =>
              onChange({ ...value, band: e.target.value as NonNullable<ClientKeyLimits["band"]> })
            }
          >
            {Object.entries(BAND_LABELS).map(([band, label]) => (
              <option key={band} value={band}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Requests that may wait{" "}
          <input
            aria-label="Requests that may wait"
            className={`${field} w-20`}
            type="number"
            min={0}
            max={64}
            value={value.maxQueuedRequests ?? ""}
            placeholder="8 (default)"
            onChange={(e) =>
              onChange({ ...value, maxQueuedRequests: whole(e.target.value) as number })
            }
          />
        </label>
      </div>
      <p className="text-[color:var(--muted)]">
        When the machines are busy, requests wait in line: interactive first, then background, and
        each person in turn. A request past this many waiting is refused; 0 refuses at once. A
        signed-in person&rsquo;s groups can set their own priority.
      </p>
    </fieldset>
  );
}

/** The limits as they are sent: trimmed model ids, and row 11's band and queue
 * bound only when they are not the defaults (interactive, 8). */
export type ClientKeyLimitsBody = Omit<ClientKeyLimits, "band" | "maxQueuedRequests"> &
  Partial<Pick<ClientKeyLimits, "band" | "maxQueuedRequests">>;

export function cleanClientLimits(value: ClientKeyLimits): ClientKeyLimitsBody {
  const { band, maxQueuedRequests, ...rest } = value;
  return {
    ...rest,
    allowedModels:
      value.allowedModels == null
        ? null
        : [...new Set(value.allowedModels.map((s) => s.trim()).filter(Boolean))],
    ...(band && band !== "interactive" ? { band } : {}),
    ...(maxQueuedRequests != null && maxQueuedRequests !== 8 ? { maxQueuedRequests } : {}),
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
  const band = value.band && value.band !== "interactive" ? ` · ${BAND_LABELS[value.band]}` : "";
  const waiting = value.maxQueuedRequests ?? 8;
  const line = waiting === 0 ? "none may wait" : `${waiting} may wait`;
  return `${models}${value.localOnly ? " · Local-only" : ""}${search}${logs}${band} · ${value.maxConcurrentRequests ?? 2} concurrent · ${value.requestsPerMinute ?? 60}/minute · ${line}`;
}
