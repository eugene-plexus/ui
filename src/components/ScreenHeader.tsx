"use client";

import { accentVar, activeScreen, layerOf, layersOf, type Screen } from "@/lib/navigation";

import { LayerIcon } from "./LayerIcon";

/**
 * Row 2: this screen's identity and its own controls.
 *
 * The layer breadcrumb is where the architecture page's vocabulary is
 * actually taught, on every screen, without crowding the navigation. On a
 * single-layer screen it is one name; on `/inference` it is the chain
 * `Inference drivers → Engines and backends → Your hardware`, each in its
 * own colour, because that screen's rows join a driver, the backend it
 * fronts and the machine it runs on.
 *
 * **This is the only place `--accent-engine` and `--accent-hardware` are
 * seen outside the layer map panel** — and in both the layer's *name* is
 * written next to its colour, so no reader has to resolve a hue with no
 * label. That matters because `--accent-left` is blue in `modern`, teal
 * in `cyberpunk` and green in `editorial`: the colours are theme-local
 * and the icon is what carries the meaning across a theme switch.
 */
export function ScreenHeader({
  href,
  detail,
  children,
}: {
  href: string;
  detail?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const screen = activeScreen(href);
  if (!screen) {
    // A screen with no registry entry. Rendering a bare bar rather than
    // throwing keeps `degraded-mode-required` honest at the UI layer, and
    // the missing entry is a vitest failure, not a blank page at runtime.
    return null;
  }
  return (
    <header
      data-testid="screen-header"
      data-screen={screen.href}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="font-ui flex shrink-0 items-center gap-2 text-sm font-semibold tracking-wide">
          <LayerIcon name={screen.icon} accent={layerOf(screen.layer).accent} size={16} />
          {screen.label}
        </h1>
        <LayerBreadcrumb screen={screen} />
        {detail}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

function LayerBreadcrumb({ screen }: { screen: Screen }) {
  const layers = layersOf(screen);
  return (
    <p
      data-testid="layer-breadcrumb"
      className="font-ui flex flex-wrap items-center gap-1 text-[11px]"
      title="Where this screen sits in the architecture"
    >
      {layers.map((layer, index) => (
        <span key={layer.id} className="flex items-center gap-1">
          {index > 0 && (
            <span aria-hidden="true" className="text-[color:var(--muted)]">
              →
            </span>
          )}
          <span data-layer={layer.id} style={{ color: accentVar(layer.accent) }}>
            {layer.name}
          </span>
        </span>
      ))}
    </p>
  );
}
