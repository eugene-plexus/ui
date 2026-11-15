"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CopyButton } from "@/components/CopyButton";
import { ApiError, api, describeError } from "@/lib/api";
import { gatewayAddressGuess } from "@/lib/connectApps";
import {
  SCRAPE_KEY_LIMITS,
  SCRAPE_KEY_NAME,
  otlpLine,
  prometheusLine,
  scrapeConfig,
  type Machine,
} from "@/lib/metricsExport";
import type { ClientKeyCreated, ComponentList, MetricsExport, NodeIdentity } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const POLL_MS = 15_000;

/**
 * The Metrics page's "Export" panel (row 12): where this install's numbers go
 * and how it is going.
 *
 * Prometheus pulls, so the panel says when it last did and gives the file that
 * makes it. A scrape key is a key that reads numbers and runs nothing
 * (`readMetrics` on, no models, no tools), so a stolen scrape file reaches no model. The
 * key is shown once, as every key is, and it is in the copied file only while
 * this panel still holds it.
 *
 * OTLP is pushed to a collector the person names under Settings, off until
 * they do. The sentence says whether the last push worked, and why not.
 */
export function MetricsExportPanel({ id = "export" }: { id?: string }) {
  const [info, setInfo] = useState<MetricsExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [gateway, setGateway] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [madeError, setMadeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await api.get<MetricsExport>("gateway", "/v1/metrics/export"));
      setError(null);
    } catch (e) {
      // Unknown, not off: a gateway that did not answer says nothing about the export.
      setInfo(null);
      setError(
        e instanceof ApiError && e.status === 404
          ? "Export state unavailable. This gateway is older than metrics export; update it to scrape it."
          : `Export state unavailable. ${describeError(e)}`,
      );
    }
  }, []);
  usePolling(load, POLL_MS);

  useEffect(() => {
    let live = true;
    Promise.all([
      api.get<NodeIdentity>("agent", "/v1/node").catch(() => null),
      api.get<ComponentList>("agent", "/v1/components").catch(() => null),
      api
        .get<{ nodes?: { name?: string; url?: string | null }[] }>("control", "/v1/nodes")
        .catch(() => null),
    ]).then(([node, components, nodes]) => {
      if (!live) return;
      setGateway(gatewayAddressGuess(node, components));
      const listed = (nodes?.nodes ?? [])
        .filter((n): n is { name: string; url: string } => Boolean(n.name && n.url))
        .map((n) => ({ name: n.name, url: n.url }));
      // An install that is not enrolled has one machine: the one serving this page.
      setMachines(
        listed.length > 0
          ? listed
          : [{ name: node?.name ?? "this machine", url: window.location.origin }],
      );
    });
    return () => {
      live = false;
    };
  }, []);

  const file = useMemo(
    () => scrapeConfig({ gateway, machines, key: fresh }),
    [gateway, machines, fresh],
  );

  async function makeKey() {
    if (busy) return;
    setBusy(true);
    setMadeError(null);
    try {
      const made = await api.post<ClientKeyCreated>("agent", "/v1/auth/client-keys", {
        name: SCRAPE_KEY_NAME,
        limits: SCRAPE_KEY_LIMITS,
      });
      setFresh(made.token);
    } catch (e) {
      setMadeError(
        e instanceof ApiError && e.status === 401
          ? "That machine refused the session. Sign in again, then make the key."
          : describeError(e),
      );
    } finally {
      setBusy(false);
    }
  }

  const otlp = otlpLine(info?.otlp);
  const toneClass = otlp.tone === "warn" ? "status-warn" : "text-[color:var(--muted)]";
  return (
    <section
      id={id}
      data-testid="metrics-export"
      className="mt-8 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4"
    >
      <h2 className="font-ui mb-2 text-base font-semibold">Export</h2>
      {error && (
        <p className="text-status-error font-ui mb-2 text-sm" role="alert">
          {error}
        </p>
      )}
      <p className="text-sm leading-relaxed">
        Prometheus: scrape <span className="font-mono">/metrics</span> on the gateway and on each
        machine, with a key that may read metrics.
      </p>
      {info && (
        <p data-testid="export-prometheus" className="mt-1 text-sm text-[color:var(--muted)]">
          {prometheusLine(info.prometheus)}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void makeKey()}
          disabled={busy}
          className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm"
        >
          {busy ? "Making…" : "Make a scrape key"}
        </button>
        <CopyButton text={file} label="Copy scrape configuration" />
      </div>
      {madeError && (
        <p className="text-status-error font-ui mt-2 text-sm" role="alert">
          {madeError}
        </p>
      )}
      {fresh && (
        <div data-testid="export-fresh-key" className="mt-2 space-y-2 text-sm">
          <p className="status-warn rounded-[var(--radius)] border p-2">
            Copy the scrape configuration now. The key is shown once and is not kept: it is in the
            copied file only until you leave this page.
          </p>
          <p className="flex flex-wrap items-center gap-2">
            <code className="max-w-full font-mono text-xs break-all">{fresh}</code>
            <CopyButton text={fresh} label="Copy key" />
          </p>
        </div>
      )}
      {!fresh && (
        <p className="mt-2 text-xs text-[color:var(--muted)]">
          The copied file has a placeholder for the key until you make one here. A scrape key can
          read numbers and run no model and no tool. Turn{" "}
          <span className="font-mono">May read metrics</span> on for any other key under{" "}
          <Link href="/connect" className="underline">
            Connect apps
          </Link>
          .
        </p>
      )}
      <p data-testid="export-otlp" className={`mt-4 text-sm ${toneClass}`}>
        {info ? otlp.text : ""}
        {info && otlp.tone === "off" && (
          <>
            {" "}
            Set a collector address under{" "}
            <Link href="/config?sel=gateway#telemetryOtlpEndpoint" className="underline">
              Settings
            </Link>
            .
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-[color:var(--muted)]">
        What leaves this machine is counters, timings and traces. Never a prompt, an answer or a
        person&rsquo;s name.
      </p>
    </section>
  );
}
