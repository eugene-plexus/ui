/**
 * The playground as a diagnostic instrument -- the pure half.
 *
 * Everything here is a function of its arguments and nothing else, so it
 * can be tested without a browser: guessing where the gateway is from
 * the agent's topology, the hints for a base URL that cannot work, the
 * `curl` line that replays a request outside a browser, the shape an
 * attached file takes inside a message, and the sentences a failed
 * request gets when the browser has said only `Failed to fetch`.
 *
 * Design: `specs/docs/design/playground-diagnostic.md`. The rule that
 * shapes all of it is §7.1 of the agent-clients design: a reference
 * client that shares its path with the thing it tests, tests nothing.
 * So the direct mode dials the gateway the way OpenCode does -- a base
 * URL and a bearer -- and these helpers exist to make that path
 * usable, explainable and reproducible.
 */

import type { RequestReport } from "./completions";
import { seconds } from "./turnFormat";
import type { Tool } from "./types";

/** What the page knows about its own address. `window.location`
 * narrowed to what these functions read, so tests can hand one in. */
export interface PageLocation {
  protocol: string;
  hostname: string;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.has(hostname.toLowerCase());
}

/**
 * A base URL as this module uses it: scheme, host, port, nothing after.
 *
 * OpenAI clients are configured with `.../v1` -- `OPENAI_BASE_URL`,
 * OpenCode's `baseURL`, the SDK's `base_url` all want it -- and people
 * paste that form. Accepted, and stripped, so the path is appended once.
 * A trailing slash is stripped too. Anything else after the port is
 * left alone: this is not a URL parser and should not pretend to be.
 */
export function normalizeBaseUrl(raw: string): string {
  let s = raw.trim();
  while (s.endsWith("/")) s = s.slice(0, -1);
  if (s.toLowerCase().endsWith("/v1")) s = s.slice(0, -3);
  while (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

/** The form to show and to paste into a harness: normalized, plus `/v1`. */
export function displayBaseUrl(raw: string): string {
  const base = normalizeBaseUrl(raw);
  return base ? `${base}/v1` : "";
}

/** The port a URL names, or the scheme's default when it names none. */
function portOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.port) return u.port;
    return u.protocol === "https:" ? "443" : u.protocol === "http:" ? "80" : null;
  } catch {
    return null;
  }
}

/**
 * Where a harness would probably find the gateway, from where the page is.
 *
 * The browser knows nothing about the gateway's address: its own calls
 * go through the agent's proxy, which dials the topology URL -- almost
 * always `127.0.0.1:8080`, true on the gateway's host and useless
 * anywhere else. What the topology does carry that survives the trip is
 * the **port**, so the guess is the page's own scheme and host plus that
 * port; `advertiseUrl` is preferred when set because it is the address
 * the install already uses to reach the component from elsewhere.
 *
 * It is a guess and the panel says so. On a container that publishes
 * 8080 as 8280 it is wrong in exactly the way a harness handed the same
 * numbers would be wrong, and the failure it produces is the honest one.
 */
export function guessGatewayBaseUrl(
  components: ReadonlyArray<{ kind: string; url: string; advertiseUrl?: string }>,
  page: PageLocation,
): string | null {
  const gateway = components.find((c) => c.kind === "gateway");
  if (!gateway) return null;
  if (gateway.advertiseUrl) {
    const normalized = normalizeBaseUrl(gateway.advertiseUrl);
    if (normalized) return normalized;
  }
  const port = portOf(gateway.url);
  if (!port) return null;
  const host = page.hostname.includes(":") ? `[${page.hostname}]` : page.hostname;
  return `${page.protocol}//${host}:${port}`;
}

/**
 * Why a base URL cannot work from this page, said before the request.
 *
 * Both failures below surface in a browser as `TypeError: Failed to
 * fetch` with no status and no body, and both are wrong for a harness
 * for the same reason they are wrong here -- which is what makes them
 * worth a sentence rather than a silent retry.
 */
export function baseUrlHints(raw: string, page: PageLocation): string[] {
  const hints: string[] = [];
  const base = normalizeBaseUrl(raw);
  if (!base) return hints;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return [`"${raw.trim()}" is not a URL. Expected something like http://192.168.1.20:8080/v1.`];
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    hints.push(`Only http and https work here; "${url.protocol}" will not.`);
  }
  if (page.protocol === "https:" && url.protocol === "http:") {
    hints.push(
      "This page is https and the base URL is http. The browser blocks that as mixed " +
        "content before any request leaves. Serve the gateway over https too, or open the UI over http.",
    );
  }
  if (isLoopbackHost(url.hostname) && !isLoopbackHost(page.hostname)) {
    hints.push(
      `The base URL is loopback but this page is on ${page.hostname}. A request to 127.0.0.1 ` +
        "goes to the machine running the browser, not the gateway -- a harness on another " +
        "machine would be wrong in the same way -- and Chrome may gate it behind a local-network " +
        "permission it never showed you.",
    );
  }
  return hints;
}

/** Single-quote a string for a POSIX shell. `'` becomes `'\''`. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export const CURL_KEY_PLACEHOLDER = "$EUGENE_PLEXUS_TOKEN";

/**
 * The request as a `curl` line, replayable outside a browser.
 *
 * `body` is the serialized JSON the browser actually sent -- not a
 * re-serialization of the object -- so what the shell replays is the
 * request, byte for byte. `-N` because the body is a stream when
 * `stream: true` and curl's default buffering would hide that. The key
 * is a shell variable unless the caller reveals it: a bug report should
 * be pasteable without a credential in it.
 */
export function buildCurl(url: string, body: string | null, key: string | null): string {
  const parts = ["curl -sN", shellQuote(url)];
  // Double quotes around the placeholder, so the shell expands it. The
  // first acceptance run copied this line out of the page with the
  // variable single-quoted, and the replay sent the literal string
  // `$EUGENE_PLEXUS_TOKEN` as the bearer -- a reproduction that cannot
  // reproduce. A real key is single-quoted, since it must not expand.
  parts.push(
    "-H",
    key === null
      ? `"Authorization: Bearer ${CURL_KEY_PLACEHOLDER}"`
      : shellQuote(`Authorization: Bearer ${key}`),
  );
  if (body !== null) {
    parts.push("-H", shellQuote("Content-Type: application/json"));
    parts.push("-d", shellQuote(asciiJson(body)));
  }
  return parts.join(" ");
}

/**
 * The same JSON document with every non-ASCII character as a `\uXXXX`
 * escape -- semantically identical, and pure ASCII.
 *
 * Found by the first acceptance run: a model answered with `-3°C`, the
 * degree sign rode into the transcript, and the copied curl line -- run
 * in Git Bash on Windows -- arrived at the gateway as one byte `\xb0`
 * instead of `\xc2\xb0`, because the argument crossed the Windows
 * command line through the ANSI code page. The gateway said "error
 * parsing the body" and the reproduction could not reproduce. JSON
 * permits the escape everywhere a character may appear, so a body with
 * none outside ASCII survives any shell.
 */
export function asciiJson(json: string): string {
  return json.replace(/[-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

// --- attachments ------------------------------------------------------

export interface AttachmentText {
  name: string;
  size: number;
  text: string;
}

/** Past this nothing useful happens and the browser spends seconds
 * serializing it. Not the model's window -- that is what the request is
 * for finding out. */
export const ATTACHMENT_LIMIT_BYTES = 1_048_576;

/**
 * Whether a file can be inlined, and if not, why.
 *
 * Binary is detected by what decoding did to it: a NUL byte or a
 * replacement character means the bytes were not text, and inlining
 * mojibake would send the model something that was never in the file.
 */
export function checkAttachment(name: string, size: number, text: string): string | null {
  if (size > ATTACHMENT_LIMIT_BYTES) {
    const mb = (size / 1_048_576).toFixed(1);
    return `${name} is ${mb} MB; attachments stop at 1 MB. Send a part of it instead.`;
  }
  if (text.includes(" ") || text.includes("�")) {
    return `${name} is not a text file. Only text can be inlined into a message.`;
  }
  return null;
}

/**
 * Text plus files, as one message.
 *
 * The contract's `content` is a string, and this is what a coding
 * harness does when it pastes a file into a conversation -- so it is
 * both the only wire shape available and the faithful one. The fence
 * names the file and its size so the model, and the operator reading
 * the transcript, can tell where the typed text ends. What the
 * transcript shows is what was sent; there is no separate attachment
 * object to get out of step with it.
 */
export function inlineAttachments(text: string, files: ReadonlyArray<AttachmentText>): string {
  const blocks = files.map(
    (f) =>
      `--- attached: ${f.name} (${f.size.toLocaleString("en-US")} bytes) ---\n` +
      `${f.text.replace(/\r\n/g, "\n").replace(/\n$/, "")}\n` +
      `--- end ${f.name} ---`,
  );
  const head = text.trim();
  return [head, ...blocks].filter((s) => s.length > 0).join("\n\n");
}

// --- tools ------------------------------------------------------------

/**
 * The definition the tool-calling acceptance run uses, so what the
 * playground sends by default is the thing already proven to make a real
 * model call a tool. The prefilled result is the one that run hands
 * back, so the loop can be closed in two clicks.
 */
export const EXAMPLE_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description:
        "Get the current weather for a city. Call this whenever the user asks about weather.",
      parameters: {
        type: "object",
        properties: { city: { type: "string", description: "The city name" } },
        required: ["city"],
      },
    },
  },
];

export const EXAMPLE_TOOL_RESULT = '{"tempC": -3, "sky": "snow"}';

export function exampleResultFor(functionName: string): string {
  return functionName === "get_weather" ? EXAMPLE_TOOL_RESULT : "";
}

/**
 * The tools textarea, parsed. An error names the line when JSON says
 * which, and the shape problem otherwise -- a definition with no
 * `function.name` is the mistake that makes a backend 400 with a message
 * about nothing in particular.
 */
export function parseToolDefinitions(text: string): { tools: Tool[] } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `Tools are not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!Array.isArray(parsed)) return { error: "Tools must be a JSON array of tool definitions." };
  for (const [i, t] of parsed.entries()) {
    const tool = t as { type?: unknown; function?: { name?: unknown } };
    if (tool?.type !== "function") {
      return { error: `Tool ${i + 1}: "type" must be "function".` };
    }
    if (typeof tool.function?.name !== "string" || !tool.function.name) {
      return { error: `Tool ${i + 1}: "function.name" is required.` };
    }
  }
  return { tools: parsed as Tool[] };
}

/** Whether a tool call's arguments are JSON, which a model does not
 * always manage; the card says so rather than rendering garbage as if
 * it were a call a harness could dispatch. */
export function argumentsParse(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

// --- the report -------------------------------------------------------

/** One line: the path, the outcome, the shape of what came back. */
export function summarizeReport(r: RequestReport): string {
  const parts: string[] = [r.mode === "direct" ? "direct" : "via agent proxy"];
  if (r.status !== null) parts.push(`HTTP ${r.status}`);
  else if (r.error) parts.push("no response");
  if (r.elapsedMs !== null) parts.push(`${seconds(r.elapsedMs)} total`);
  if (r.streamed && r.firstFrameMs !== null) {
    parts.push(`first token ${seconds(r.firstFrameMs)}`);
  }
  if (r.streamed) parts.push(`${r.frames} frames`);
  if (r.toolCallDeltas > 0)
    parts.push(`${r.toolCallDeltas} tool-call delta${r.toolCallDeltas === 1 ? "" : "s"}`);
  if (r.finishReason) parts.push(`finish ${r.finishReason}`);
  if (r.routing?.driver) parts.push(`driver ${r.routing.driver}`);
  if (r.error && r.status === null) parts.push(r.error);
  return parts.join(" · ");
}

/**
 * What a failed request could mean, ordered by likelihood given its shape.
 *
 * A browser reports a CORS refusal, a connection refusal, mixed content
 * and a blocked local-network request with the same five words, and no
 * status. The report cannot tell them apart; it can list them, and it
 * can say what a `curl` of the same preflight would reveal.
 */
export function explainFailure(r: RequestReport, page: PageLocation): string[] {
  const out: string[] = [];
  if (r.status === 401) {
    out.push(
      "The gateway refused the key. It expires 14 days after sign-in, and a key from one install " +
        "is refused by another -- sign in again and use the token this panel shows.",
    );
    return out;
  }
  if (r.status === 404) {
    out.push(
      `${r.url} is not a gateway: nothing answers at /v1/chat/completions there. The agent's ` +
        "port is the usual mistake -- the gateway is a different process on a different port.",
    );
    return out;
  }
  if (r.status === 403) {
    out.push(
      "The gateway answered the browser's preflight with 403: this page's origin is not in its " +
        "corsAllowedOrigins. Add it under Config -> Gateway -> Browser clients, or clear the list.",
    );
    return out;
  }
  if (r.status === 405) {
    out.push(
      "405 to a preflight is what a gateway older than 2026-09-13 says: it does not speak CORS " +
        "at all. Upgrade it; until then only non-browser clients can use it directly.",
    );
    return out;
  }
  if (r.status !== null) return out;

  // Network-level: nothing came back.
  let url: URL | null = null;
  try {
    url = new URL(r.url);
  } catch {
    url = null;
  }
  if (url && page.protocol === "https:" && url.protocol === "http:") {
    out.push("Mixed content: an https page cannot call an http gateway. The browser blocked it.");
  }
  if (url && isLoopbackHost(url.hostname) && !isLoopbackHost(page.hostname)) {
    out.push(
      `The base URL is loopback and this page is on ${page.hostname}: the request went to the ` +
        "browser's own machine. Use the gateway host's address, as a harness elsewhere would have to.",
    );
  }
  out.push(
    `Nothing answered at ${r.url} in a way the browser would accept. In order of likelihood: the ` +
      "port is published differently than the topology says (a container remap, 8080 -> 8280); " +
      "the gateway binds 127.0.0.1 on a machine you are not on; corsEnabled is false on the " +
      "gateway (Config -> Gateway -> Browser clients). The same request works through the agent's " +
      "proxy if the gateway itself is healthy, so switch modes to bisect.",
  );
  out.push(
    `To see which: curl -i -X OPTIONS ${shellQuote(r.url)} -H 'Origin: ${page.protocol}//${page.hostname}' ` +
      "-H 'Access-Control-Request-Method: POST' -- a 204 means CORS is fine and the problem is " +
      "reachability from this browser; a 403 names the config key; connection refused is the address.",
  );
  return out;
}
