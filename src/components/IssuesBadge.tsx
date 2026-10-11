"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { Issue, IssueSeverity } from "@/lib/issues";
import { useIssues } from "@/lib/useIssues";

import { IssueRow } from "./IssueRow";

/**
 * The header's Issues list: things that will not get better on their own,
 * from every signed-in screen.
 *
 * The other half of principle P7 — one tray for background work, one list
 * for things that need a person — and of P4, *nothing silent*: §3's top
 * three field failures all fail with a green status, and this install has
 * produced two of them itself. A control root that came back sealed while
 * agent, gateway and control all answered `"status":"ok"`, and a worker
 * taken out of the install by half a second of clock drift while every
 * health check passed.
 *
 * **The sealed root carries its fix inline, and that is the slice's
 * whole point.** S7's *Done when* is "a sealed root shows as one issue
 * with the unlock as its action, **from any page**", and this is the
 * surface that makes "any page" true. `IssueRow` holds that rule and
 * says why it is the one exception.
 *
 * A disclosure, not a route, exactly as `TasksTray` is: `Escape` and a
 * click outside close it and focus returns to the button.
 */
export function IssuesBadge() {
  const { issues, worst, loaded, reload } = useIssues();
  return <IssuesBadgeView issues={issues} worst={worst} loaded={loaded} onFixed={reload} />;
}

export interface IssuesBadgeViewProps {
  issues: Issue[];
  worst: IssueSeverity | null;
  /** Before the first poll answers the badge says nothing at all. A
   * cheerful "nothing needs attention" shown to somebody whose root is
   * sealed, half a second before the list fills, is worse than silence. */
  loaded: boolean;
  /** Pull the list forward after an issue was fixed from inside it,
   * rather than leaving it on screen for the rest of the interval. */
  onFixed?: () => void | Promise<void>;
}

/** The rendering, apart from the polling, so it can be driven in jsdom. */
export function IssuesBadgeView({ issues, worst, loaded, onFixed }: IssuesBadgeViewProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    }
    function onPointer(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  // **An emptied list closes.** The early return below unmounts the
  // popover without touching `open`, so after the last issue was fixed
  // from inside it -- an unlock, typically -- the next issue to appear
  // arrived with the list already open over the page, unasked, and a
  // sealed root's passphrase box took the caret from whatever the person
  // was typing. Focus that was inside the list goes to the page's main
  // content rather than to <body>.
  const empty = loaded && issues.length === 0;
  useEffect(() => {
    if (!empty) return;
    setOpen(false);
    if (document.activeElement === document.body) {
      document.getElementById("main-content")?.focus({ preventScroll: true });
    }
  }, [empty]);

  // Nothing to say, and nothing said. The header is not the place to
  // announce that an install is fine; the tree and every screen on it
  // already show what is running.
  if (!loaded || issues.length === 0) return null;

  const count = issues.length;
  const blocking = worst === "blocking";
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        ref={button}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={popoverId}
        data-testid="issues-badge"
        data-severity={worst ?? "none"}
        className={`font-ui flex items-center gap-1.5 rounded-[var(--radius)] border px-2.5 py-1 text-sm transition-colors hover:bg-[color:var(--panel-hover)] ${
          blocking
            ? "text-status-error border-[color:var(--status-error-border)]"
            : "text-status-warn border-[color:var(--status-warn-border)]"
        }`}
        title={
          blocking
            ? "Something is stopping this install from working, and it needs you"
            : "Something here will cause trouble later, and it needs you"
        }
      >
        <TriangleAlert size={14} aria-hidden="true" data-icon="TriangleAlert" />
        Needs attention
        <span
          data-testid="issues-count"
          className={`rounded-full px-1.5 text-[0.625rem] font-semibold tabular-nums ${
            blocking
              ? "bg-[color:var(--status-error-border)] text-[color:var(--status-error-fg)]"
              : "bg-[color:var(--status-warn-border)] text-[color:var(--status-warn-fg)]"
          }`}
        >
          {count}
        </span>
      </button>
      {open && (
        <div
          id={popoverId}
          role="region"
          aria-label="Things that need attention"
          data-testid="issues-popover"
          className="absolute right-0 z-30 mt-1 w-96 max-w-[calc(100vw-2rem)] rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-2 shadow-lg"
        >
          <ul className="flex flex-col gap-1">
            {issues.map((issue) => (
              <li key={issue.id}>
                <IssueRow
                  issue={issue}
                  focusUnlock
                  onFollow={() => setOpen(false)}
                  onFixed={async () => {
                    await onFixed?.();
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
