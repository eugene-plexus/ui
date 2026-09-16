/**
 * "Use it from your apps": the three strings, and what each app does with them.
 *
 * Hobbyist UX §6.1 and §7 S4. §0.8 measured the state this replaces: the
 * only key a person could get was the **operator session token**, shown
 * in the playground's diagnostic panel nineteen clicks in, expiring in
 * fourteen days; the base URL was a guess labelled as one, wrong on any
 * port-remapped install; and §3's sixth-most-common failure across every
 * comparable project — the `/v1` suffix, a key field that must not be
 * empty, the exact model id — was shown nowhere together.
 *
 * Everything here is a function of its arguments: which agent holds the
 * records, what the three strings are, and what each app's config looks
 * like with them substituted. No React, no fetching, so the recipes can
 * be asserted without a browser — which matters more than usual, because
 * a wrong `apiBase` in a snippet is a support thread rather than a bug
 * report.
 */

import type { ComponentPlacementList } from "./types";

// --- where the records live ------------------------------------------

/**
 * Which proxy target mints and lists this install's client keys.
 *
 * A client key is install-wide — the whole install shares one signing
 * key, so a key minted anywhere verifies everywhere — but its **record**
 * is not: it lives on the agent that minted it, and the gateway checks
 * revocations against its own node's agent. Mint anywhere else and
 * "revoke" would be a button that changes nothing, which is the silent
 * failure P4 forbids.
 *
 * So: the agent on the gateway's node. Found from the control root's
 * placement list, which is the only view that carries the node
 * dimension. Reached through `node:<name>` when it is not this machine —
 * nobody has to open a browser over there
 * (`one-console-never-hop-nodes`).
 *
 * Falls back to the local agent when the root did not answer or names no
 * gateway. On a standalone install that is the right answer; on a
 * multi-node install with a sealed root it is a guess, and the card says
 * which machine it used so a wrong guess is visible rather than silent.
 */
export function clientKeyTarget(
  placement: ComponentPlacementList | null,
  localNode: string | null,
): { target: string; node: string | null; derived: "gateway-node" | "local" } {
  const gateway = (placement?.components ?? []).find((c) => c.kind === "gateway");
  const node = gateway?.node ?? null;
  if (node === null || node === "" || (localNode !== null && node === localNode)) {
    return { target: "agent", node: node ?? localNode, derived: node ? "gateway-node" : "local" };
  }
  return { target: `node:${node}`, node, derived: "gateway-node" };
}

// --- the key, as a person reads it -----------------------------------

/** `…k9Q0Xz`, the only part of a key a record can show. */
export function keyLabel(tail: string): string {
  return `…${tail}`;
}

/**
 * "made 15 Sep, valid until 15 Sep 2027" — or what is wrong with it.
 *
 * Revoked and expired are different sentences on purpose: one is
 * something the operator did, the other is something that happened, and
 * a person debugging a 401 needs to know which.
 */
export function keyStatus(
  key: { createdAt: string; expiresAt: string; revokedAt?: string | null },
  now: Date = new Date(),
): { text: string; tone: "ok" | "warn" | "off" } {
  if (key.revokedAt) {
    return { text: `turned off ${shortDate(key.revokedAt)}`, tone: "off" };
  }
  const expires = new Date(key.expiresAt);
  if (expires.getTime() <= now.getTime()) {
    return { text: `expired ${shortDate(key.expiresAt)}`, tone: "off" };
  }
  const days = Math.round((expires.getTime() - now.getTime()) / 86_400_000);
  const made = `made ${shortDate(key.createdAt)}`;
  if (days <= 14)
    return { text: `${made}, expires in ${days} day${days === 1 ? "" : "s"}`, tone: "warn" };
  return { text: `${made}, good until ${shortDate(key.expiresAt)}`, tone: "ok" };
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// --- the recipes ------------------------------------------------------

export interface Recipe {
  /** The app's own name, as its docs spell it. */
  readonly name: string;
  /** Where the snippet goes, or what to press. One line. */
  readonly where: string;
  /** The snippet, ready to paste. Empty when the app has no file. */
  readonly snippet: string;
  /** What to watch for. Optional, one sentence. */
  readonly note?: string;
}

export interface Strings {
  /** The gateway's base URL, already carrying `/v1`. */
  readonly baseUrl: string;
  /** The bearer. A client key, or whatever the person typed. */
  readonly key: string;
  /** The model id, exactly as `/v1/models` spells it. */
  readonly model: string;
}

/**
 * One recipe per app people actually point at a local endpoint.
 *
 * Chosen from §2's field survey and §3's failure #6 — *"The `apiBase`
 * differs for each tool. Otherwise, getting 404"* — so each says where
 * the value goes as well as what it is.
 *
 * **Claude Code is deliberately absent, and the design named it.** It
 * takes `ANTHROPIC_BASE_URL`, which must answer the Anthropic Messages
 * API at `/v1/messages`; this gateway serves the OpenAI shape at
 * `/v1/chat/completions`. A recipe for it would 404 for everyone who
 * followed it. Serving both shapes is a real thing to want and a
 * different slice.
 */
export function recipes(s: Strings): Recipe[] {
  return [
    {
      name: "Continue",
      where: "~/.continue/config.yaml",
      snippet: [
        "models:",
        "  - name: Eugene Plexus",
        "    provider: openai",
        `    model: ${s.model}`,
        `    apiBase: ${s.baseUrl}`,
        `    apiKey: ${s.key}`,
        "    roles: [chat, edit, apply]",
      ].join("\n"),
    },
    {
      name: "Cline",
      where: "Settings → API Provider → OpenAI Compatible",
      snippet: [`Base URL:  ${s.baseUrl}`, `API Key:   ${s.key}`, `Model ID:  ${s.model}`].join(
        "\n",
      ),
      note: "Cline has no config file for this; the three values go in its settings panel.",
    },
    {
      name: "Open WebUI",
      where: "Settings → Connections → OpenAI API",
      snippet: [`URL:  ${s.baseUrl}`, `Key:  ${s.key}`].join("\n"),
      note: "Open WebUI asks the endpoint which models it has, so there is no model to type.",
    },
    {
      name: "SillyTavern",
      where: "API → Chat Completion → Custom (OpenAI-compatible)",
      snippet: [
        `Custom Endpoint:  ${s.baseUrl}`,
        `Custom API Key:   ${s.key}`,
        `Model:            ${s.model}`,
      ].join("\n"),
    },
    {
      name: "OpenCode",
      where: "opencode.json",
      snippet: JSON.stringify(
        {
          provider: {
            "eugene-plexus": {
              npm: "@ai-sdk/openai-compatible",
              name: "Eugene Plexus",
              options: { baseURL: s.baseUrl, apiKey: s.key },
              models: { [s.model]: { name: s.model } },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      name: "Any OpenAI SDK",
      where: "Environment variables",
      snippet: [`OPENAI_BASE_URL=${s.baseUrl}`, `OPENAI_API_KEY=${s.key}`].join("\n"),
      note: "The Python and JS SDKs, aider and most harnesses read these two.",
    },
    {
      name: "curl",
      where: "A terminal",
      snippet: curlLine(s),
    },
  ];
}

/** The one-liner that proves the other six should work. */
export function curlLine(s: Strings): string {
  const body = JSON.stringify({
    model: s.model,
    messages: [{ role: "user", content: "Say hello in five words." }],
  });
  return [
    `curl ${shellQuote(`${s.baseUrl}/chat/completions`)}`,
    `  -H ${shellQuote(`Authorization: Bearer ${s.key}`)}`,
    `  -H ${shellQuote("Content-Type: application/json")}`,
    `  -d ${shellQuote(body)}`,
  ].join(" \\\n");
}

/** Single-quote for a POSIX shell. Same rule as the diagnostic panel's. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// --- what is missing, said before the person pastes anything ---------

/**
 * Why these strings will not work yet, in the order a person hits them.
 *
 * P8: every state has a next step. An empty card with three blank boxes
 * is the disabled composer §0.3 measured, one screen over.
 */
export function blockers(args: {
  baseUrl: string | null;
  key: string | null;
  model: string | null;
}): string[] {
  const out: string[] = [];
  if (!args.baseUrl) {
    out.push(
      "The address is not known yet — the gateway has not said which port it listens on. " +
        "It appears once the gateway is running.",
    );
  }
  if (!args.model) {
    out.push("No model is running, so there is no model id to give an app. Start one first.");
  }
  if (!args.key) {
    out.push("Make a key below. An app will not connect without one, even on your own machine.");
  }
  return out;
}
