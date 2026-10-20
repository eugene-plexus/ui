"use client";

import Link from "next/link";

import { contextLabel } from "@/lib/starter";
import { PLANNED_CONTEXT_HREF, usePlannedContext } from "@/lib/plannedContext";

/**
 * "Judged at 16k of conversation" beside a fit verdict, with the way to the
 * one setting it comes from (CX4). Says nothing until the Library answers,
 * rather than a number that may not be the one in effect.
 */
export function PlannedContextNote({ className = "" }: { className?: string }) {
  const planned = usePlannedContext();
  if (planned === null) return null;
  return (
    <p
      className={`text-[0.6875rem] text-[color:var(--muted)] ${className}`}
      data-testid="planned-context"
    >
      Judged at {contextLabel(planned)} of conversation, the context you plan for.{" "}
      <Link href={PLANNED_CONTEXT_HREF} className="underline">
        Change
      </Link>
    </p>
  );
}
