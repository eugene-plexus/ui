/**
 * Same-origin proxy from the UI to the configured Eugene Plexus components.
 *
 * Browser hits  /api/proxy/<target>/<...path>  → server fetches
 * <component-base-url>/<...path> with the same method, headers (filtered),
 * and body. This avoids CORS configuration on the components and keeps the
 * UI origin-restricted.
 *
 * `<target>` is one of `orchestrator`, `left`, `right`. Resolution is done
 * via `readProxyEndpoints()` from environment variables.
 */

import { NextRequest, NextResponse } from "next/server";

import { isProxyTarget, readProxyEndpoints, resolveTarget } from "@/lib/config";

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
  if (!isProxyTarget(target)) {
    return NextResponse.json({ error: `unknown target: ${target}` }, { status: 400 });
  }

  const resolved = resolveTarget(target, readProxyEndpoints());
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
