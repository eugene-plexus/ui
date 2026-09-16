/**
 * Whether the address we offer a harness is right, and how we know.
 *
 * `guessGatewayBaseUrl` works out where the gateway probably is from the
 * page's own host and the gateway's port in the topology. Its docstring
 * has always said the guess is wrong on a container that publishes 8080
 * as 8280 -- and on 2026-09-16 that cost a real afternoon: the guess was
 * offered as plain text, an OpenAI client was pointed at
 * `192.168.16.252:8080`, and **qBittorrent answered it** with a bare
 * `400 Bad Request` and no body. Nothing in the UI had said the number
 * was uncertain, and nothing had offered to check.
 *
 * Two answers here, and they are not the same kind of thing.
 *
 * ## 1. `portRemapEvidence` -- cheap, and can only ever raise a doubt
 *
 * The browser loaded this page from some port; S5's `boundAddresses`
 * says what the agent's socket is actually listening on. **Those
 * disagreeing is proof that something between the two rewrites port
 * numbers**, so a port carried out of the topology does not survive the
 * trip either and the guess below it is very likely wrong.
 *
 * **The converse does not hold, and that asymmetry is the whole design.**
 * The two agreeing proves only that the agent's own port is published
 * one-to-one; a host is free to publish the gateway's differently. So
 * this function has exactly two answers -- "remapped" and "no evidence"
 * -- and never a third meaning "the guess is fine". Nothing here may
 * promise the address is right. Only section 2 can do that.
 *
 * Note `next dev` reports `remapped` (page :3000, agent :8079) and that
 * is not a false positive: the port really is not preserved on the way
 * in, and the reasoning that produces the warning is sound even where
 * the guess happens to land on its feet.
 *
 * ## 2. `verifyGatewayAddress` -- the proof, and it needs no key
 *
 * The gateway speaks CORS on exactly three paths and `/v1/models` is one
 * of them (`gateway/src/eugene_plexus_gateway/cors.py`), so a page on
 * any origin may call it directly, no proxy in the way -- the same path
 * a harness takes. **And the header is added on `http.response.start`
 * whatever the status**, so an unauthenticated call comes back as a
 * *readable* 401 carrying a `Problem` that names `component: "gateway"`.
 *
 * That is the whole trick: the address is provable before a key exists,
 * which is exactly when a person is looking at this card. Measured
 * against the live install 2026-09-16:
 *
 *     $ curl -i http://192.168.16.252:8280/v1/models -H 'Origin: ...'
 *     HTTP/1.1 401 Unauthorized
 *     access-control-allow-origin: *
 *     {"detail":{...,"component":"gateway"}}
 *
 * **A browser cannot read a response from something that is not us**, so
 * the interesting case needs a second request. A cross-origin `fetch` to
 * qBittorrent is refused by the browser for the missing header and
 * surfaces as `TypeError: Failed to fetch` -- indistinguishable from
 * nothing listening at all, which is the one distinction that matters
 * here. A `mode: "no-cors"` retry separates them: it resolves opaquely
 * when something is listening and speaking HTTP, and rejects when the
 * connection itself fails. So "qBittorrent is on that port" becomes
 * `blocked`, and "wrong port entirely" becomes `unreachable`.
 */

/** Just enough of `window.location` to decide, and nothing untestable. */
export interface PageLocationPort {
  protocol: string;
  /** `window.location.port` -- empty string at the scheme's default. */
  port: string;
}

/** One row of S5's `reach.boundAddresses`. */
export interface BoundAddressLike {
  process: string;
  port: number;
}

export type RemapEvidence =
  | { kind: "remapped"; pagePort: number; agentPort: number }
  | { kind: "none" };

/**
 * The port in the address bar, with the scheme's default made explicit.
 *
 * `location.port` is `""` for 80 on http and 443 on https, and a
 * comparison against a bound port would otherwise read that as "no port"
 * rather than as the port it is.
 */
export function pagePort(loc: PageLocationPort): number | null {
  if (loc.port) {
    const n = Number(loc.port);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  if (loc.protocol === "https:") return 443;
  if (loc.protocol === "http:") return 80;
  return null;
}

/**
 * Does something between the browser and this agent rewrite ports?
 *
 * Only ever `remapped` or `none`; see the module docstring for why there
 * is deliberately no third answer meaning "trustworthy".
 */
export function portRemapEvidence(
  loc: PageLocationPort,
  bound: readonly BoundAddressLike[] | null | undefined,
): RemapEvidence {
  const seen = pagePort(loc);
  if (seen === null) return { kind: "none" };
  const agent = (bound ?? []).find((b) => b.process === "agent");
  if (!agent || !Number.isInteger(agent.port)) return { kind: "none" };
  return agent.port === seen
    ? { kind: "none" }
    : { kind: "remapped", pagePort: seen, agentPort: agent.port };
}

export type Verdict =
  /** The gateway answered. `authenticated` false means it answered 401. */
  | { kind: "confirmed"; models: string[]; authenticated: boolean }
  /** Something answered and it is not this gateway. */
  | { kind: "not-gateway"; status: number }
  /** Something is listening; the browser was not allowed to read it. */
  | { kind: "blocked" }
  /** Nothing answered at all. */
  | { kind: "unreachable"; message: string };

/** `http://host:port`, however the caller spelled it. */
export function normalizeBase(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return `${url.protocol}//${url.host}`;
}

/** Is this body the gateway's own `Problem` envelope? */
function isGatewayProblem(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail !== "object" || detail === null) return false;
  return (detail as { component?: unknown }).component === "gateway";
}

/** Is this body an OpenAI model list? */
function modelIds(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  return data
    .map((m) => (typeof m === "object" && m !== null ? (m as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === "string");
}

/**
 * Call the address the way a harness would, and say what is there.
 *
 * `key` is optional on purpose -- see the module docstring. With one the
 * answer also carries the model ids, which is what catches the other
 * half of the same afternoon's bug: a client configured with an empty
 * model id, against a gateway that was never reached.
 */
export async function verifyGatewayAddress(
  baseUrl: string,
  opts: { key?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<Verdict> {
  const base = normalizeBase(baseUrl);
  if (base === null) return { kind: "unreachable", message: "That is not a URL." };
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${base}/v1/models`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;

  let response: Response;
  try {
    // Plain `fetch`: no `lib/api.ts`, no session, no 401 redirect. This
    // is the harness's path and must carry nothing of ours.
    response = await doFetch(url, { method: "GET", headers });
  } catch (e) {
    // Refused for the missing CORS header, or nothing there at all. One
    // opaque probe tells the two apart.
    try {
      await doFetch(url, { method: "GET", mode: "no-cors" });
      return { kind: "blocked" };
    } catch {
      return { kind: "unreachable", message: e instanceof Error ? e.message : String(e) };
    }
  }

  // An opaque response never throws, so the `no-cors` outcome can also
  // arrive here if a caller passed that mode in.
  if (response.type === "opaque") return { kind: "blocked" };

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON. qBittorrent's `Not Found` lands exactly here.
  }

  const ids = modelIds(body);
  if (response.ok && ids !== null) return { kind: "confirmed", models: ids, authenticated: true };
  if (isGatewayProblem(body)) {
    return { kind: "confirmed", models: [], authenticated: response.ok };
  }
  return { kind: "not-gateway", status: response.status };
}

export type Tone = "ok" | "warn" | "error";

/**
 * The doubt, said in the numbers that produced it.
 *
 * Naming both ports matters more than the warning does: "this install
 * publishes its ports differently" sends a person to look, and 8279
 * against 8079 tells them what they are looking for.
 */
export function describeRemap(evidence: RemapEvidence): string | null {
  if (evidence.kind !== "remapped") return null;
  return (
    `This page reached the agent on port ${evidence.pagePort}, but the agent is listening on ` +
    `${evidence.agentPort} — something between them publishes ports differently. The address ` +
    `above is worked out from the gateway's own port the same way, so it is probably wrong too.`
  );
}

/** What was found at the address, for a person who is about to paste it. */
export function describeVerdict(verdict: Verdict, baseUrl: string): { tone: Tone; text: string } {
  switch (verdict.kind) {
    case "confirmed":
      if (!verdict.authenticated) {
        return {
          tone: "ok",
          text: "Checked: the gateway answered at this address. It asked for a key, which is what it should do — make one below.",
        };
      }
      return {
        tone: "ok",
        text: verdict.models.length
          ? `Checked: the gateway answered at this address and serves ${verdict.models.join(", ")}.`
          : "Checked: the gateway answered at this address, but it is routing to nothing right now.",
      };
    case "not-gateway":
      return {
        tone: "error",
        text:
          `Something answered at ${baseUrl}, but it is not this gateway — it replied ` +
          `${verdict.status}. Another service is on that port. Correct the address above.`,
      };
    case "blocked":
      return {
        tone: "error",
        text:
          `Something is listening at ${baseUrl}, but it would not answer this page. Either it is ` +
          `not this gateway, or the gateway has browser clients turned off ` +
          `(Config → Gateway → corsEnabled). An app that is not a browser may still work.`,
      };
    case "unreachable":
      return {
        tone: "warn",
        text:
          `Nothing answered at ${baseUrl}. Check the port your host publishes for the gateway, ` +
          `and that the machine lets the connection in — see "Reach it from other devices" below.`,
      };
  }
}
