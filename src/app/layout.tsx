import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Orbitron, Space_Grotesk } from "next/font/google";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-orbitron",
  display: "swap",
});

// Miami '26 fonts. Loaded unconditionally because next/font tree-shakes
// per-route based on usage and the theme is operator-selectable at
// runtime — we can't statically prove which fonts a given page will
// reference. Bundle cost is two extra subsetted woff2s. Both expose
// CSS variables (--font-space-grotesk, --font-jetbrains-mono) that the
// `[data-theme="miami"]` block in globals.css resolves to.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Eugene Plexus",
  description: "Bicameral consciousness scaffold over LLMs.",
};

// Inline script that runs before React hydrates so the saved theme +
// font-size are applied before the browser paints. Without this, users
// with non-default preferences would see a one-frame flash. Logic is
// duplicated (intentionally tiny) in `useTheme.ts` and `useFontSize.ts`
// so React's view of the same state stays in sync.
const preferencesBootstrap = `
(function () {
  var root = document.documentElement;
  try {
    var t = localStorage.getItem('eugene-theme');
    if (t !== 'cyberpunk' && t !== 'modern' && t !== 'miami' && t !== 'system') t = 'cyberpunk';
    var resolved = t;
    if (t === 'system') {
      resolved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'cyberpunk'
        : 'modern';
    }
    root.dataset.theme = resolved;
  } catch (_) {
    root.dataset.theme = 'cyberpunk';
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
      data-theme="cyberpunk"
      className={`${inter.variable} ${orbitron.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: preferencesBootstrap }} />
      </head>
      <body className="min-h-screen antialiased">
        <div className="theme-bg-icon" aria-hidden="true">
          {/* Plain <img>, not next/image: this is decorative, doesn't
              need optimization, and `fill`-mode positioning fights the
              flex centering. Kept ESLint-quiet via the comment below. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/eugene-icon.png" alt="" />
        </div>
        {children}
      </body>
    </html>
  );
}
