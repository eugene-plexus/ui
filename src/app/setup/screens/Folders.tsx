"use client";

/**
 * Wizard screen 2: where model files should live.
 *
 * Hobbyist UX §6.2. The screen this replaced asked *"Point the library at
 * directories you already keep models in"* and opened with an empty text
 * box — §0.4's measurement: the one question a person who has just
 * installed the thing cannot answer, because they have no files yet. So
 * the default is a folder Eugene offers to make, under the home directory
 * of the machine the library runs on, and the person who does have models
 * says so with the second radio and browses to them.
 *
 * **Nothing is created here.** The library makes a missing destination
 * folder when the first download starts, which is what lets the sentence
 * under the first radio be true; a mkdir from the wizard would be a folder
 * the person did not ask for on every install that then chose the other
 * radio. And the folder stays a plain folder (§10 trap 3): no structure
 * inside it beyond what a publisher named the file.
 *
 * **Whose disk the picker browses.** `FolderPicker` is pointed at the
 * library, because the library's host is where downloads land and where
 * the folders are scanned; on a two-machine install that is not the
 * machine the browser is on, and the picker's header says so.
 *
 * Renders the draft and reports edits upwards; the write is `page.tsx`'s
 * Finish. The picker is the one piece of state kept here, because which
 * row is being browsed for is nobody else's business.
 */

import { useState } from "react";

import { FolderPicker } from "@/components/FolderPicker";

import type { FolderChoice, WizardDraft } from "../draft";

/**
 * What the wizard knows about the folder it would make. `loading` while
 * the library is being asked for its home (it restarts under screen 1's
 * Continue, so this can take a few seconds); `unavailable` when it could
 * not be asked, which disables the first radio rather than proposing a
 * path nobody can vouch for.
 */
export type FolderProposal =
  | { status: "loading" }
  | { status: "ready"; path: string; home: string }
  | { status: "unavailable" };

export function ScreenFolders({
  draft,
  proposal,
  onChange,
}: {
  draft: WizardDraft;
  proposal: FolderProposal;
  onChange: (patch: Partial<WizardDraft>) => void;
}) {
  // Which row Browse… was pressed on; `null` while the picker is closed.
  const [browsing, setBrowsing] = useState<number | null>(null);

  const makeDisabled = proposal.status === "unavailable";
  // Derived, not trusted: the page flips the draft to "own" when the
  // proposal turns out unavailable, and this covers the frame before it.
  const making = draft.folderChoice === "make" && !makeDisabled;
  const homePath = proposal.status === "ready" ? proposal.home : null;
  const editing = draft.customFolder !== null;

  // The rows under "I already have models": at least one, so there is
  // always a box to type into or a Browse… to press.
  const rows = draft.modelRoots.length > 0 ? draft.modelRoots : [""];

  function choose(choice: FolderChoice) {
    onChange({ folderChoice: choice });
  }
  function setRow(index: number, value: string) {
    const next = [...rows];
    next[index] = value;
    onChange({ modelRoots: next });
  }
  function addRow() {
    onChange({ modelRoots: [...rows, ""] });
  }
  function removeRow(index: number) {
    onChange({ modelRoots: rows.filter((_, i) => i !== index) });
  }
  function picked(path: string) {
    if (browsing !== null) setRow(browsing, path);
    setBrowsing(null);
  }

  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Where should models live?</h2>
      <p className="mb-6 text-sm leading-relaxed text-[color:var(--muted)]">
        Eugene keeps model files as plain files with their published names. Move them, delete
        Eugene, they are still yours.
      </p>

      <div
        className={`mb-3 rounded-[var(--radius)] border px-4 py-3 transition-colors ${choiceTone(making, makeDisabled)}`}
      >
        <label
          className={`flex items-start gap-3 ${makeDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
        >
          <input
            type="radio"
            name="folder-choice"
            checked={making}
            disabled={makeDisabled}
            onChange={() => choose("make")}
            className="mt-1 accent-[color:var(--accent-left)]"
          />
          <span className="font-ui text-sm font-medium">Make a folder for me</span>
        </label>
        <div className="mt-1 ml-7">
          {proposal.status === "loading" && (
            <p className="text-xs text-[color:var(--muted)]" data-testid="proposed-folder-loading">
              Looking up your home folder…
            </p>
          )}
          {proposal.status === "unavailable" && (
            <p className="text-xs text-[color:var(--muted)]">
              Eugene could not look up your home folder, so pick or type one below.
            </p>
          )}
          {proposal.status === "ready" && !editing && (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <code data-testid="proposed-folder" className="font-mono text-xs">
                {proposal.path}
              </code>
              <button
                type="button"
                onClick={() => onChange({ folderChoice: "make", customFolder: proposal.path })}
                className={smallButton}
              >
                change
              </button>
            </p>
          )}
          {proposal.status === "ready" && editing && (
            <input
              type="text"
              value={draft.customFolder ?? ""}
              onChange={(e) => onChange({ folderChoice: "make", customFolder: e.target.value })}
              onFocus={() => choose("make")}
              aria-label="Folder to make"
              spellCheck={false}
              className={textInput}
            />
          )}
          {proposal.status !== "unavailable" && (
            <p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">
              Nothing is created until the first download lands there.
            </p>
          )}
        </div>
      </div>

      <div
        className={`mb-3 rounded-[var(--radius)] border px-4 py-3 transition-colors ${choiceTone(!making, false)}`}
      >
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="radio"
            name="folder-choice"
            checked={!making}
            onChange={() => choose("own")}
            className="mt-1 accent-[color:var(--accent-left)]"
          />
          <span className="font-ui text-sm font-medium">I already have models</span>
        </label>
        {!making && (
          <div className="mt-2 ml-7">
            {rows.map((root, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <input
                  type="text"
                  value={root}
                  onChange={(e) => setRow(i, e.target.value)}
                  placeholder="D:\models  or  /home/you/models"
                  aria-label={`Model folder ${i + 1}`}
                  spellCheck={false}
                  className={textInput}
                />
                <button
                  type="button"
                  onClick={() => setBrowsing(i)}
                  aria-label={`Browse for model folder ${i + 1}`}
                  className={smallButton}
                >
                  Browse…
                </button>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    aria-label={`Remove model folder ${i + 1}`}
                    className={smallButton}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addRow} className={smallButton}>
              + Add another folder
            </button>
            <p className="mt-2 text-xs leading-relaxed text-[color:var(--muted)]">
              Folders are read where they are. GGUF and Hugging Face safetensors are both
              recognised.
            </p>
          </div>
        )}
      </div>

      {browsing !== null && (
        <FolderPicker
          target="library"
          initialPath={rows[browsing]?.trim() || homePath}
          onPick={picked}
          onClose={() => setBrowsing(null)}
        />
      )}
    </section>
  );
}

function choiceTone(checked: boolean, disabled: boolean): string {
  if (disabled) return "border-[color:var(--border)] opacity-70";
  return checked
    ? "border-[color:var(--accent-left)] bg-[color:var(--panel-soft)]"
    : "border-[color:var(--border)] hover:border-[color:var(--border-hover)]";
}

const textInput =
  "font-ui flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]";
const smallButton =
  "font-ui shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]";
