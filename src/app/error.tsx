"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Route-level error boundary. Catches uncaught render errors in any page
 * under this layout (chat, config, future pages) and shows a styled
 * fallback instead of a blank screen. Theme tokens still apply because
 * <html> and <body> are owned by the root layout, which keeps rendering.
 *
 * **It promises only what is true of the page it caught.** It used to
 * tell every page "Your conversation is still saved", which is true of
 * the playground alone (its transcript is written to the tab's storage
 * on every change) and a promise about nothing anywhere else. So the
 * sentence is said on the playground and not on the other pages.
 *
 * Errors thrown in the root layout itself need `global-error.tsx` — not
 * yet wired in v0.1 because the layout is essentially static.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname() ?? "";
  // With or without the export's trailing slash.
  const onPlayground = pathname === "/playground" || pathname.startsWith("/playground/");

  useEffect(() => {
    console.error("Eugene UI render error:", error);
  }, [error]);

  return (
    <main className="flex h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-6">
        <h1 className="font-ui mb-2 text-lg font-semibold">Something broke.</h1>
        <p className="mb-3 text-sm text-[color:var(--muted)]">
          This page hit an error it did not expect.
          {onPlayground ? " Your conversation is still saved." : ""} Try again, or reload the page.
        </p>
        <pre className="text-status-error mb-4 max-h-48 overflow-auto rounded-[var(--radius)] bg-[color:var(--panel-soft)] p-3 font-mono text-xs leading-relaxed">
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-2 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter] hover:brightness-110"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-4 py-2 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Reload page
          </button>
        </div>
      </div>
    </main>
  );
}
