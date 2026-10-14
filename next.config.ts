import type { NextConfig } from "next";

/**
 * The UI is a pure client application, and since install-paths §9 step 1
 * it ships as static files inside a Python wheel that the agent serves.
 *
 * That was made possible by deleting one file: the proxy route handler
 * at `src/app/api/proxy/[target]/[...path]/route.ts`, which was the only
 * dynamic route in the whole application. It now lives in the agent
 * (`routes/proxy.py`), where resolving a target is an in-process lookup
 * instead of an authenticated HTTP round-trip back to the thing asking.
 *
 * What survives `output: "export"` is everything this UI is made of:
 * hooks and state, client-side routing, code splitting, SSE, charts,
 * editors. What is dropped is the *server* half of Next — Server
 * Components, Server Actions, middleware, SSR, ISR, runtime route
 * handlers — none of which this application uses. Static export does not
 * mean a static website.
 */

// `next dev` still runs a dev server, and that server is not the agent,
// so the proxy the browser calls does not exist at this origin. Forward
// it. Development only: `output: "export"` and `rewrites` are mutually
// exclusive, which is why both are conditional rather than both present.
const dev = process.env.NODE_ENV !== "production";
const AGENT_URL = process.env.AGENT_URL?.trim() || "http://127.0.0.1:8079";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The Next.js dev-mode build-activity indicator otherwise overlays the
  // bottom-left corner, conflicting with the chat composer.
  devIndicators: false,

  // **The trailing-slash convention, chosen deliberately.** An export
  // emits one HTML file per route, and the two conventions produce
  // different trees: `false` gives `out/nodes.html`, `true` gives
  // `out/nodes/index.html`. Only the second is servable by an ordinary
  // static file server without a rewrite rule — Starlette's StaticFiles
  // resolves `/nodes/` to the index and redirects `/nodes` to it. Get
  // this wrong and the symptom is a page that works when clicked and
  // 404s when pasted, which names neither cause.
  trailingSlash: true,

  // No Next image optimizer in an export; there is no server to run it.
  // One `next/image` call, on the home page.
  images: { unoptimized: true },

  ...(dev
    ? {
        // **`next dev` since Next 16 blocks its own client bundle when the
        // page is reached by an address it does not recognise**, including
        // `127.0.0.1` when the server announces itself as `localhost`. The
        // symptom is not an error: the page server-renders, the client
        // bundle is refused, hydration never runs, and a wizard sits on
        // "Loading setup…" forever. Invisible to anyone browsing
        // `localhost`, which is everyone until a browser drives it by IP —
        // M9's Playwright arc, which is what found it. Add your own tailnet
        // address here if you develop against one.
        allowedDevOrigins: ["127.0.0.1", "localhost", "::1"],
        rewrites: async () => [
          { source: "/api/proxy/:path*", destination: `${AGENT_URL}/api/proxy/:path*` },
        ],
      }
    : { output: "export" as const }),
};

export default config;
