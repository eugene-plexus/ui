"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  ENGINE_FIT_CLASS,
  LEVEL_CLASS,
  LEVEL_SHORT,
  LEVEL_WORDS,
  fitLine,
  verdictLine,
  type ModelEligibility,
} from "@/lib/eligibility";
import { engineName } from "@/lib/issues";

/**
 * Troy's three-level dot (L5) on a model not downloaded yet, and what each
 * engine said of it (library-sources-and-engines.md §4.3, LS2).
 *
 * The dot never stands alone: its words are beside it, and pressing it
 * opens the engines' verdicts, each with its reason in the Library's words
 * and whether that engine is on the machine in the picker. An answer the
 * Library marked approximate says so beside the words, never only inside.
 * Since LS6 each engine's own fit is under its verdict, named, where the
 * Library was asked for it.
 */
export function EligibilityDot({
  answer,
  where,
  short = false,
  guessNote,
}: {
  answer: ModelEligibility;
  /** The machine the verdicts are about, by name. */
  where: string;
  /** A list row's short words; the full phrase otherwise. */
  short?: boolean;
  /** What "approximate" means here, said at the top of the popover. */
  guessNote?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const panel = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const words = short ? LEVEL_SHORT[answer.level] : LEVEL_WORDS[answer.level];
  return (
    <span ref={box} className="relative inline-block" data-testid="eligibility-dot">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        title={LEVEL_WORDS[answer.level]}
        data-level={answer.level}
        onClick={(event) => {
          // Inside a row that is itself a target: the dot is its own control.
          event.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`${LEVEL_CLASS[answer.level]} font-ui inline-flex items-center gap-1 rounded px-1 text-left ${
          short ? "text-[0.625rem]" : "text-[0.6875rem]"
        }`}
      >
        <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
        <span>{words}</span>
        {answer.approximate && (
          <span data-testid="eligibility-approximate" className="opacity-80">
            {short ? "(approx.)" : "(approximate)"}
          </span>
        )}
      </button>
      {open && (
        <span
          id={panel}
          role="dialog"
          aria-label={`Which engines can run it on ${where}`}
          className="absolute right-0 z-20 mt-1 block w-[min(26rem,80vw)] rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-2 text-left text-[0.6875rem] text-[color:var(--foreground)] shadow-lg"
        >
          <span className={`${LEVEL_CLASS[answer.level]} block font-semibold`}>
            {LEVEL_WORDS[answer.level]}
          </span>
          {answer.approximate && guessNote && (
            <span className="mt-1 block text-[color:var(--muted)]">{guessNote}</span>
          )}
          <span className="mt-1 block space-y-0.5" data-testid="eligibility-verdicts">
            {answer.engines.map((v) => {
              const fit = fitLine(v, engineName);
              return (
                <span key={v.engine} className="block">
                  {verdictLine(v, where, engineName)}
                  {fit && (
                    <span
                      data-testid="eligibility-fit"
                      className={`block pl-3 ${
                        v.fit?.estimated && v.fit.verdict
                          ? ENGINE_FIT_CLASS[v.fit.verdict]
                          : "text-[color:var(--muted)]"
                      }`}
                    >
                      fit, {fit}
                    </span>
                  )}
                </span>
              );
            })}
          </span>
        </span>
      )}
    </span>
  );
}
