"use client";

import { IssueRow } from "@/components/IssueRow";
import type { Issue } from "@/lib/issues";

/**
 * "Needs attention": the same list as the header badge, on the page a
 * person opens to check in.
 *
 * **It says "nothing" where the badge says nothing at all**, and the
 * difference is deliberate. The header is chrome, mounted on every
 * screen, so an all-clear there would be a permanent decoration that
 * teaches people to stop reading it. Home is where somebody comes to ask
 * *how is it?* — and on that question "nothing needs you" is the answer,
 * not the absence of one. §6.1's wireframe has it beside Running with
 * the word `nothing` in it for exactly that reason.
 *
 * Before the first read it says it is still looking. A card that
 * announced "nothing needs attention" half a second before the list
 * filled would be wrong at the only moment it mattered, which is the
 * failure mode this whole slice exists to remove: §3's top three field
 * failures all report green while the install does not work.
 */
export function NeedsAttentionCard({
  issues,
  loaded,
  onFixed,
}: {
  issues: Issue[];
  loaded: boolean;
  onFixed?: () => void | Promise<void>;
}) {
  const blocking = issues.filter((i) => i.severity === "blocking").length;
  return (
    <section
      data-testid="home-needs-attention"
      data-issue-count={issues.length}
      className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-ui text-base font-semibold">Needs attention</h2>
        {blocking > 0 && (
          <span className="font-ui text-status-error text-sm">
            {blocking === 1
              ? "1 thing is stopping it working"
              : `${blocking} things are stopping it working`}
          </span>
        )}
      </div>
      {!loaded ? (
        <p className="font-ui mt-2 text-sm text-[color:var(--muted)]">Checking…</p>
      ) : issues.length === 0 ? (
        <p className="font-ui mt-2 text-sm text-[color:var(--muted)]">
          Nothing. Everything this install can check is working.
        </p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {issues.map((issue) => (
            <li key={issue.id}>
              <IssueRow
                issue={issue}
                onFixed={async () => {
                  await onFixed?.();
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
