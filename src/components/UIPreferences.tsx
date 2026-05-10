"use client";

import { useFontSize, FONT_SIZE_LABELS, type FontSize } from "@/lib/useFontSize";
import { useTheme, type Theme } from "@/lib/useTheme";

/**
 * Local UI preferences. Lives in /config alongside the per-component
 * backend configs but doesn't talk to any backend — these settings
 * persist to `localStorage` only and don't affect any other operator
 * using the same Eugene Plexus deployment.
 */
export function UIPreferences() {
  const [theme, setTheme] = useTheme();
  const [fontSize, setFontSize] = useFontSize();

  return (
    <div className="overflow-y-auto p-6">
      <h2 className="font-ui mb-1 text-lg font-semibold">UI</h2>
      <p className="mb-4 text-xs text-[color:var(--muted)]">
        Local preferences. Saved to your browser; not synced anywhere.
      </p>

      <Row
        label="Theme"
        description="Visual style for the entire UI. System follows your OS dark / light preference and updates live when it changes."
      >
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
          aria-label="Theme"
          className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none transition-colors hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]"
        >
          <option value="cyberpunk">Cyberpunk</option>
          <option value="modern">Modern</option>
          <option value="system">System</option>
        </select>
      </Row>

      <Row
        label="Font size"
        description="Scales chat content, hemisphere output, and most chrome. Independent of theme."
      >
        <select
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value as FontSize)}
          aria-label="Font size"
          className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none transition-colors hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]"
        >
          {(Object.keys(FONT_SIZE_LABELS) as FontSize[]).map((k) => (
            <option key={k} value={k}>
              {FONT_SIZE_LABELS[k]}
            </option>
          ))}
        </select>
      </Row>
    </div>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[200px_1fr] items-start gap-4 border-b border-[color:var(--border)] py-3">
      <div>
        <label className="font-ui block text-sm font-medium">{label}</label>
        <p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">{description}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}
