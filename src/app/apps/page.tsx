"use client";

/**
 * Apps: what each machine can install, and what it has.
 *
 * **Design:** `specs/docs/design/apps-and-spokes.md`. An app is an
 * optional program an agent installs and runs -- a chat app, the Discord
 * connector -- holding one client key and nothing else, so it reaches the
 * hub exactly the way any other app a person connects does.
 *
 * One page for the whole install, with a machine picker for installing,
 * because apps live on machines and the question "where should this run"
 * belongs next to the Install button, the way Library's launch picker
 * does. Every read and action goes to that machine's own agent, through
 * `node:<name>` for another machine (`one-console-never-hop-nodes`).
 *
 * **Open always leaves this page.** An app's UI runs on its own port --
 * its own browser origin -- and is never framed here, because this
 * origin holds the operator's session.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ConfirmButton } from "@/components/ConfirmButton";
import { api, describeError } from "@/lib/api";
import {
  agentTarget,
  describeApp,
  describeInstall,
  installErrorSummary,
  installFinished,
  openTarget,
  updateAvailable,
} from "@/lib/apps";
import type {
  App,
  AppCatalogue,
  AppCatalogueEntry,
  AppInstall,
  AppList,
  AppManifest,
  NodeIdentity,
} from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const INSTALL_POLL_MS = 1000;
const LIST_POLL_MS = 5000;

const buttonClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2.5 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40";
const primaryClass =
  "font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";
const inputClass =
  "w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 font-mono text-sm outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]";

interface InstalledRow {
  machine: string | null;
  app: App;
}

/** This machine's name and every other machine the root knows. Soft. */
function useMachines(): { localNode: string | null; machines: (string | null)[] } {
  const [state, setState] = useState<{ localNode: string | null; machines: (string | null)[] }>({
    localNode: null,
    machines: [null],
  });
  const load = useCallback(async () => {
    const [node, nodes] = await Promise.all([
      api.get<NodeIdentity>("agent", "/v1/node").catch(() => null),
      api.get<{ nodes?: { name?: unknown }[] }>("control", "/v1/nodes").catch(() => null),
    ]);
    const local = node?.name ?? null;
    const others = (nodes?.nodes ?? [])
      .map((n) => n.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0 && n !== local)
      .sort((a, b) => a.localeCompare(b));
    const next = { localNode: local, machines: [local, ...others] };
    setState((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);
  usePolling(load, 30_000);
  return state;
}

export default function AppsPage() {
  const { localNode, machines } = useMachines();
  const [installed, setInstalled] = useState<InstalledRow[] | null>(null);
  const [machine, setMachine] = useState<string | null | undefined>(undefined);
  const chosen = machine === undefined ? localNode : machine;

  const loadInstalled = useCallback(async () => {
    const lists = await Promise.all(
      machines.map((m) =>
        api
          .get<AppList>(agentTarget(m, localNode), "/v1/apps")
          .then((l) => (l.apps ?? []).map((app) => ({ machine: app.node ?? m, app })))
          .catch(() => [] as InstalledRow[]),
      ),
    );
    setInstalled(lists.flat());
  }, [machines, localNode]);
  usePolling(loadInstalled, LIST_POLL_MS);

  const pageHost = typeof window === "undefined" ? "localhost" : window.location.hostname;

  return (
    <AppShell>
      <main data-testid="apps-scroll" className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-8">
          <p className="text-sm text-[color:var(--muted)]">
            Apps are optional programs a machine in this install can run for you, like a chat app.
            Each one gets its own key and talks to your models the same way any other app does.
            Remove one at any time and its key stops working. Keys are listed with the rest on{" "}
            <Link href="/" className="underline">
              Home
            </Link>
            .
          </p>

          <section aria-labelledby="installed-heading" className="flex flex-col gap-3">
            <h2 id="installed-heading" className="font-ui text-base font-semibold">
              Installed
            </h2>
            {installed === null ? (
              <p className="font-ui text-sm text-[color:var(--muted)]">Loading…</p>
            ) : installed.length === 0 ? (
              <p className="text-sm text-[color:var(--muted)]" data-testid="apps-none-installed">
                No apps are installed on any machine yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="apps-installed">
                {installed.map(({ machine: m, app }) => (
                  <InstalledApp
                    key={`${app.id}@${m ?? ""}`}
                    app={app}
                    machine={m}
                    showMachine={machines.length > 1}
                    pageHost={pageHost}
                  />
                ))}
              </ul>
            )}
          </section>

          <Catalogue
            machines={machines}
            localNode={localNode}
            chosen={chosen}
            onChoose={setMachine}
            onChanged={loadInstalled}
          />
        </div>
      </main>
    </AppShell>
  );
}

function InstalledApp({
  app,
  machine,
  showMachine,
  pageHost,
}: {
  app: App;
  machine: string | null;
  showMachine: boolean;
  pageHost: string;
}) {
  const state = describeApp(app);
  const open = openTarget(app, pageHost);
  const sel = machine ? `app:${app.id}@${machine}` : `app:${app.id}`;
  const toneClass =
    state.tone === "error"
      ? "status-error"
      : state.tone === "warn"
        ? "status-warn"
        : state.tone === "ok"
          ? "status-success"
          : "text-[color:var(--muted)]";
  return (
    <li
      className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2"
      data-testid="apps-installed-row"
    >
      <Link
        href={`/apps/app?sel=${encodeURIComponent(sel)}`}
        className="font-ui min-w-0 font-semibold underline"
      >
        {app.name}
      </Link>
      {showMachine && machine && (
        <span className="font-ui text-sm text-[color:var(--muted)]">on {machine}</span>
      )}
      <span className="font-mono text-sm text-[color:var(--muted)]">{app.version}</span>
      <span className={`font-ui rounded-[var(--radius)] px-1.5 text-sm ${toneClass}`}>
        {state.text}
      </span>
      {open.href && app.enabled && (
        <a
          href={open.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`${buttonClass} ml-auto`}
          title={open.note ?? "Opens in a new tab, on the app's own address."}
        >
          Open ↗
        </a>
      )}
    </li>
  );
}

function Catalogue({
  machines,
  localNode,
  chosen,
  onChoose,
  onChanged,
}: {
  machines: (string | null)[];
  localNode: string | null;
  chosen: string | null;
  onChoose: (m: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const target = agentTarget(chosen, localNode);
  const [catalogue, setCatalogue] = useState<AppCatalogue | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installs, setInstalls] = useState<Record<string, AppInstall>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await api.get<AppCatalogue>(target, "/v1/app-catalogue");
      if (!live.current) return;
      setCatalogue(next);
      setLoadError(null);
    } catch (e) {
      if (!live.current) return;
      setCatalogue(null);
      setLoadError(describeError(e));
    }
  }, [target]);

  useEffect(() => {
    setCatalogue(null);
    setInstalls({});
    void load();
  }, [load]);

  async function watch(id: string) {
    for (;;) {
      await new Promise((r) => setTimeout(r, INSTALL_POLL_MS));
      if (!live.current) return;
      let snapshot: AppInstall;
      try {
        snapshot = await api.get<AppInstall>(target, `/v1/apps/${id}/install`);
      } catch (e) {
        setActionError(describeError(e));
        return;
      }
      setInstalls((prev) => ({ ...prev, [id]: snapshot }));
      if (installFinished(snapshot)) {
        await Promise.all([load(), onChanged()]);
        return;
      }
    }
  }

  async function install(id: string) {
    setActionError(null);
    try {
      const started = await api.post<AppInstall>(target, `/v1/apps/${id}/install`, {});
      setInstalls((prev) => ({ ...prev, [id]: started }));
      void watch(id);
    } catch (e) {
      setActionError(describeError(e));
    }
  }

  async function removeCustom(id: string) {
    setActionError(null);
    try {
      await api.delete<void>(target, `/v1/app-catalogue/custom/${id}`);
      await load();
    } catch (e) {
      setActionError(describeError(e));
    }
  }

  const configHref =
    !chosen || chosen === localNode
      ? "/config?tab=agent&sel=agent"
      : `/config?tab=${encodeURIComponent(`node:${chosen}`)}&sel=${encodeURIComponent(`agent:${chosen}`)}`;

  return (
    <section aria-labelledby="catalogue-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="catalogue-heading" className="font-ui text-base font-semibold">
          Available
        </h2>
        {machines.length > 1 && (
          <label className="font-ui flex items-center gap-2 text-sm text-[color:var(--muted)]">
            install on
            <select
              value={chosen ?? ""}
              onChange={(e) => onChoose(e.target.value === "" ? null : e.target.value)}
              aria-label="Machine to install on"
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-1 text-sm"
            >
              {machines.map((m) => (
                <option key={m ?? "__local"} value={m ?? ""}>
                  {m ?? "this machine"}
                  {m === localNode ? " (here)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {loadError && (
        <p className="status-error text-sm" data-testid="apps-catalogue-error">
          {loadError}
        </p>
      )}
      {catalogue && !catalogue.installable && catalogue.reason && (
        <p
          className="status-warn rounded-[var(--radius)] px-2 py-1 text-sm"
          data-testid="apps-not-installable"
        >
          {catalogue.reason}
        </p>
      )}
      {actionError && (
        <p className="status-error text-sm" data-testid="apps-action-error">
          {actionError}
        </p>
      )}

      {catalogue && catalogue.apps.length === 0 && (
        <p className="text-sm text-[color:var(--muted)]" data-testid="apps-catalogue-empty">
          This release does not include any apps yet. A chat app is planned next.
        </p>
      )}

      {catalogue && catalogue.apps.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="apps-catalogue">
          {catalogue.apps.map((entry) => (
            <CatalogueEntry
              key={entry.manifest.id}
              entry={entry}
              install={installs[entry.manifest.id] ?? null}
              installable={catalogue.installable}
              onInstall={() => install(entry.manifest.id)}
              onRemove={() => removeCustom(entry.manifest.id)}
            />
          ))}
        </ul>
      )}

      <AddCustom target={target} configHref={configHref} onAdded={load} />
    </section>
  );
}

function CatalogueEntry({
  entry,
  install,
  installable,
  onInstall,
  onRemove,
}: {
  entry: AppCatalogueEntry;
  install: AppInstall | null;
  installable: boolean;
  onInstall: () => void;
  onRemove: () => void;
}) {
  const { manifest } = entry;
  const running = install !== null && !installFinished(install);
  const update = updateAvailable(entry);
  const installedHere = !!entry.installedVersion && !update;
  return (
    <li
      className="flex flex-col gap-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2"
      data-testid="apps-catalogue-entry"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-ui font-semibold">{manifest.name}</span>
        <span className="font-mono text-sm text-[color:var(--muted)]">{manifest.version}</span>
        {entry.origin === "custom" && (
          <span
            className="font-ui text-sm text-[color:var(--muted)]"
            title="Added on this machine, not shipped with this release."
          >
            added by you
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {installedHere ? (
            <span className="font-ui text-sm text-[color:var(--muted)]">Installed</span>
          ) : (
            <button
              type="button"
              className={primaryClass}
              disabled={!installable || running}
              onClick={onInstall}
              data-testid={`apps-install-${manifest.id}`}
            >
              {running
                ? "Installing…"
                : update
                  ? `Update from ${entry.installedVersion}`
                  : "Install"}
            </button>
          )}
          {entry.origin === "custom" && !entry.installedVersion && (
            <ConfirmButton
              label="Remove"
              confirmLabel="Remove from this list"
              prompt="Forget this app's entry on this machine?"
              onConfirm={onRemove}
              className={buttonClass}
            />
          )}
        </span>
      </div>
      {manifest.summary && <p className="text-sm text-[color:var(--muted)]">{manifest.summary}</p>}
      {install && (
        <div className="text-sm" data-testid={`apps-install-state-${manifest.id}`}>
          <span
            className={install.state === "failed" ? "status-error" : "text-[color:var(--muted)]"}
          >
            {describeInstall(install)}
            {install.state === "failed" && install.error
              ? ` ${installErrorSummary(install.error)}`
              : ""}
          </span>
          {install.state === "failed" && install.error && (
            <details className="mt-1">
              <summary className="font-ui cursor-pointer text-[color:var(--muted)]">
                What it said
              </summary>
              <pre className="mt-1 max-h-60 overflow-auto rounded-[var(--radius)] bg-[color:var(--panel)] p-2 font-mono text-xs whitespace-pre-wrap">
                {install.error}
              </pre>
            </details>
          )}
        </div>
      )}
    </li>
  );
}

const EMPTY_CUSTOM = {
  id: "",
  name: "",
  package: "",
  entry: "",
  source: "",
  version: "",
  ui: false,
  configTrio: false,
};

/**
 * Add an app that is not in this release's list. An expert path, off by
 * default on the agent (`allowCustomApps`), because it runs somebody
 * else's code as the agent's user; the refusal names the setting and this
 * links to it (`cross-link-related-settings`).
 */
function AddCustom({
  target,
  configHref,
  onAdded,
}: {
  target: string;
  configHref: string;
  onAdded: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(EMPTY_CUSTOM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const complete = useMemo(
    () =>
      ["id", "name", "package", "entry", "source", "version"].every(
        (k) => (draft as Record<string, unknown>)[k] !== "",
      ),
    [draft],
  );

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const body: Partial<AppManifest> = { ...draft, uses: ["inference"] };
      await api.post(target, "/v1/app-catalogue/custom", body);
      setDraft(EMPTY_CUSTOM);
      await onAdded();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  }

  const text = (key: keyof typeof EMPTY_CUSTOM, label: string, hint: string) => (
    <label className="font-ui flex flex-col gap-1 text-sm">
      <span>
        {label} <span className="text-[color:var(--muted)]">— {hint}</span>
      </span>
      <input
        className={inputClass}
        value={String(draft[key])}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      />
    </label>
  );

  return (
    <details
      className="rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2"
      data-testid="apps-add-custom"
    >
      <summary className="font-ui cursor-pointer text-sm font-semibold">
        Add an app by its source
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-sm text-[color:var(--muted)]">
          For an app that is not in the list above, such as one you are writing. It runs its own
          code on that machine, as the user the agent runs as, holding the key made for it. This is
          off until you turn on “Allow apps not in the catalogue” in{" "}
          <Link href={configHref} className="underline">
            that machine&rsquo;s agent settings
          </Link>
          .
        </p>
        {text("id", "Id", "lowercase letters, digits and dashes")}
        {text("name", "Name", "what to call it")}
        {text("package", "Package", "its Python distribution name")}
        {text("entry", "Module", "run as python -m <module>")}
        {text("source", "Source", "an https:// archive URL, or a folder on that machine")}
        {text("version", "Version", "any label, such as a commit")}
        <label className="font-ui flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.ui}
            onChange={(e) => setDraft((d) => ({ ...d, ui: e.target.checked }))}
          />
          It has a page to open in a browser
        </label>
        <label className="font-ui flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.configTrio}
            onChange={(e) => setDraft((d) => ({ ...d, configTrio: e.target.checked }))}
          />
          It publishes settings this console can edit
        </label>
        {error && (
          <p className="status-error text-sm" data-testid="apps-add-custom-error">
            {error}
          </p>
        )}
        <div>
          <button
            type="button"
            className={primaryClass}
            disabled={!complete || saving}
            onClick={submit}
          >
            {saving ? "Adding…" : "Add to the list"}
          </button>
        </div>
      </div>
    </details>
  );
}
