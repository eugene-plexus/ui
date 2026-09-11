"use client";

/**
 * Wizard screen: Local-only display preferences: theme and font size.
 *
 * One screen per module since M9. Nothing here reads or writes the
 * install - a screen renders the draft and reports edits upwards, and
 * every write happens once, in `page.tsx`, when Start is pressed.
 */

import { FONT_SIZE_LABELS, useFontSize, type FontSize } from "@/lib/useFontSize";
import { useTheme, type Theme } from "@/lib/useTheme";

import { Field } from "../fields";

export function ScreenLookFeel() {
  const [theme, setTheme] = useTheme();
  const [fontSize, setFontSize] = useFontSize();
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Look &amp; feel</h2>
      <p className="mb-6 text-sm text-[color:var(--muted)]">
        These choices apply immediately so the rest of setup is comfortable to read. You can change
        them later from the Config page.
      </p>
      <Field
        label="Theme"
        description="Visual style. System follows your OS dark / light preference and updates live."
      >
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
          aria-label="Theme"
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm transition-colors outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]"
        >
          <option value="cyberpunk">Cyberpunk (dark)</option>
          <option value="modern">Modern (light)</option>
          <option value="system">System</option>
        </select>
      </Field>
      <Field label="Font size" description="Scales chat content and most UI chrome.">
        <select
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value as FontSize)}
          aria-label="Font size"
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm transition-colors outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]"
        >
          {(Object.keys(FONT_SIZE_LABELS) as FontSize[]).map((k) => (
            <option key={k} value={k}>
              {FONT_SIZE_LABELS[k]}
            </option>
          ))}
        </select>
      </Field>
    </section>
  );
}
