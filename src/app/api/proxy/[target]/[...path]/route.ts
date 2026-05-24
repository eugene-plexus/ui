/**
 * Same-origin proxy from the UI to the configured Eugene Plexus components.
 *
 * Browser hits  /api/proxy/<target>/<...path>  → server fetches
 * <component-base-url>/<...path> with the same method, headers (filtered),
 * and body. This avoids CORS configuration on the components and keeps the
 * UI origin-restricted.
 *
 * `<target>` is `orchestrator` or any operator-supplied driver name from
 * the orchestrator's `drivers` config. Resolution is dynamic: driver URLs
 * come from the orchestrator at request time so the UI doesn't need its
 * own env-var-per-driver bootstrap.
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

  // v0.2: forward the incoming Authorization header into the target
  // resolver. Watchdog's /v1/components and orchestrator's /v1/config
  // (the resolver's lookup endpoints) are both bearer-auth-protected,
  // so without this the resolver gets 401 on every logged-in request.
  const authHeader = req.headers.get("authorization") ?? undefined;
  const resolved = await resolveTarget(target, authHeader);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 503 });
  }

  const upstreamUrl = new URL(`${resolved.url}/${(path ?? []).join("/")}`);
  for (const [k, v] of req.nextUrl.searchParams.entries()) {
    upstreamUrl.searchParams.append(k, v);
  }

  const headers = new Headers();
  for (const [k, v] of req.headers.entries()) {
    if (!STRIPPED_REQUEST_HEADERS.has(k.toLowerCase())) {
      headers.set(k, v);
    }
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
