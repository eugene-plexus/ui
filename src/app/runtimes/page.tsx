"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * `/runtimes` became `/inference` on 2026-09-12.
 *
 * "Runtime" is this project's word for an engine process it supervises.
 * The operator's question is "what is serving, and where" -- which
 * includes backends nobody here supervises (an Ollama, a cloud CLI) and
 * runtimes on other nodes, none of which this page could show. The
 * install-wide answer lives at `/inference`; this route stays so old
 * links, bookmarks and the wizard's closing text still land somewhere.
 */
export default function RuntimesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/inference");
  }, [router]);
  return (
    <main className="p-4 text-xs text-[color:var(--muted)]">
      Runtimes moved to{" "}
      <a href="/inference/" className="underline">
        Inference
      </a>
      .
    </main>
  );
}
