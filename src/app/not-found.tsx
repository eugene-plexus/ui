"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * The page for an address that is not a page.
 *
 * Without this file the export's `404.html` is Next's own default: an
 * unstyled black-on-white page in every theme, with no way back and no
 * word about which address was wrong. That is what a pasted link with a
 * typo, or a bookmark to a screen that has since moved, used to land on.
 *
 * **The address is read in the browser, after mount.** A static export
 * renders this ONCE, at build time, into one `404.html` that the agent
 * serves for every missing path, so there is no request to read it from
 * at render time. Until mount it says nothing about the address rather
 * than something wrong.
 *
 * Deliberately outside `AppShell`: the shell reads the install's layout
 * and needs a session, and a missing page must render for somebody who
 * has neither.
 */
export default function NotFound() {
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => {
    setPath(window.location.pathname);
  }, []);

  return (
    <main className="flex h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-6">
        <h1 className="font-ui mb-2 text-lg font-semibold">Page not found</h1>
        <p className="mb-4 text-sm text-[color:var(--muted)]">
          There is no page at this address
          {path ? (
            <>
              : <code className="font-mono break-all text-[color:var(--foreground)]">{path}</code>
            </>
          ) : null}
          .
        </p>
        <Link
          href="/"
          className="font-ui inline-block rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-2 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter] hover:brightness-110"
        >
          Go to Home
        </Link>
      </div>
    </main>
  );
}
