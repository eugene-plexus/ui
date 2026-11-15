/**
 * The words and the file behind the Metrics page's "Export" panel (row 12).
 *
 * Everything here is a function of its arguments, so the sentences and the
 * Prometheus file are asserted without a browser. A wrong target in a scrape
 * file is a support thread, and an OTLP line that says "sending" about a
 * collector that is not taking the data is a lie the page must not tell.
 */

import { clockTime } from "./relativeTime";
import type { MetricsExport } from "./types";

/** What "Make a scrape key" makes: a key that reads numbers and runs nothing. */
export const SCRAPE_KEY_NAME = "Prometheus";
export const SCRAPE_KEY_LIMITS = { allowedModels: [] as string[], readMetrics: true } as const;

/** The placeholder a copied file carries until a scrape key is made. */
export const SCRAPE_KEY_PLACEHOLDER = "YOUR_SCRAPE_KEY";

/** The sentence about Prometheus: when it last read this gateway, and with which key. */
export function prometheusLine(prometheus: MetricsExport["prometheus"] | null | undefined): string {
  if (!prometheus) return "";
  const at = clockTime(prometheus.lastScrapeAt);
  if (!at) return "Not scraped yet.";
  const who = prometheus.lastScrapeKeyName;
  return who ? `Last scraped ${at} with ${who}.` : `Last scraped ${at}.`;
}

export interface OtlpLine {
  text: string;
  tone: "ok" | "warn" | "off";
}

/**
 * The sentence about the OTLP exporter. Failing says the cause and that
 * requests are served as usual; waiting for a first send says nothing was
 * sent, and does not claim it works.
 */
export function otlpLine(otlp: MetricsExport["otlp"] | null | undefined): OtlpLine {
  if (!otlp || otlp.state === "off" || !otlp.endpoint) {
    return { text: "Not sending to a collector.", tone: "off" };
  }
  if (otlp.state === "failing") {
    const cause = (otlp.lastError ?? "").trim().replace(/\.+$/, "");
    return {
      text: `Export to ${otlp.endpoint} is failing${cause ? `: ${cause}` : ""}. Requests are served as usual.`,
      tone: "warn",
    };
  }
  const at = clockTime(otlp.lastSuccessAt);
  return {
    text: at
      ? `Sending to ${otlp.endpoint}. Last sent ${at}.`
      : `Sending to ${otlp.endpoint}. Nothing has been sent yet.`,
    tone: "ok",
  };
}

export interface Machine {
  name: string;
  /** The agent's own address, as the registry lists it. */
  url: string;
}

interface Target {
  scheme: "http" | "https";
  hostport: string;
  label?: string;
}

/** `scheme` and `host:port` of an address, or null for one that is not an http(s) URL. */
export function targetOf(address: string | null | undefined, label?: string): Target | null {
  if (!address) return null;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const host = url.hostname.includes(":")
    ? `[${url.hostname.replace(/^\[|\]$/g, "")}]`
    : url.hostname;
  return {
    scheme: url.protocol === "https:" ? "https" : "http",
    hostport: `${host}:${port}`,
    ...(label ? { label } : {}),
  };
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function job(name: string, scheme: string, key: string, targets: Target[]): string[] {
  const lines = [
    `  - job_name: ${name}`,
    "    metrics_path: /metrics",
    `    scheme: ${scheme}`,
    "    authorization:",
    `      credentials: ${quote(key)}`,
    "    static_configs:",
  ];
  for (const t of targets) {
    lines.push(`      - targets: [${quote(t.hostport)}]`);
    if (t.label) lines.push(`        labels: { machine: ${quote(t.label)} }`);
  }
  return lines;
}

/**
 * The `scrape_configs` block that reads this gateway and every machine's agent,
 * with the scrape key in `authorization.credentials`. A job per scheme, because
 * Prometheus sets the scheme for a whole job.
 */
export function scrapeConfig(args: {
  gateway: string | null;
  machines: readonly Machine[];
  key: string | null;
}): string {
  const key = args.key ?? SCRAPE_KEY_PLACEHOLDER;
  const lines = ["scrape_configs:"];
  const gateway = targetOf(args.gateway);
  if (gateway) lines.push(...job("eugene-gateway", gateway.scheme, key, [gateway]));
  const agents = args.machines
    .map((m) => targetOf(m.url, m.name))
    .filter((t): t is Target => t !== null);
  for (const scheme of ["http", "https"] as const) {
    const group = agents.filter((t) => t.scheme === scheme);
    if (group.length > 0) {
      lines.push(...job(`eugene-agents${scheme === "https" ? "-tls" : ""}`, scheme, key, group));
    }
  }
  return `${lines.join("\n")}\n`;
}
