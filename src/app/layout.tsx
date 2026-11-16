import type { Metadata } from "next";
import localFont from "next/font/local";

import "./globals.css";

// The fonts are vendored in `./fonts` (latin subset, woff2, each with its
// OFL license) and loaded with `next/font/local`, not `next/font/google`:
// the Google loader downloads the files while `next build` runs, and the
// build failed whenever Google Fonts did not answer (ui#28). A build now
// needs no network. The family names, weights, `display` and CSS variables
// are the ones the Google loader produced, so nothing renders differently.
// To change a font, replace the file and keep its OFL-*.txt beside it;
// `fonts.test.ts` gates the import, the variables and the licenses.

// Modern theme uses Inter for everything.
const inter = localFont({
  src: [{ path: "./fonts/inter-latin-wght-normal.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-inter",
  display: "swap",
});

// Plexus uses IBM Plex Sans for UI + body and IBM Plex Mono for code:
// one family, an engineer's pedigree, and no display face. Both expose
// CSS variables consumed by the `[data-theme="plexus"]` block in
// globals.css. They replace Space Grotesk, which went with the
// `cyberpunk` theme on 2026-09-16 -- its only consumer.
const ibmPlexSans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

const ibmPlexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: [
    { path: "./fonts/jetbrains-mono-latin-wght-normal.woff2", weight: "100 800", style: "normal" },
  ],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// Editorial theme uses DM Sans for UI + body (mono falls through to
// the OS chain per the design preset).
const dmSans = localFont({
  src: [{ path: "./fonts/dm-sans-latin-wght-normal.woff2", weight: "100 1000", style: "normal" }],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Eugene Plexus",
  description: "Self-hosted control plane for local LLM inference.",
};

// Inline script that runs before React hydrates so the saved theme +
// font-size are applied before the browser paints. **The default is
// `plexus` since 2026-09-17 (modern from 2026-09-12, cyberpunk before
// that), and it is spelled out in SIX places that must agree**: here
// (invalid value, and the catch), the `data-theme` on <html> below,
// `DEFAULT_THEME` in useTheme.ts, `DEFAULT_RESOLVED_THEME` beside it
// (the SSR / no-`matchMedia` fallback), and — the two that are easy
// to miss — which theme's tokens **each of the two `:root` blocks** in
// globals.css carries, one for the palette and one for the status
// banners. Miss a `:root` and there is no error, just a frame of the
// wrong theme before this script runs, which is the flash this script
// exists to prevent. **This comment said "four places" until the
// promotion counted them**, which is the shape of every drift it warns
// about. Promoting a theme also MOVES its `:root` block to the top of
// globals.css: `:root` and `[data-theme="x"]` have equal specificity,
// so source order decides. `lib/themeDefault.test.ts` gates all six.
// Logic here is duplicated (intentionally tiny) in `useTheme.ts` and
// `useFontSize.ts` so React's view of the same state stays in sync.
const preferencesBootstrap = `
(function () {
  var root = document.documentElement;
  try {
    var t = localStorage.getItem('eugene-theme');
    if (t !== 'plexus' && t !== 'modern' && t !== 'editorial' && t !== 'system') t = 'plexus';
    var resolved = t;
    if (t === 'system') {
      resolved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'plexus'
        : 'modern';
    }
    root.dataset.theme = resolved;
  } catch (_) {
    root.dataset.theme = 'plexus';
  }
  try {
    var f = localStorage.getItem('eugene-font-size');
    var px = { small: '14px', default: '16px', large: '18px', xlarge: '20px' }[f] || '16px';
    root.style.fontSize = px;
  } catch (_) {
    root.style.fontSize = '16px';
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="plexus"
      className={`${inter.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable} ${jetbrainsMono.variable} ${dmSans.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* The same mark the website serves, and the same file. An SVG
            rather than the 846 KB PNG it replaces: one asset for the
            favicon and both on-screen uses, sharp at any size, and
            **transparent** — the PNG had no alpha channel at all, so it
            was a solid navy square: invisible on a dark theme, a dark
            tile on a light one, and wrong on every theme either way. */}
        <link rel="icon" type="image/svg+xml" href="/eugene-icon.svg" />
        <script dangerouslySetInnerHTML={{ __html: preferencesBootstrap }} />
      </head>
      <body className="min-h-screen antialiased">
        <div className="theme-bg-icon" aria-hidden="true">
          {/* Plain <img>, not next/image: this is decorative, doesn't
              need optimization, and `fill`-mode positioning fights the
              flex centering. Kept ESLint-quiet via the comment below. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/eugene-icon.svg" alt="" />
        </div>
        {children}
      </body>
    </html>
  );
}
