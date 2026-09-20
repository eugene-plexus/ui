"use client";

import { useState } from "react";

import { CopyButton } from "@/components/CopyButton";
import type { RequestReport as Report } from "@/lib/completions";
import { type PageLocation, buildCurl, explainFailure, summarizeReport } from "@/lib/diagnostic";

/**
 * What one request did on the wire, from this browser's side.
 *
 * The routing bar above it says what the control plane did with the
 * request; this says what the client saw -- which URL, which status,
 * how long to the first frame, how many frames -- and ends with the
 * `curl` line that replays the request outside a browser. Both halves
 * together are what a bug report needs, and the `curl` is what turns
 * "the playground uses the tool fine" into something a shell can check.
 */
export function RequestReport({
  report,
  page,
  apiKey,
}: {
  report: Report;
  page: PageLocation;
  /** The bearer to include in the curl when revealed. */
  apiKey: string | null;
}) {
  const [includeKey, setIncludeKey] = useState(false);
  const failed = report.error !== null && (report.status === null || report.status >= 400);
  const explanations = failed ? explainFailure(report, page) : [];
  const curl =
    report.reproduceUrl !== null
      ? buildCurl(report.reproduceUrl, report.body, includeKey ? apiKey : null)
      : null;

  return (
    <details
      className="max-h-[35dvh] shrink-0 overflow-y-auto border-t border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-1 font-mono text-[0.6875rem] break-words"
      data-testid="request-report"
    >
      <summary
        data-testid="report-summary"
        data-mode={report.mode}
        data-status={report.status ?? ""}
        data-frames={report.frames}
        data-tool-call-deltas={report.toolCallDeltas}
        data-prompt-tokens={report.usage?.prompt_tokens ?? ""}
        data-driver={report.routing?.driver ?? ""}
        className={`cursor-pointer select-none ${failed ? "status-error" : "text-[color:var(--muted)]"}`}
      >
        Request report · {summarizeReport(report)}
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
              {report.status !== null ? `HTTP ${report.status}` : "no response"}
              {report.error ? ` — ${report.error}` : ""}
              {report.truncatedBy && !report.error ? ` — cut short: ${report.truncatedBy}` : ""}
            </Row>
            <Row label="timing">
              {report.elapsedMs !== null ? `${report.elapsedMs} ms total` : "—"}
              {report.streamed && report.firstFrameMs !== null
                ? ` · first frame at ${report.firstFrameMs} ms`
                : ""}
            </Row>
            {report.streamed && (
              <Row label="stream">
                {report.frames} frames · {report.contentDeltas} content deltas ·{" "}
                {report.toolCallDeltas} tool-call deltas
              </Row>
            )}
            <Row label="finish">{report.finishReason ?? "—"}</Row>
            {report.usage && (
              <Row label="usage">
                {report.usage.prompt_tokens} prompt → {report.usage.completion_tokens} completion
                tokens
              </Row>
            )}
            {report.routing && (
              <Row label="served by">
                {[
                  report.routing.driver && `driver ${report.routing.driver}`,
                  report.routing.runtime && `runtime ${report.routing.runtime}`,
                  report.routing.backend,
                  report.routing.tier != null && `tier ${report.routing.tier}`,
                  report.routing.attempts != null && `${report.routing.attempts} attempt(s)`,
                  report.routing.latency_ms != null &&
                    `${report.routing.latency_ms} ms gateway-side`,
                  report.routing.context_length != null && `${report.routing.context_length} ctx`,
                  report.routing.prompt_truncated === true && "INPUT TRUNCATED",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Row>
            )}
          </tbody>
        </table>

        {explanations.length > 0 && (
          <ul className="status-warn flex flex-col gap-1 rounded-[var(--radius)] px-2 py-1 font-sans text-[0.6875rem]">
            {explanations.map((line) => (
              <li key={line} className="whitespace-pre-wrap">
                {line}
              </li>
            ))}
          </ul>
        )}

        <details>
          <summary className="cursor-pointer text-[color:var(--muted)]">
            Request body as sent ({report.body.length.toLocaleString("en-US")} bytes)
          </summary>
          <pre className="mt-1 max-h-60 overflow-auto rounded-[var(--radius)] bg-[color:var(--panel-soft)] p-2 break-all whitespace-pre-wrap">
            {report.body}
          </pre>
        </details>

        {curl !== null ? (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 text-[color:var(--muted)]">
              <span>Reproduce outside a browser</span>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={includeKey}
                  onChange={(e) => setIncludeKey(e.target.checked)}
                  disabled={apiKey === null}
                />
                include the key
              </label>
              <CopyButton text={curl} label="Copy curl" title="Copy the curl line" />
              {report.mode === "proxy" && (
                <span className="font-sans">
                  — against the gateway directly, which is not the path this turn took
                </span>
              )}
            </div>
            <pre
              data-testid="report-curl"
              className="max-h-40 overflow-auto rounded-[var(--radius)] bg-[color:var(--panel-soft)] p-2 break-all whitespace-pre-wrap"
            >
              {curl}
            </pre>
          </div>
        ) : (
          <p className="text-[color:var(--muted)]">
            No curl line: this turn went through the proxy and the gateway&apos;s own address is not
            known here. Set a base URL under <em>Direct to the gateway</em> to get one.
          </p>
        )}
      </div>
    </details>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="align-top">
      <th className="w-24 pr-2 font-normal text-[color:var(--muted)]">{label}</th>
      <td className="break-all text-[color:var(--foreground)]">{children}</td>
    </tr>
  );
}
