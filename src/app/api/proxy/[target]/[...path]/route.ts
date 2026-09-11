/**
 * Same-origin proxy from the UI to the configured Eugene Plexus components.
 *
 * Browser hits  /api/proxy/<target>/<...path>  → server fetches
 * <component-base-url>/<...path> with the same method, headers (filtered),
 * and body. This avoids CORS configuration on the components and keeps the
 * UI origin-restricted.
 *
 * `<target>` is `gateway`, `agent`, `library`, `control`, or the name
 * of an `inference-driver` entry in the agent topology. Everything but
 * the first two is resolved from the agent at request time, so the UI
 * needs no env-var-per-component bootstrap and a component added while
 * the UI is running is reachable immediately.
 */

import { NextRequest, NextResponse } from "next/server";

import { isValidTargetName, resolveTarget } from "@/lib/config";

export const dynamic = "force-dynamic";

const STRIPPED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
]);

/**
 * Send a *different* bearer upstream from the one used to resolve the
 * target. Never forwarded; it becomes the upstream `Authorization`.
 *
 * There is exactly one caller and it is not a convenience. Resolving
 * `control` (or a driver) means asking the **agent's** bearer-protected
 * `/v1/components` where it is, so the proxy uses the request's own
 * Authorization for that lookup and forwards the same header upstream.
 * Normally right: one install, one signing key, one token that works
 * everywhere.
 *
 * **Except during first run.** Between initializing the agent and
 * enrolling it, the agent is minting its own random per-restart key while
 * the control root is minting the install's, so the two genuinely require
 * different tokens — and the wizard has to mint a join token at the root
 * (control's token) while resolving where the root is (the agent's). Sent
 * as one header, that is unsatisfiable; a 401 at the resolver renders as
 * "no control component in the agent topology", which is alarming and
 * false. That misreport is already on record from the last time this was
 * met, and it cost M9's browser arc a run to meet it again.
 */
const UPSTREAM_AUTH_HEADER = "x-eugene-plexus-upstream-authorization";

const STRIPPED_RESPONSE_HEADERS = new Set([
  "transfer-encoding",
  "connection",
  "content-encoding",
  "content-length",
]);

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ target: string; path: string[] }> },
) {
  const { target, path } = await ctx.params;
  if (!isValidTargetName(target)) {
    return NextResponse.json({ error: `invalid target: ${target}` }, { status: 400 });
  }

  // Forward the incoming Authorization header into the target resolver.
  // Agent's /v1/components (the resolver's lookup endpoint) is
  // bearer-auth-protected, so without this the resolver gets 401 on
  // every logged-in request.
  const authHeader = req.headers.get("authorization") ?? undefined;
  const resolved = await resolveTarget(target, authHeader);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 503 });
  }

  // Component URLs from the agent topology arrive with a trailing
  // slash (e.g. `http://127.0.0.1:8081/`). Naive concatenation
  // would produce `http://127.0.0.1:8083//v1/config/schema` — FastAPI
  // treats the double slash as a different path and returns 404.
  // Normalize once here so all resolved URLs join cleanly with any
  // path shape.
  const base = resolved.url.replace(/\/+$/, "");
  const upstreamUrl = new URL(`${base}/${(path ?? []).join("/")}`);
  for (const [k, v] of req.nextUrl.searchParams.entries()) {
    upstreamUrl.searchParams.append(k, v);
  }

  const headers = new Headers();
  for (const [k, v] of req.headers.entries()) {
    if (!STRIPPED_REQUEST_HEADERS.has(k.toLowerCase())) {
      headers.set(k, v);
    }
  }
  const upstreamAuth = req.headers.get(UPSTREAM_AUTH_HEADER);
  if (upstreamAuth) {
    headers.set("authorization", upstreamAuth);
    headers.delete(UPSTREAM_AUTH_HEADER);
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, init);
  } catch (e) {
    return NextResponse.json(
      {
        error: "upstream fetch failed",
        target,
        url: upstreamUrl.toString(),
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    if (!STRIPPED_RESPONSE_HEADERS.has(k.toLowerCase())) {
      respHeaders.set(k, v);
    }
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
