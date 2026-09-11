"use client";

/**
 * Wizard screen: The directories the operator's model files already live in.
 *
 * One screen per module since M9. Nothing here reads or writes the
 * install - a screen renders the draft and reports edits upwards, and
 * every write happens once, in `page.tsx`, when Start is pressed.
 */

/**
 * Where the operator's models already live.
 *
 * This replaced a Driver screen. A driver fronts exactly one backend, and
 * since M6 the agent declares one per runtime automatically - so at first-run
 * time there is no driver to configure and no way to make one, which is
 * exactly what the old screen kept asking about.
 *
 * What genuinely cannot be guessed is where the operator keeps their models.
 * Nothing here moves, renames or copies a file: the library scans these
 * directories in place. Delete us and the models are still there, correctly
 * named, where they were put.
 */
export function ScreenModels({
  roots,
  onChange,
}: {
  roots: string[];
  onChange: (roots: string[]) => void;
}) {
  const rows = roots.length > 0 ? roots : [""];

  function setAt(index: number, value: string) {
    const next = [...rows];
    next[index] = value;
    onChange(next);
  }
  function addRow() {
    onChange([...rows, ""]);
  }
  function removeAt(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Your models</h2>
      <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
        Point the library at directories you already keep models in. They are scanned where they are
        &mdash; nothing is moved, renamed or copied, and downloads land in these same directories as
        plainly-named files.
      </p>
      {rows.map((root, i) => (
        <div key={i} className="mb-2 flex gap-2">
          <input
            type="text"
            value={root}
            onChange={(e) => setAt(i, e.target.value)}
            placeholder="D:\models  or  /home/you/models"
            aria-label={`Model directory ${i + 1}`}
            className="font-ui flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
          />
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={`Remove model directory ${i + 1}`}
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="font-ui mb-4 rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
      >
        + Add another directory
      </button>
      <p className="text-xs leading-relaxed text-[color:var(--muted)]">
        You can skip this. Directories can be added later from Config, and Discover downloads into
        one of them. GGUF and Hugging Face safetensors are both recognised.
      </p>
    </section>
  );
}
