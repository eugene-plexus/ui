"use client";

import Link from "next/link";

import {
  accentVar,
  LAYERS,
  SCREENS,
  type Layer,
  type LayerId,
  type Screen,
} from "@/lib/navigation";

import { Attribution } from "./Attribution";
import { Glossary } from "./Glossary";
import { LayerIcon } from "./LayerIcon";

/**
 * The architecture page's diagram, with this UI's screens placed in it.
 *
 * The navigation bar is the fast path for someone who already knows where
 * things are. This is the artifact that teaches: five layers stacked in
 * the request path, three services beside them, every screen sitting in
 * the layer it belongs to. Someone who read
 * `https://eugeneplexus.com/architecture` an hour ago should recognise
 * this picture and be able to finish the sentence "so Metrics must be…".
 *
 * It renders from the same registry the bar renders from, so the two
 * cannot describe the system differently.
 *
 * A disclosure, not a route: no URL, no history entry. `Escape` closes it
 * and `AppShell` returns focus to the toggle.
 */
export function LayerMap({
  id,
  current,
  onClose,
}: {
  id: string;
  current: Screen | null;
  onClose: () => void;
}) {
  const path = LAYERS.filter((l) => l.side === "path");
  const beside = LAYERS.filter((l) => l.side === "beside");

  return (
    <nav
      id={id}
      aria-label="The system, by layer"
      data-testid="layer-map"
      className="max-h-[70dvh] shrink-0 overflow-y-auto border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-4"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-ui text-xs text-[color:var(--muted)]">
          Requests flow through the layers on the left. The services on the right manage models,
          machines, and access.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="font-ui shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] px-2.5 py-1 text-xs text-[color:var(--muted)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] hover:text-[color:var(--foreground)]"
        >
          Close
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ol className="flex flex-col gap-1.5">
          {path.map((layer) => (
            <li key={layer.id}>
              <LayerCard layer={layer} current={current} />
            </li>
          ))}
        </ol>
        <ul className="flex flex-col gap-1.5">
          {beside.map((layer) => (
            <li key={layer.id}>
              <LayerCard layer={layer} current={current} dashed />
            </li>
          ))}
        </ul>
      </div>

      <p className="font-ui mt-3 text-[0.6875rem] text-[color:var(--muted)]">
        Select a component in the tree, then open Config to change its settings on that machine.
      </p>
      <Glossary />

      {/* The foot of the panel that explains what this thing is, which
          is where someone asking "what IS this" has already arrived. */}
      <Attribution className="mt-3 border-t border-[color:var(--border)] pt-3 text-[0.625rem]" />
    </nav>
  );
}

function LayerCard({
  layer,
  current,
  dashed = false,
}: {
  layer: Layer;
  current: Screen | null;
  dashed?: boolean;
}) {
  const homes = SCREENS.filter((s) => s.layer === layer.id);
  const visitors = SCREENS.filter((s) => s.spans.includes(layer.id));

  return (
    <div
      data-layer={layer.id}
      className={`rounded-[var(--radius)] border-l-4 bg-[color:var(--panel)] px-3 py-2 ${
        dashed
          ? "border-y border-r border-dashed border-[color:var(--border-hover)]"
          : "border-y border-r border-[color:var(--border)]"
      }`}
      style={{ borderLeftColor: accentVar(layer.accent) }}
    >
      <p className="font-ui flex items-center gap-2 text-xs font-semibold">
        <LayerIcon name={layer.icon} accent={layer.accent} size={15} />
        {layer.name}
      </p>
      <p className="mt-1 text-[0.6875rem] leading-relaxed text-[color:var(--muted)]">
        {layer.blurb}
      </p>
      {(homes.length > 0 || visitors.length > 0) && (
        <ul className="mt-2 flex flex-wrap items-center gap-1.5">
          {homes.map((screen) => (
            <li key={screen.href}>
              <MapLink screen={screen} layer={layer.id} current={current} />
            </li>
          ))}
          {visitors.map((screen) => (
            <li key={screen.href}>
              <MapLink screen={screen} layer={layer.id} current={current} visiting />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MapLink({
  screen,
  layer,
  current,
  visiting = false,
}: {
  screen: Screen;
  layer: LayerId;
  current: Screen | null;
  visiting?: boolean;
}) {
  const active = current?.href === screen.href;
  return (
    <Link
      href={screen.href}
      data-map-screen={screen.href}
      data-map-layer={layer}
      aria-current={active ? "page" : undefined}
      title={screen.blurb}
      className={`font-ui flex items-center gap-1.5 rounded-[var(--radius)] border px-2 py-0.5 text-[0.6875rem] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] ${
        visiting
          ? "border-dashed border-[color:var(--border)] text-[color:var(--muted)]"
          : "border-[color:var(--border)]"
      } ${active ? "font-semibold" : ""}`}
    >
      <LayerIcon name={screen.icon} size={13} />
      {screen.label}
      {active && <span className="text-[color:var(--muted)]">· here</span>}
    </Link>
  );
}
