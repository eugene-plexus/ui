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

/** Any enrolled agent forwards to the active install registry. */
export function clientKeyTarget(
  _placement: ComponentPlacementList | null,
  localNode: string | null,
): { target: string; node: string | null; derived: "local" } {
  return { target: "agent", node: localNode, derived: "local" };
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
  /**
   * A second place, for an app that reads from two. Codex names an
   * environment variable in its file and reads the key from it, so the
   * file and the key are two things to paste in two places -- and one
   * block holding both would put the key in a file that is not meant to
   * carry it, or put an unquoted `NAME=value` line into TOML that Codex
   * then refuses to read.
   */
  readonly then?: { readonly where: string; readonly snippet: string };
}

export interface Strings {
  /** The gateway's base URL, already carrying `/v1`. */
  readonly baseUrl: string;
  /** The bearer. A client key, or whatever the person typed. */
  readonly key: string;
  /** The model id, exactly as `/v1/models` spells it. */
  readonly model: string;
  /**
   * The model's context window in tokens, as `GET /v1/models` reports it
   * (`lib/modelContext.ts`). `null` or absent when the gateway does not
   * say, and then no recipe writes a number it was not given (settings
   * never lie): the recipe says the window is unknown and names the line.
   */
  readonly contextWindow?: number | null;
}

/** A window worth writing down: a positive whole number of tokens. */
function knownWindow(s: Strings): number | null {
  const w = s.contextWindow;
  return typeof w === "number" && Number.isFinite(w) && w > 0 ? Math.floor(w) : null;
}

/**
 * What Claude Code keeps free for each reply on a model id it does not
 * recognise. From its environment-variable reference: "For a model ID
 * Claude Code can't resolve to a model it knows, the default is 32000".
 */
export const CLAUDE_CODE_UNKNOWN_MODEL_OUTPUT_TOKENS = 32_000;

/**
 * `CLAUDE_CODE_MAX_OUTPUT_TOKENS` for a window, or `null` to leave
 * Claude Code's own 32,000 alone.
 *
 * **Why a line at all.** Claude Code subtracts the reply room from the
 * window before it decides to compact ("Increasing this value reduces
 * the effective context window available before auto-compaction"), so a
 * 32k local model told its real window and nothing else would leave
 * Claude Code about 768 tokens of conversation before it compacts --
 * reasoned from that sentence, not run.
 * The gateway's capacity budget also reserves a turn's whole
 * `max_tokens` (cache-aware balancing, record §9), so 32,000 on a 64k
 * pool holds one Claude Code turn where two would fit by real use.
 *
 * **Why a quarter.** It is a choice, not a measurement: three quarters
 * of the window for the conversation and a quarter for one reply, 8,192
 * tokens on a 32k model. Where a quarter is already 32,000 or more (a
 * 128k window and up) the line would only restate Claude Code's default,
 * so it is left out.
 */
export function claudeCodeOutputTokens(window: number): number | null {
  const quarter = Math.floor(window / 4);
  return quarter > 0 && quarter < CLAUDE_CODE_UNKNOWN_MODEL_OUTPUT_TOKENS ? quarter : null;
}

/** The environment variable Codex's provider entry names for the key. */
export const CODEX_KEY_VARIABLE = "EUGENE_API_KEY";

/**
 * A TOML basic string. JSON's string escapes (`\"`, `\\`, `\n`, `\uXXXX`)
 * are all TOML basic-string escapes too, and `JSON.stringify` never emits
 * one TOML lacks, so a model id with a quote in it stays one string.
 */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * The origin, with the `/v1` taken back off.
 *
 * **Every other recipe on this card wants the `/v1` and this one must
 * not have it.** `ANTHROPIC_BASE_URL` is a root: the client appends
 * `/v1/messages` itself, so handing it `…/v1` produces requests to
 * `/v1/v1/messages` and a 404 that reads as "your gateway is wrong".
 * Measured against Claude Code 2.1.207, which asks for
 * `POST /v1/messages?beta=true`.
 */
export function anthropicBaseUrl(s: Strings): string {
  return s.baseUrl.replace(/\/v1\/?$/, "");
}

/**
 * One recipe per app people actually point at a local endpoint.
 *
 * Chosen from §2's field survey and §3's failure #6 — *"The `apiBase`
 * differs for each tool. Otherwise, getting 404"* — so each says where
 * the value goes as well as what it is.
 *
 * **Claude Code was deliberately absent until R4, and it leads now.**
 * It takes `ANTHROPIC_BASE_URL`, which must answer the Anthropic
 * Messages API at `/v1/messages` — a shape this gateway did not serve,
 * so a recipe for it would have 404'd for everyone who followed it.
 * The gateway serves it since R4, and this recipe is written from a
 * measured run rather than from the documentation: see
 * `specs/docs/acceptance/anthropic-messages-measurement.md`.
 *
 * **Codex follows it (2026-10-03).** It speaks only the Responses API,
 * which the gateway serves since the Responses door; there was no
 * recipe, and the audit found the one people would write from Codex's
 * docs misses two lines that matter (`env_key`, `model_context_window`).
 */
export function recipes(s: Strings): Recipe[] {
  return [claudeCode(s), codex(s), ...openAiRecipes(s)];
}

/**
 * Claude Code, as of 2.1.288 (upstream drift audit, 2026-10-03).
 *
 * **`CLAUDE_CODE_EFFORT_LEVEL=unset` is gone.** It was never a value
 * Claude Code documents (low, medium, high, xhigh, max, auto), and its
 * reason -- the door refused `output_config.effort` -- stopped being
 * true on 2026-09-23.
 *
 * **The window is the new line.** Claude Code assumes 200K for a model id
 * it does not recognise and compacts against that, and the docs say
 * `CLAUDE_CODE_MAX_CONTEXT_TOKENS` "applies directly" to such an id. A
 * local model's id is exactly that case; a hosted Claude's id resolves to
 * a model Claude Code knows, where the variable is inert and harmless.
 * The gateway words an overflow `prompt is too long` since the same
 * contract, which is what Claude Code compacts on when the number is
 * still wrong.
 */
function claudeCode(s: Strings): Recipe {
  const window = knownWindow(s);
  const reply = window === null ? null : claudeCodeOutputTokens(window);
  const lines = [
    `ANTHROPIC_BASE_URL=${anthropicBaseUrl(s)}`,
    `ANTHROPIC_AUTH_TOKEN=${s.key}`,
    `ANTHROPIC_MODEL=${s.model}`,
  ];
  if (window !== null) lines.push(`CLAUDE_CODE_MAX_CONTEXT_TOKENS=${window}`);
  if (reply !== null) lines.push(`CLAUDE_CODE_MAX_OUTPUT_TOKENS=${reply}`);

  const auth =
    "No /v1 on the base URL here — Claude Code adds it. Use ANTHROPIC_AUTH_TOKEN, " +
    "not ANTHROPIC_API_KEY: the API-key variable needs a one-off approval prompt, and " +
    "if you are signed in to a Claude subscription it is ignored and your Anthropic " +
    "token is sent instead.";
  const size =
    window === null
      ? " This model's window is not known yet, so set CLAUDE_CODE_MAX_CONTEXT_TOKENS " +
        "to it yourself. Without it, Claude Code assumes 200,000 tokens and the model " +
        "runs out of room first."
      : " CLAUDE_CODE_MAX_CONTEXT_TOKENS is this model's window, so Claude Code sums up " +
        "older turns before the window fills. It assumes 200,000 tokens otherwise." +
        (reply === null
          ? ""
          : " CLAUDE_CODE_MAX_OUTPUT_TOKENS leaves room for your conversation: Claude Code " +
            "otherwise keeps 32,000 tokens free for each reply.");
  return {
    name: "Claude Code",
    where: "Environment variables",
    snippet: lines.join("\n"),
    note: auth + size,
  };
}

/**
 * Codex, as of 0.160.0, every key read in its source (drift audit,
 * 2026-10-03).
 *
 * - A custom provider is the only way to point Codex at another
 *   endpoint, and it speaks the Responses API only (`wire_api` accepts
 *   `responses` and refuses the removed `chat`), which the gateway serves.
 * - **`env_key` is mandatory in practice**: since openai/codex#39214 a
 *   custom provider no longer inherits ambient auth, so without it Codex
 *   sends no key and the gateway answers 401.
 * - **`model_context_window`**: Codex falls back to 272,000 tokens for a
 *   model it has no metadata for (`models-manager/src/model_info.rs`),
 *   compacts against that, and treats a real overflow as the end of the
 *   conversation. Written only when the gateway knows the window.
 * - `model`, `model_provider` and `model_context_window` are top-level
 *   keys, so they come before the `[model_providers.eugene]` header: in
 *   TOML a key after a header belongs to that table, and both structs
 *   are `deny_unknown_fields`.
 * - No `[features] multi_agent = false`: the gateway takes Codex's
 *   `namespace` tools since specs 8c41b85's contract.
 */
function codex(s: Strings): Recipe {
  const window = knownWindow(s);
  const top = [`model_provider = "eugene"`, `model = ${tomlString(s.model)}`];
  if (window !== null) top.push(`model_context_window = ${window}`);
  const provider = [
    "[model_providers.eugene]",
    `name = "Eugene Plexus"`,
    `base_url = ${tomlString(s.baseUrl)}`,
    `env_key = ${tomlString(CODEX_KEY_VARIABLE)}`,
    `wire_api = "responses"`,
  ];
  const size =
    window === null
      ? " This model's window is not known yet, so add model_context_window with it yourself. " +
        "Without it, Codex assumes 272,000 tokens and stops when the model runs out of room."
      : " model_context_window is this model's window. Without it, Codex assumes 272,000 " +
        "tokens and stops when the model runs out of room.";
  return {
    name: "Codex",
    where: "~/.codex/config.toml",
    snippet: [...top, "", ...provider].join("\n"),
    note:
      `Codex reads the key from ${CODEX_KEY_VARIABLE}, the variable env_key names, ` +
      "and sends none without it." +
      size,
    then: {
      where: "Environment variable, set where you start Codex",
      snippet: `${CODEX_KEY_VARIABLE}=${s.key}`,
    },
  };
}

/** The apps that speak the OpenAI shape, `/v1` and all. */
function openAiRecipes(s: Strings): Recipe[] {
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
      note:
        "Open WebUI asks the endpoint which models it has, so there is no model to type. " +
        "For images, select a vision model with its matching projector loaded. " +
        "PNG and JPEG attachments are supported; text-only models refuse them.",
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
