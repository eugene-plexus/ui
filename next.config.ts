import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The Next.js dev-mode build-activity indicator otherwise overlays the
  // bottom-left corner, conflicting with the chat composer.
  devIndicators: false,
  // The orchestrator URL is read at runtime by the proxy route handler;
  // keeping it server-side avoids exposing the URL to the browser and
  // sidesteps CORS entirely.

  // **`next dev` blocks its own client bundle when the page is reached by
  // an address it does not recognise**, and since Next 16 that includes
  // `127.0.0.1` when the server announces itself as `localhost`. The
  // symptom is not an error: the page server-renders, the client bundle
  // is refused, hydration never runs, and a wizard sits on "Loading
  // setup…" forever. Invisible to anyone who browses `localhost`, which
  // is everyone until the first browser drives it by IP — M9's Playwright
  // arc, which is what found this.
  //
  // Worth fixing rather than working around, because reaching this UI
  // from another machine is the product. Development only; `next start`
  // ignores it. Add your own tailnet address here if you develop against
  // one.
  allowedDevOrigins: ["127.0.0.1", "localhost", "::1"],
};

export default config;
