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
};

export default config;
