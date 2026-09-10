"use client";

import { useEffect, useRef, useState } from "react";

import { copyText } from "@/lib/clipboard";

type CopyState = "idle" | "copied" | "failed";

/**
 * Copy-to-clipboard with a transient acknowledgement.
 *
 * It reports failure rather than swallowing it: copying can genuinely fail
 * (no secure context and no `execCommand`, or a denied permission), and a
 * button that looks like it worked is worse than one that says it didn't.
 */
export function CopyButton({
  text,
  label = "Copy",
  className = "",
  title,
}: {
  text: string;
  label?: string;
  className?: string;
  title?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function handleClick() {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), ok ? 1500 : 3000);
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      title={title ?? (state === "failed" ? "Your browser refused the clipboard" : "Copy")}
      aria-live="polite"
      className={`font-ui rounded-[var(--radius)] px-2 py-1 text-[11px] transition-colors hover:bg-[color:var(--panel-hover)] ${
        state === "failed" ? "status-error" : "text-[color:var(--muted)]"
      } ${className}`}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : label}
    </button>
  );
}
