/** The look the other doors share, so five forms cannot drift apart. */

export const fieldLabel = "flex flex-col gap-1 text-sm";
export const inputClass =
  "rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 text-sm";
export const textareaClass =
  "w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-2 font-mono text-sm";
export const buttonClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";
export const primaryButtonClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--accent-left)] px-3 py-1 text-sm transition-colors hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";
export const noteClass = "status-warn rounded-[var(--radius)] px-2 py-1 text-sm";
export const errorClass = "status-error rounded-[var(--radius)] px-2 py-1 text-sm";

/** A door's form, persisted per door so a reload keeps what was typed
 * and nothing else. Wrapped because storage can throw or be absent. */
export function readDraft<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? { ...fallback, ...(parsed as Partial<T>) }
      : fallback;
  } catch {
    return fallback;
  }
}

export function writeDraft(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: the form just does not come back.
  }
}
