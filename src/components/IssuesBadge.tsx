"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { unlockControlRoot } from "@/lib/controlUnlock";
import type { Issue, IssueSeverity } from "@/lib/issues";
import { getSessionToken } from "@/lib/session";
import { useIssues } from "@/lib/useIssues";

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
 * with the unlock as its action, **from any page**". Everything else
 * links to the screen that owns the remedy, because a one-click fix for
 * something with consequences belongs beside the words that explain
 * them — but a locked root is the case where every other screen is
 * already useless, so sending the person somewhere else to type a
 * passphrase is sending them through a door that is shut. It reuses
 * `lib/controlUnlock.ts`, which posts to control with the session token
 * as an explicit `bearer` so a wrong passphrase cannot clear the
 * session.
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
        className={`font-ui flex items-center gap-1.5 rounded-[var(--radius)] border px-2.5 py-1 text-xs transition-colors hover:bg-[color:var(--panel-hover)] ${
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
          className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
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

function IssueRow({
  issue,
  onFollow,
  onFixed,
}: {
  issue: Issue;
  onFollow: () => void;
  onFixed: () => Promise<void>;
}) {
  const toneClass = issue.severity === "blocking" ? "text-status-error" : "text-status-warn";
  return (
    <div
      data-testid="issue-row"
      data-issue-kind={issue.kind}
      data-issue-severity={issue.severity}
      className="rounded-[var(--radius)] px-2 py-1.5"
    >
      <p className={`font-ui text-xs font-semibold ${toneClass}`}>{issue.title}</p>
      {/* Never truncated. This is the sentence that says what to do, and
          it is read by somebody who is already unhappy. */}
      <p className="mt-0.5 text-[11px] text-[color:var(--muted)]">{issue.detail}</p>
      {issue.action === "unlock-control-root" ? (
        <UnlockForm onFixed={onFixed} />
      ) : (
        <Link
          href={issue.href}
          onClick={onFollow}
          className="font-ui mt-1 inline-block text-[11px] underline underline-offset-2 hover:text-[color:var(--foreground)]"
        >
          Go and fix it
        </Link>
      )}
    </div>
  );
}

/**
 * The passphrase, typed where the problem is reported.
 *
 * A sealed root holds the install's signing key shut; it is not a
 * password prompt for this browser, and the session is already good, so
 * a failure here means the root holds a *different* passphrase — which
 * is a real and confusing state (a re-initialized side) and is named as
 * such rather than as "wrong password".
 */
function UnlockForm({ onFixed }: { onFixed: () => Promise<void> }) {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fieldId = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || passphrase === "") return;
    setBusy(true);
    setProblem(null);
    const token = getSessionToken();
    const outcome = token ? await unlockControlRoot(passphrase, token) : ("unavailable" as const);
    if (outcome === "unlocked") {
      setPassphrase("");
      // The issue disappears when the next read finds the root open, and
      // that read is pulled forward rather than waited for.
      await onFixed();
    } else if (outcome === "mismatch") {
      setProblem(
        "That is not the passphrase this control root holds. It is the one that was set when " +
          "this install was created, which is not always the one you sign in with.",
      );
    } else {
      setProblem("The control root did not answer. Check that the machine holding it is running.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-1.5 flex flex-col gap-1">
      <label htmlFor={fieldId} className="sr-only">
        Passphrase for the control root
      </label>
      <div className="flex items-center gap-1">
        <input
          id={fieldId}
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="off"
          placeholder="Passphrase"
          data-testid="issues-unlock-passphrase"
          className="font-ui min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--background)] px-2 py-1 text-xs"
        />
        <button
          type="submit"
          disabled={busy || passphrase === ""}
          data-testid="issues-unlock-submit"
          className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-xs transition-colors hover:bg-[color:var(--panel-hover)] disabled:opacity-50"
        >
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </div>
      {problem && (
        <p data-testid="issues-unlock-problem" className="text-status-error text-[11px]">
          {problem}
        </p>
      )}
    </form>
  );
}
