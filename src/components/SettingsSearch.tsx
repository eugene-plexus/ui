"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { describeError } from "@/lib/api";
import { isFieldVisible } from "@/lib/configPresentation";
import { loadConfigTrio, onConfigTrioInvalidated, type ConfigTrio } from "@/lib/configTrio";
import type { Topology } from "@/lib/resourceTree";
import {
  APPEARANCE_SEARCH_TEXTS,
  buildCards,
  elsewhereIndex,
  elsewhereMatches,
  matchesQuery,
  ownersFor,
} from "@/lib/settingsTopics";

import { LayerIcon } from "./LayerIcon";

/** Search the Settings page's fields and elsewhere index, only loading on demand. */
export function SettingsSearch({ topology, ready }: { topology: Topology; ready: boolean }) {
  const router = useRouter();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const [activated, setActivated] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [generation, setGeneration] = useState(0);
  const owners = useMemo(() => ownersFor(null, topology), [topology]);
  const loadKey = JSON.stringify([owners.map((owner) => [owner.id, owner.target]), generation]);
  const [loaded, setLoaded] = useState<{
    key: string;
    trios: Map<string, ConfigTrio>;
    errors: string[];
  } | null>(null);
  const loading = activated && (!ready || loaded?.key !== loadKey);

  useEffect(() => {
    if (!activated) return;
    return onConfigTrioInvalidated(() => setGeneration((value) => value + 1));
  }, [activated]);

  useEffect(() => {
    if (!activated || !ready) return;
    let live = true;
    void Promise.allSettled(owners.map((owner) => loadConfigTrio(owner.target))).then((results) => {
      if (!live) return;
      const trios = new Map<string, ConfigTrio>();
      const errors: string[] = [];
      results.forEach((result, index) => {
        const owner = owners[index]!;
        if (result.status === "fulfilled") trios.set(owner.id, result.value);
        else errors.push(`${owner.label}: ${describeError(result.reason)}`);
      });
      setLoaded({ key: loadKey, trios, errors });
    });
    return () => {
      live = false;
    };
    // Owner labels can change without requiring another schema fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activated, ready, loadKey]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (
        event.key !== "/" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest("input, textarea, select, [role='textbox'], [role='combobox']")))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setExpanded(true);
      setOpen(true);
    }
    // The tree and other composite widgets consume their own key events.
    // Capture the console shortcut before those events reach the widget.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (expanded) input.current?.focus();
  }, [expanded]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
        setExpanded(false);
      }
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const params = new URLSearchParams({ q: query });
    const backends = topology.components
      .filter((component) => component.kind === "inference-driver")
      .map((component) => ({ name: component.name, node: component.node ?? topology.localNode }));
    const elsewhere = elsewhereMatches(elsewhereIndex(backends), query).map((entry) => ({
      id: entry.id,
      label: entry.label,
      location: entry.pageLabel ?? "Settings",
      href: entry.href,
    }));
    const trios = loaded?.key === loadKey ? loaded.trios : new Map<string, ConfigTrio>();
    const schemas = new Map([...trios].map(([owner, trio]) => [owner, trio.schema]));
    const fields = buildCards(owners, schemas, query, {
      visible: (owner, field) =>
        isFieldVisible(field, trios.get(owner.id)?.doc ?? {}, schemas.get(owner.id)?.fields),
    }).flatMap((card) =>
      card.sections.flatMap((section) =>
        section.keys.map((key) => {
          const field = schemas.get(section.owner.id)!.fields.find((field) => field.key === key)!;
          const target = new URLSearchParams(params);
          target.set("sel", section.owner.id);
          return {
            id: `${section.owner.id}:${key}`,
            label: field.label,
            location: `${card.label} · ${section.owner.label}`,
            href: `/config?${target.toString()}#${encodeURIComponent(key)}`,
          };
        }),
      ),
    );
    const appearance = matchesQuery(query, APPEARANCE_SEARCH_TEXTS)
      ? [
          {
            id: "appearance",
            label: "Theme, font size and About",
            location: "Appearance",
            href: `/config?${params.toString()}#appearance`,
          },
        ]
      : [];
    return [...elsewhere, ...fields, ...appearance].slice(0, 8);
  }, [query, topology, owners, loaded, loadKey]);

  const chosen = results[active];
  useEffect(() => {
    if (open && chosen)
      document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, chosen, id, active]);
  function navigate(href: string) {
    setOpen(false);
    setExpanded(false);
    router.push(href);
  }

  return (
    <div
      ref={root}
      className="relative min-w-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setExpanded(false);
        }
      }}
    >
      <button
        ref={toggle}
        type="button"
        aria-label="Find a setting"
        aria-expanded={expanded}
        aria-controls={`${id}-box`}
        onClick={() => {
          setExpanded(true);
          setOpen(true);
          input.current?.focus();
        }}
        className="action-button flex items-center rounded-[var(--radius)] border border-[color:var(--border)] p-1.5 sm:hidden"
      >
        <LayerIcon name="Search" size={16} />
      </button>
      <div
        id={`${id}-box`}
        className={
          expanded
            ? "absolute top-full right-0 z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] sm:static sm:mt-0 sm:w-56"
            : "hidden w-56 sm:block"
        }
      >
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label="Find a setting"
          placeholder="Find a setting"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          aria-activedescendant={open && chosen ? `${id}-option-${active}` : undefined}
          autoComplete="off"
          value={query}
          onFocus={() => {
            setActivated(true);
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              setExpanded(false);
              if (toggle.current?.getClientRects().length) toggle.current.focus();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActive((value) =>
                results.length
                  ? event.key === "ArrowDown"
                    ? (value + 1) % results.length
                    : value <= 0
                      ? results.length - 1
                      : value - 1
                  : -1,
              );
            } else if (event.key === "Enter" && open && results.length) {
              event.preventDefault();
              navigate((chosen ?? results[0])!.href);
            }
          }}
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2.5 py-1 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
        {open && (
          <div className="absolute right-0 z-40 mt-1 w-[min(24rem,calc(100vw-2rem))] rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-1 shadow-lg">
            {loading && (
              <p role="status" className="px-2 py-1 text-sm text-[color:var(--muted)]">
                Loading settings...
              </p>
            )}
            {!loading && loaded?.errors.length ? (
              <p role="status" className="px-2 py-1 text-sm text-[color:var(--status-error-fg)]">
                Could not load settings — {loaded.errors.join("; ")}
              </p>
            ) : null}
            <ul
              id={`${id}-list`}
              role="listbox"
              aria-label="Settings matches"
              className="max-h-[min(28rem,60dvh)] overflow-y-auto"
            >
              {results.map((result, index) => (
                <li
                  key={result.id}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={active === index}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => navigate(result.href)}
                  className={`cursor-pointer rounded-[var(--radius)] px-2 py-1 text-sm hover:bg-[color:var(--panel-hover)] ${active === index ? "bg-[color:var(--panel-hover)]" : ""}`}
                >
                  <span className="block">{result.label}</span>
                  <span className="block text-xs text-[color:var(--muted)]">{result.location}</span>
                </li>
              ))}
            </ul>
            {!loading && query.trim() && !results.length && (
              <p className="px-2 py-1 text-sm text-[color:var(--muted)]">No settings found.</p>
            )}
            {!query.trim() && !loading && (
              <p className="px-2 py-1 text-sm text-[color:var(--muted)]">Type to find a setting.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
