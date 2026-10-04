"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ConfigEditor, type SectionHandle } from "@/components/ConfigEditor";
import { ConfirmButton } from "@/components/ConfirmButton";
import { useSharedTopology } from "@/components/ResourceTree";
import { UIPreferences } from "@/components/UIPreferences";
import { api, describeError } from "@/lib/api";
import { foldedKeys, isFieldVisible } from "@/lib/configPresentation";
import { loadConfigTrio, onConfigTrioInvalidated } from "@/lib/configTrio";
import { targetFor } from "@/lib/nodeBudget";
import {
  configTabFor,
  parseSelection,
  selectionFromConfigTab,
  type Selection,
  type Topology,
} from "@/lib/resourceTree";
import {
  buildCards,
  elsewhereIndex,
  elsewhereMatches,
  matchesQuery,
  ownersFor,
  type ElsewhereEntry,
  type SettingsOwner,
} from "@/lib/settingsTopics";
import type { ConfigSchema } from "@/lib/types";

/**
 * Settings.
 *
 * **Design:** `specs/docs/design/ui-settings-reorganisation.md`. Troy's
 * report: four minutes to find one setting, because the settings were
 * filed by which process holds them — the gateway's *Lifecycle policy*,
 * the agent's *Node* — and a person looking for "where do downloads go"
 * has to know which process owns the answer before the page can help.
 *
 * So this page shows every setting on the install at once, grouped by
 * **topic** (`lib/settingsTopics.ts`): one card per topic, one section
 * per owner inside it, and a search box at the top that shrinks the page
 * to the answer. A section is the existing `ConfigEditor` restricted to
 * the topic's share of that component, saving on its own; a bar at the
 * foot saves every dirty section in turn. Nothing about how a setting is
 * loaded, validated, refused or restarted changed.
 *
 * **One page, two filters.** Bare, or `?sel=install`, it is everything.
 * `?sel=gateway` (the tree's Gateway → Settings) is the gateway's share
 * of the same cards, so a component's own page is the topic page
 * filtered rather than a second organisation. A backend keeps the plain
 * editor: every one of its fields is about that backend, and it carries
 * the *Runs on* line and *Remove*.
 *
 * **`?tab=` still works**, because it is in shipped builds — the launch
 * panel's "map it" link writes `?tab=node:<name>` — and
 * `selectionFromConfigTab` translates it. `configTabFor` translates
 * back, because the proxy target is still how the editor addresses a
 * component. `#<key>` opens on that field.
 */
export default function ConfigPage() {
  // `useSearchParams` suspends during prerender, so the boundary is
  // required rather than decorative.
  return (
    <Suspense fallback={null}>
      <ConfigPageInner />
    </Suspense>
  );
}

function ConfigPageInner() {
  const searchParams = useSearchParams();
  // Bare `/config` is every setting (2026-09-29); before, this machine's
  // agent, which is what `defaultSelectionFor` also answers now.
  const raw =
    searchParams.get("sel") ?? selectionFromConfigTab(searchParams.get("tab")) ?? "install";
  const selection = parseSelection(raw);
  // The fragment is not a search param and is not on the server; read
  // once the page is in a browser.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    setFocusKey(hash ? decodeURIComponent(hash) : null);
  }, []);

  // The body is a child of the shell, because the topology it reads is
  // the shell's: a page rendering the shell is ABOVE the provider, and
  // the first build of this page read an empty topology forever.
  return (
    <AppShell>
      <ConfigBody
        selection={selection}
        initialQuery={searchParams.get("q") ?? ""}
        focusKey={focusKey}
      />
    </AppShell>
  );
}

function ConfigBody({
  selection,
  initialQuery,
  focusKey,
}: {
  selection: Selection | null;
  initialQuery: string;
  focusKey: string | null;
}) {
  const { topology } = useSharedTopology();

  if (!selection) {
    return (
      <main className="mx-auto w-full max-w-3xl overflow-y-auto px-6 py-8">
        <p className="font-ui text-sm">Nothing selected.</p>
        <p className="mt-2 text-sm text-[color:var(--muted)]">
          This link names something the install does not have. Pick a row in the tree on the left,
          or open{" "}
          <Link href="/config?sel=install" className="underline">
            every setting
          </Link>
          .
        </p>
      </main>
    );
  }

  if (selection.type === "driver") {
    return <BackendSettings selection={selection} topology={topology} focusKey={focusKey} />;
  }

  if (
    selection.type === "app" ||
    selection.type === "backends" ||
    selection.type === "backendsNode"
  ) {
    return (
      <main className="mx-auto w-full max-w-3xl overflow-y-auto px-6 py-8">
        <p className="font-ui text-sm">Nothing to set here.</p>
        <p className="mt-2 text-sm text-[color:var(--muted)]">
          {selection.type === "app"
            ? "An app's settings are on its own page in the tree."
            : "Each backend has its own settings page under Backends; the gateway's serving rules are under Serving & failover in "}
          {selection.type !== "app" && (
            <Link href="/config?sel=install" className="underline">
              Settings
            </Link>
          )}
          {selection.type !== "app" && "."}
        </p>
      </main>
    );
  }

  return (
    <SettingsView
      selection={selection}
      topology={topology}
      initialQuery={initialQuery}
      focusKey={focusKey}
    />
  );
}

/* ───────────────────────────── the topic page ──────────────────────── */

function SettingsView({
  selection,
  topology,
  initialQuery,
  focusKey,
}: {
  selection: Selection;
  topology: Topology;
  initialQuery: string;
  focusKey: string | null;
}) {
  const router = useRouter();
  const owners = useMemo(() => ownersFor(selection, topology), [selection, topology]);
  const ownerKey = owners.map((o) => o.id).join("\n");
  const [query, setQuery] = useState(initialQuery);
  const [schemas, setSchemas] = useState<Map<string, ConfigSchema>>(() => new Map());
  const [docs, setDocs] = useState<Map<string, Record<string, unknown>>>(() => new Map());
  const [failed, setFailed] = useState<Map<string, string>>(() => new Map());
  // Bumped whenever a read may be out of date (any write, anywhere): which
  // fields a `showWhen` shows was decided once, so a save that changed the
  // controlling field left a field that now applies off the page until a
  // reload (settings never lie, 2026-09-30).
  const [generation, setGeneration] = useState(0);
  useEffect(() => onConfigTrioInvalidated(() => setGeneration((g) => g + 1)), []);

  // Every owner's schema, so the page can decide which section gets which
  // field before the sections render. Shared with the sections' own
  // reads through `loadConfigTrio`, so the gateway is asked once.
  useEffect(() => {
    let live = true;
    for (const owner of owners) {
      void loadConfigTrio(owner.target).then(
        (trio) => {
          if (!live) return;
          setSchemas((prev) => new Map(prev).set(owner.id, trio.schema));
          setDocs((prev) => new Map(prev).set(owner.id, trio.doc as Record<string, unknown>));
          setFailed((prev) => {
            if (!prev.has(owner.id)) return prev;
            const next = new Map(prev);
            next.delete(owner.id);
            return next;
          });
        },
        (err: unknown) => {
          if (!live) return;
          setFailed((prev) => new Map(prev).set(owner.id, describeError(err)));
        },
      );
    }
    return () => {
      live = false;
    };
    // Re-read when the set of owners changes or a write may have changed
    // what they say, not when the maps do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey, generation]);

  // The query rides in the URL so a found setting can be linked to, and
  // so Back returns to the search rather than to everything.
  function changeQuery(next: string) {
    setQuery(next);
    const params = new URLSearchParams();
    params.set("sel", formatSel(selection));
    if (next.trim()) params.set("q", next);
    router.replace(`/config?${params.toString()}`, { scroll: false });
  }

  const cards = useMemo(
    () =>
      buildCards(owners, schemas, query, {
        visible: (owner, field) =>
          isFieldVisible(field, docs.get(owner.id) ?? {}, schemas.get(owner.id)?.fields),
        moreKeys: (owner, fields) => foldedKeys(owner.component, fields),
      }),
    [owners, schemas, docs, query],
  );
  const shownTopics = new Set(cards.map((c) => c.topic));

  const everything = selection.type === "install";
  const appearance =
    everything &&
    matchesQuery(query, [
      "Appearance",
      "Theme",
      "Font size",
      "About",
      "this browser",
      "dark",
      "light",
      "plexus",
      "modern",
      "editorial",
      "licence",
      "version",
    ]);

  const backends = useMemo(
    () =>
      topology.components
        .filter((c) => c.kind === "inference-driver")
        .map((c) => ({ name: c.name, node: c.node ?? topology.localNode })),
    [topology],
  );
  const index = useMemo(() => elsewhereIndex(backends), [backends]);
  const seeAlso = (topic: string): ElsewhereEntry[] =>
    everything || query.trim() ? index.filter((e) => e.topic === topic) : [];
  // The rest of the index: what a search matched that no visible card
  // carries, or, with nothing typed, the pages this filtered view leaves
  // out and every backend's own page.
  const elsewhere = elsewhereMatches(index, query).filter(
    (e) => !e.topic || !shownTopics.has(e.topic) || !everything,
  );

  const [handles, setHandles] = useState<Map<string, SectionHandle>>(() => new Map());
  const onSection = useCallback((id: string, handle: SectionHandle | null) => {
    setHandles((prev) => {
      const next = new Map(prev);
      if (handle) next.set(id, handle);
      else next.delete(id);
      return next;
    });
  }, []);
  const dirtySections = [...handles.values()].filter((h) => h.dirty > 0);
  const dirtyTotal = dirtySections.reduce((n, h) => n + h.dirty, 0);
  const [savingAll, setSavingAll] = useState(false);
  async function saveAll() {
    setSavingAll(true);
    try {
      for (const h of dirtySections) await h.save();
    } finally {
      setSavingAll(false);
    }
  }
  function discardAll() {
    for (const h of dirtySections) h.discard();
  }

  const loaded = owners.filter((o) => schemas.has(o.id) || failed.has(o.id)).length;
  const nothing = cards.length === 0 && !appearance && elsewhere.length === 0;
  const scope = scopeSentence(selection, owners);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-2">
          <input
            type="search"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            placeholder="Find a setting…"
            aria-label="Find a setting"
            data-testid="settings-search"
            className="font-ui min-w-[220px] flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--border-hover)] sm:max-w-md"
          />
          <span className="text-sm text-[color:var(--muted)]" data-testid="settings-scope">
            {scope}
            {!everything && (
              <>
                {" · "}
                <Link href="/config?sel=install" className="underline">
                  every setting
                </Link>
              </>
            )}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4" data-testid="settings-scroll">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
            {cards.map((card) => (
              <section
                key={card.topic}
                data-testid="settings-card"
                data-topic={card.topic}
                className="section-panel"
              >
                <h2 className="section-heading font-ui text-base font-semibold">{card.label}</h2>
                {card.blurb && (
                  <p className="mt-0.5 mb-3 text-sm text-[color:var(--muted)]">{card.blurb}</p>
                )}
                <div className="flex flex-col gap-4">
                  {card.sections.map((section) => (
                    <ConfigEditor
                      key={section.owner.id}
                      target={section.owner.target}
                      label={section.owner.label}
                      hint={section.owner.hint}
                      only={section.keys}
                      compact
                      expandMore={section.matchedHidden}
                      focusKey={focusKey}
                      sectionId={`${section.owner.id}\n${card.topic}`}
                      onSection={onSection}
                    />
                  ))}
                </div>
                <SeeAlso entries={seeAlso(card.topic)} />
              </section>
            ))}

            {appearance && (
              <section
                data-testid="settings-card"
                data-topic="appearance"
                className="section-panel p-0"
              >
                <UIPreferences />
              </section>
            )}

            {[...failed.entries()].map(([id, error]) => {
              const owner = owners.find((o) => o.id === id);
              return (
                <p
                  key={id}
                  role="alert"
                  data-testid="settings-owner-failed"
                  className="status-error rounded-[var(--radius)] border px-3 py-2 text-sm"
                >
                  Could not read the settings of{" "}
                  <span className="font-semibold">{owner?.label ?? id}</span>: {error}
                </p>
              );
            })}

            {elsewhere.length > 0 && (
              <section data-testid="settings-elsewhere" className="section-panel border-dashed">
                <h2 className="section-heading font-ui text-base font-semibold">On other pages</h2>
                <p className="mt-0.5 mb-2 text-sm text-[color:var(--muted)]">
                  Settings that live where the thing they change is.
                </p>
                <ul className="flex flex-col gap-1.5">
                  {elsewhere.map((e) => (
                    <li key={e.id} className="text-sm">
                      <Link href={e.href} className="underline" data-testid="elsewhere-link">
                        {e.label}
                      </Link>
                      <span className="text-[color:var(--muted)]"> — {e.description}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {loaded < owners.length && failed.size === 0 && cards.length === 0 && (
              <p className="text-sm text-[color:var(--muted)]">Reading settings…</p>
            )}
            {loaded === owners.length && nothing && (
              <p className="text-sm text-[color:var(--muted)]" data-testid="settings-nothing">
                Nothing matches &ldquo;{query}&rdquo;.
              </p>
            )}
          </div>
        </div>

        {dirtyTotal > 0 && (
          <div
            data-testid="save-all-bar"
            className="flex flex-wrap items-center justify-end gap-3 border-t border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-2"
          >
            <span className="text-sm text-[color:var(--muted)]">
              {dirtyTotal} unsaved {dirtyTotal === 1 ? "change" : "changes"}
              {dirtySections.length > 1 ? ` in ${dirtySections.length} sections` : ""}
            </span>
            <ConfirmButton
              label="Discard all"
              confirmLabel="Discard every change"
              prompt="Put every field on this page back as it was saved?"
              onConfirm={discardAll}
              disabled={savingAll}
              testId="discard-all"
              className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30"
            />
            <button
              type="button"
              onClick={() => void saveAll()}
              disabled={savingAll}
              data-testid="save-all"
              className="action-button action-button--primary font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {savingAll ? "Saving…" : dirtySections.length > 1 ? "Save all" : "Save"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function SeeAlso({ entries }: { entries: ElsewhereEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <ul
      className="mt-3 flex flex-col gap-1 border-t border-[color:var(--border)] pt-2"
      data-testid="see-also"
    >
      {entries.map((e) => (
        <li key={e.id} className="text-sm">
          <Link href={e.href} className="underline">
            {e.label}
          </Link>
          <span className="text-[color:var(--muted)]"> — {e.description}</span>
        </li>
      ))}
    </ul>
  );
}

function formatSel(selection: Selection): string {
  switch (selection.type) {
    case "install":
    case "gateway":
    case "library":
    case "control":
      return selection.type;
    case "agent":
      return selection.node ? `agent:${selection.node}` : "agent";
    case "libraryNode":
      return selection.node ? `library:node:${selection.node}` : "library:node";
    default:
      return "install";
  }
}

function scopeSentence(selection: Selection, owners: SettingsOwner[]): string {
  if (selection.type === "install") {
    const machines = owners.filter((o) => o.component === "agent").length;
    return machines > 1
      ? `Every setting on the install, across ${machines} machines`
      : "Every setting on the install";
  }
  const owner = owners[0];
  if (!owner) return "";
  return owner.component === "agent"
    ? `${owner.label} only`
    : `The ${owner.label.toLowerCase()} only`;
}

/* ─────────────────────────────── a backend ─────────────────────────── */

/**
 * A backend's settings: the plain editor, because every field is about
 * that backend, plus which machine it runs on and the way to remove it.
 */
function BackendSettings({
  selection,
  topology,
  focusKey,
}: {
  selection: Selection;
  topology: Topology;
  focusKey: string | null;
}) {
  const router = useRouter();
  const localNode = topology.localNode;
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const target = configTabFor(selection, localNode) ?? "agent";
  const declared = topology.components.find(
    (c) => (c.kind === "inference-driver" || c.kind === "tool-driver") && c.name === selection.name,
  );
  const node = selection.node ?? declared?.node ?? localNode;
  // A search account (P8) is removed the same way, and called what it is.
  const search = declared?.kind === "tool-driver";
  const multiNode = topology.nodes.length > 1;
  const label =
    multiNode && node ? `${selection.name ?? "Backend"} @ ${node}` : (selection.name ?? "Backend");
  const elsewhere = node !== null && node !== localNode;

  /**
   * Remove an inference-driver from the install.
   *
   * `DELETE /v1/components/{name}` has existed on the agent since M0 and
   * stops the process as it forgets the declaration; nothing in the UI
   * had ever called it. The first operator to try removed an Ollama
   * driver by killing the process, and the supervisor respawned it --
   * which is what supervision is for, and exactly why the declaration
   * has to go rather than the process. Sent to the agent that owns the
   * driver, which may be another node.
   */
  async function removeDriver() {
    if (!selection.name) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await api.delete<void>(
        targetFor(node, localNode),
        `/v1/components/${encodeURIComponent(selection.name)}`,
      );
      // The object this page was about no longer exists, so the tree has
      // to be rebuilt and the selection has to move somewhere real.
      router.push("/inference?sel=backends");
    } catch (e) {
      setRemoveError(describeError(e));
      setRemoving(false);
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        {removeError && (
          <div role="alert" className="status-error border-b px-4 py-2 text-sm">
            {removeError}
          </div>
        )}
        {/* Which machine these settings are about. Every path in a
            component's config is a path on the host that component runs
            on -- inside its container, if it runs in one -- and on an
            install that spans hosts that is frequently not the machine
            the browser is on. */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-2 text-sm text-[color:var(--muted)]">
          <span>
            {node ? (
              <>
                Runs on <span className="font-mono">{node}</span>
                {elsewhere ? " — not the machine you are browsing from" : " — this machine"}. Paths
                in these settings are paths on that host, inside its container if it runs in one.
              </>
            ) : (
              <>Runs on this machine.</>
            )}
          </span>
          {/* Asked inline, like every other irreversible action here;
              this was the browser's modal dialog. */}
          <ConfirmButton
            label={
              removing ? "removing…" : search ? "Remove this search account" : "Remove this backend"
            }
            prompt={
              search
                ? "Its process stops and no search runs on it. The provider account itself is untouched."
                : "Its process stops and nothing is routed to it. What it fronts is untouched."
            }
            onConfirm={removeDriver}
            disabled={removing}
            className="action-button action-button--danger action-button--compact font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[0.6875rem] transition-colors hover:border-[color:var(--status-error-border)] hover:text-[color:var(--status-error-fg)] disabled:opacity-30"
            title="Stops the driver's process and forgets its declaration. What it fronts is untouched."
            testId="remove-driver"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <ConfigEditor key={target} target={target} label={label} focusKey={focusKey} />
        </div>
      </div>
    </>
  );
}
