"use client";

import { useState } from "react";

import { CopyButton } from "@/components/CopyButton";
import { type DoorReport as Report, doorCurl } from "@/lib/doorRequest";
import { seconds } from "@/lib/turnFormat";

/**
 * What one request to one of the other doors did, from this browser's
 * side, ending with the curl line that replays it. The chat report's
 * sibling: a picture or a clip has no deltas to count, so this says
 * status, timing, size, what served it and the request id instead.
 */
export function DoorReport({ report, apiKey }: { report: Report; apiKey: string | null }) {
  const [includeKey, setIncludeKey] = useState(false);
  const failed = report.error !== null;
  const curl = doorCurl(report, includeKey ? apiKey : null);
  const served = report.routing ? servedBy(report.routing) : null;

  return (
    <details
      data-testid="door-report"
      className="shrink-0 border-t border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-1 font-mono text-[0.6875rem] break-words"
    >
      <summary
        data-testid="door-report-summary"
        data-mode={report.mode}
        data-status={report.status ?? ""}
        data-driver={typeof report.routing?.driver === "string" ? report.routing.driver : ""}
        className={`cursor-pointer select-none ${failed ? "status-error" : "text-[color:var(--muted)]"}`}
      >
        Request report · {report.status !== null ? `HTTP ${report.status}` : "no answer"}
        {report.elapsedMs !== null ? ` · ${seconds(report.elapsedMs)}` : ""}
        {served ? ` · ${served}` : ""}
      </summary>
      <div className="mt-2 flex flex-col gap-2 pb-2">
        <table className="w-full text-left">
          <tbody>
            <Row label="path">
              {report.mode === "direct" ? "direct to the gateway" : "through the agent's proxy"}
            </Row>
            <Row label="dialled">
              {report.method} {report.url}
            </Row>
            <Row label="outcome">
              {report.status !== null ? `HTTP ${report.status}` : "no answer"}
              {report.error ? ` — ${report.error}` : ""}
            </Row>
            <Row label="timing">
              {report.elapsedMs !== null ? `${seconds(report.elapsedMs)} total` : "—"}
              {report.firstByteMs !== null ? ` · first byte at ${seconds(report.firstByteMs)}` : ""}
            </Row>
            {report.bytes !== null && (
              <Row label="answer">
                {report.bytes.toLocaleString("en-US")} bytes
                {report.contentType ? ` · ${report.contentType}` : ""}
              </Row>
            )}
            {served && <Row label="served by">{served}</Row>}
            {report.requestId && <Row label="request id">{report.requestId}</Row>}
          </tbody>
        </table>
        {report.body !== null && (
          <details>
            <summary className="cursor-pointer text-[color:var(--muted)]">
              Request body as sent
            </summary>
            <pre className="mt-1 max-h-60 overflow-auto rounded-[var(--radius)] bg-[color:var(--panel-soft)] p-2 break-all whitespace-pre-wrap">
              {report.body.length > 20_000 ? `${report.body.slice(0, 20_000)}…` : report.body}
            </pre>
          </details>
        )}
        {report.fields !== null && (
          <details>
            <summary className="cursor-pointer text-[color:var(--muted)]">
              Form fields as sent
            </summary>
            <ul className="mt-1">
              {report.fields.map((f) => (
                <li key={`${f.name}:${"file" in f ? f.file : f.value}`}>
                  {f.name} = {"file" in f ? `a file, ${f.file}` : f.value}
                </li>
              ))}
            </ul>
          </details>
        )}
        {curl !== null ? (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 text-[color:var(--muted)]">
              <span>Reproduce outside a browser</span>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={includeKey}
                  onChange={(e) => setIncludeKey(e.target.checked)}
                />
                include the key
              </label>
              <CopyButton text={curl} label="Copy" title="The curl line" />
            </div>
            <pre
              data-testid="door-curl"
              className="overflow-auto rounded-[var(--radius)] bg-[color:var(--panel-soft)] p-2 break-all whitespace-pre-wrap"
            >
              {curl}
            </pre>
          </div>
        ) : (
          <p className="text-[color:var(--muted)]">
            {
              "No curl line: this page does not know the gateway's address. Open Diagnostic and type it."
            }
          </p>
        )}
      </div>
    </details>
  );
}

function servedBy(routing: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof routing.driver === "string") parts.push(`driver ${routing.driver}`);
  if (typeof routing.backend === "string") parts.push(routing.backend);
  if (typeof routing.tier === "number") parts.push(`tier ${routing.tier}`);
  if (typeof routing.attempts === "number") parts.push(`${routing.attempts} attempt(s)`);
  if (typeof routing.latency_ms === "number")
    parts.push(`${seconds(routing.latency_ms)} at the gateway`);
  return parts.join(" · ");
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th className="w-24 pr-2 align-top font-normal text-[color:var(--muted)]">{label}</th>
      <td>{children}</td>
    </tr>
  );
}
