"use client";

import { useCallback, useEffect, useState } from "react";

import { ConfigEditor } from "@/components/ConfigEditor";
import { ApiError, api } from "@/lib/api";

/**
 * Identity tab — wraps three sub-views:
 *
 *   - "Settings"     — identity-component config (reflection URLs,
 *                      logLevel) via the standard ConfigEditor.
 *   - "Persons"      — list / rename / delete people Eugene knows.
 *                      The operator row is protected from deletion;
 *                      everything else is editable.
 *   - "Pending"      — pending platform identity links filed by the
 *                      connector. Approve onto an existing person OR
 *                      create a new one in the same dialog. Reject
 *                      is one-click.
 *
 * Until v0.3's reactive UI lands, every mutation triggers a manual
 * `reload()` of the affected list — the list endpoint is cheap and
 * a refresh is the simplest way to keep the UI consistent with the
 * server after an operation.
 */

// Spec shapes hand-typed here — the identity yaml isn't in the UI's
// codegen list yet. If/when it is, swap for generated types.
interface Person {
  personId: string;
  displayName: string;
  isOperator?: boolean;
  relationshipNote?: string | null;
  createdAt: string;
  aliases?: PlatformAlias[] | null;
}

interface PlatformAlias {
  platform: string;
  accountId: string;
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  linkedAt: string;
}

interface PendingLink {
  linkId: string;
  platform: string;
  accountId: string;
  displayName?: string | null;
  handle?: string | null;
  avatarUrl?: string | null;
  triggeringMessage?: string | null;
  createdAt: string;
  status: string;
}

interface PersonsListResponse {
  persons: Person[];
}

interface PendingLinksResponse {
  links: PendingLink[];
}

export function IdentityPanel() {
  const [view, setView] = useState<"settings" | "persons" | "pending">("settings");
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  // Pre-fetch the pending count once so the operator sees a badge on
  // the Pending tab without having to open it. Failures stay silent —
  // a missing count just means no badge.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resp = await api.get<PendingLinksResponse>("identity", "/v1/identity/links/pending");
        if (cancelled) return;
        const open = (resp.links ?? []).filter((l) => l.status === "pending").length;
        setPendingCount(open);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <nav className="flex gap-1 border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-2">
        <SubTabButton active={view === "settings"} onClick={() => setView("settings")}>
          Settings
        </SubTabButton>
        <SubTabButton active={view === "persons"} onClick={() => setView("persons")}>
          Persons
        </SubTabButton>
        <SubTabButton active={view === "pending"} onClick={() => setView("pending")}>
          <span className="flex items-center gap-1.5">
            Pending links
            {pendingCount != null && pendingCount > 0 && (
              <span className="status-warn rounded border px-1.5 py-0.5 font-mono text-[9px]">
                {pendingCount}
              </span>
            )}
          </span>
        </SubTabButton>
      </nav>
      <div className="flex-1 overflow-hidden">
        {view === "settings" ? (
          <ConfigEditor target="identity" label="Identity" />
        ) : view === "persons" ? (
          <PersonsPanel />
        ) : (
          <PendingLinksPanel
            onCountChange={(n) => setPendingCount(n)}
          />
        )}
      </div>
    </div>
  );
}

function SubTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-ui rounded px-3 py-1 text-xs transition-colors ${
        active
          ? "bg-[color:var(--accent-left)] text-[color:var(--on-accent-left)] hover:brightness-110"
          : "border border-[color:var(--border)] text-[color:var(--foreground)] hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
      }`}
    >
      {children}
    </button>
  );
}

/* ───────────────────────────── persons ─────────────────────────────── */

function PersonsPanel() {
  const [list, setList] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const resp = await api.get<PersonsListResponse>("identity", "/v1/identity/persons");
      setList(resp.persons ?? []);
    } catch (e) {
      setLoadError(formatError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Persons</h2>
          <p className="text-[11px] text-[color:var(--muted)]">
            People Eugene knows. The operator is you; other persons get added when you approve a pending link or create one manually.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="font-ui rounded border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="font-ui rounded bg-[color:var(--accent-left)] px-3 py-1 text-xs font-medium text-[color:var(--on-accent-left)] hover:brightness-110"
          >
            Add person
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {loadError && (
          <p className="status-error mb-3 rounded border px-3 py-2 text-xs">{loadError}</p>
        )}
        {creating && (
          <CreatePerson
            onCancel={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              void reload();
            }}
          />
        )}
        {loading && !creating && (
          <p className="text-xs text-[color:var(--muted)]">Loading persons…</p>
        )}
        {!loading && list.length === 0 && !creating && (
          <p className="text-xs text-[color:var(--muted)]">
            No persons configured. The operator should have been created at identity startup — if this list is empty after a restart, identity may have failed to initialize its store.
          </p>
        )}
        {!loading &&
          list.map((p) => (
            <PersonRow
              key={p.personId}
              person={p}
              expanded={editing === p.personId}
              onToggle={() => setEditing(editing === p.personId ? null : p.personId)}
              onChanged={() => void reload()}
              onDeleted={() => {
                setEditing(null);
                void reload();
              }}
            />
          ))}
      </div>
    </div>
  );
}

function PersonRow({
  person,
  expanded,
  onToggle,
  onChanged,
  onDeleted,
}: {
  person: Person;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const aliasCount = person.aliases?.length ?? 0;
  return (
    <div className="mb-3 rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[color:var(--panel-hover)]"
      >
        <div>
          <div className="flex items-center gap-2">
            <p className="font-ui text-sm font-medium">{person.displayName}</p>
            {person.isOperator && (
              <span className="status-success rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase">
                operator
              </span>
            )}
          </div>
          <p className="font-mono text-[11px] text-[color:var(--muted)]">
            {aliasCount} alias{aliasCount === 1 ? "" : "es"}
            {person.relationshipNote && ` · ${person.relationshipNote}`}
          </p>
        </div>
        <span className="font-mono text-[10px] text-[color:var(--muted)]">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-[color:var(--border)] p-4">
          <PersonEditor person={person} onChanged={onChanged} onDeleted={onDeleted} />
        </div>
      )}
    </div>
  );
}

function PersonEditor({
  person,
  onChanged,
  onDeleted,
}: {
  person: Person;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [displayName, setDisplayName] = useState(person.displayName);
  const [relationshipNote, setRelationshipNote] = useState(person.relationshipNote ?? "");
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    displayName !== person.displayName ||
    (relationshipNote || "") !== (person.relationshipNote || "");

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.patch("identity", `/v1/identity/persons/${person.personId}`, {
        displayName,
        relationshipNote: relationshipNote || null,
      });
      onChanged();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setSaving(false);
    }
  }

  async function destroy() {
    setSaving(true);
    setError(null);
    try {
      await api.delete("identity", `/v1/identity/persons/${person.personId}`);
      onDeleted();
    } catch (e) {
      setError(formatError(e));
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Display name">
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={saving}
          className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
      </Field>
      <Field
        label="Relationship note"
        hint='Optional free-form note ("my wife", "dev-banter channel regular"). Surfaced into hemisphere prompts as top-level context.'
      >
        <textarea
          value={relationshipNote}
          onChange={(e) => setRelationshipNote(e.target.value)}
          disabled={saving}
          rows={2}
          className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
      </Field>

      {person.aliases && person.aliases.length > 0 && (
        <div>
          <p className="font-ui mb-1 text-xs font-medium">Platform aliases</p>
          <ul className="divide-y divide-[color:var(--border)] rounded border border-[color:var(--border)] bg-[color:var(--panel)]">
            {person.aliases.map((a) => (
              <li key={`${a.platform}:${a.accountId}`} className="flex justify-between px-3 py-2 text-xs">
                <span className="font-mono">{a.platform}</span>
                <span className="font-mono text-[color:var(--muted)]">
                  {a.handle ?? a.displayName ?? a.accountId}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="status-error rounded border px-3 py-2 text-xs">{error}</p>}

      <div className="flex items-center justify-between pt-1">
        <div>
          {!person.isOperator && (
            deleteConfirm ? (
              <span className="flex items-center gap-2">
                <span className="text-xs text-[color:var(--muted)]">Delete?</span>
                <button
                  type="button"
                  onClick={() => void destroy()}
                  disabled={saving}
                  className="font-ui status-error rounded border px-3 py-1 text-xs font-medium transition-[filter] hover:brightness-110 disabled:opacity-40"
                >
                  Yes, delete
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(false)}
                  disabled={saving}
                  className="font-ui rounded border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setDeleteConfirm(true)}
                disabled={saving}
                className="font-ui rounded border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--muted)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] hover:text-[color:var(--foreground)] disabled:opacity-40"
              >
                Delete person
              </button>
            )
          )}
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="font-ui rounded bg-[color:var(--accent-left)] px-3 py-1 text-xs font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:brightness-100"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function CreatePerson({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [relationshipNote, setRelationshipNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      await api.post("identity", "/v1/identity/persons", {
        displayName,
        relationshipNote: relationshipNote || null,
      });
      onCreated();
    } catch (e) {
      setError(formatError(e));
      setSaving(false);
    }
  }

  return (
    <div className="mb-3 rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4">
      <p className="font-ui mb-3 text-sm font-medium">New person</p>
      <div className="flex flex-col gap-3">
        <Field label="Display name">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={saving}
            placeholder="Sarah"
            className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent-left)]"
          />
        </Field>
        <Field label="Relationship note" hint="Optional.">
          <textarea
            value={relationshipNote}
            onChange={(e) => setRelationshipNote(e.target.value)}
            disabled={saving}
            rows={2}
            placeholder="my high school friend"
            className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent-left)]"
          />
        </Field>
        {error && <p className="status-error rounded border px-3 py-2 text-xs">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="font-ui rounded border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={saving || !displayName.trim()}
            className="font-ui rounded bg-[color:var(--accent-left)] px-3 py-1 text-xs font-medium text-[color:var(--on-accent-left)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── pending links ─────────────────────────────── */

function PendingLinksPanel({
  onCountChange,
}: {
  onCountChange: (n: number) => void;
}) {
  const [list, setList] = useState<PendingLink[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [linksResp, personsResp] = await Promise.all([
        api.get<PendingLinksResponse>("identity", "/v1/identity/links/pending"),
        api.get<PersonsListResponse>("identity", "/v1/identity/persons"),
      ]);
      const pending = (linksResp.links ?? []).filter((l) => l.status === "pending");
      setList(pending);
      setPersons(personsResp.persons ?? []);
      onCountChange(pending.length);
    } catch (e) {
      setLoadError(formatError(e));
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Pending identity links</h2>
          <p className="text-[11px] text-[color:var(--muted)]">
            Platform users who want to talk to Eugene but aren&rsquo;t recognized yet. Approve to alias them onto an existing person or create a new one.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          className="font-ui rounded border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Refresh
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {loadError && (
          <p className="status-error mb-3 rounded border px-3 py-2 text-xs">{loadError}</p>
        )}
        {loading && (
          <p className="text-xs text-[color:var(--muted)]">Loading pending links…</p>
        )}
        {!loading && list.length === 0 && (
          <p className="text-xs text-[color:var(--muted)]">
            No pending links. When a stranger DMs the Discord bot (or any future connector), they show up here.
          </p>
        )}
        {!loading &&
          list.map((link) => (
            <PendingLinkRow
              key={link.linkId}
              link={link}
              persons={persons}
              acting={acting === link.linkId}
              onAct={(active) => setActing(active ? link.linkId : null)}
              onResolved={() => {
                setActing(null);
                void reload();
              }}
            />
          ))}
      </div>
    </div>
  );
}

function PendingLinkRow({
  link,
  persons,
  acting,
  onAct,
  onResolved,
}: {
  link: PendingLink;
  persons: Person[];
  acting: boolean;
  onAct: (active: boolean) => void;
  onResolved: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [linkAsPersonId, setLinkAsPersonId] = useState<string>(
    persons[0]?.personId ?? "",
  );
  const [displayName, setDisplayName] = useState(
    link.displayName ?? link.handle ?? "",
  );
  const [relationshipNote, setRelationshipNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const body =
        mode === "existing"
          ? { linkAsPersonId }
          : { displayName, relationshipNote: relationshipNote || null };
      await api.post(
        "identity",
        `/v1/identity/links/pending/${encodeURIComponent(link.linkId)}/approve`,
        body,
      );
      onResolved();
    } catch (e) {
      setError(formatError(e));
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    setError(null);
    try {
      await api.post(
        "identity",
        `/v1/identity/links/pending/${encodeURIComponent(link.linkId)}/reject`,
        {},
      );
      onResolved();
    } catch (e) {
      setError(formatError(e));
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)]">
      <button
        type="button"
        onClick={() => onAct(!acting)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[color:var(--panel-hover)]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--muted)]">
              {link.platform}
            </span>
            <p className="font-ui truncate text-sm font-medium">
              {link.displayName ?? link.handle ?? link.accountId}
            </p>
          </div>
          {link.triggeringMessage && (
            <p className="mt-1 truncate text-xs text-[color:var(--muted)]">
              &ldquo;{link.triggeringMessage}&rdquo;
            </p>
          )}
        </div>
        <span className="font-mono text-[10px] text-[color:var(--muted)]">
          {acting ? "▾" : "▸"}
        </span>
      </button>

      {acting && (
        <div className="border-t border-[color:var(--border)] p-4">
          <div className="mb-4 flex gap-3">
            <RadioOption
              checked={mode === "new"}
              onChange={() => setMode("new")}
              label="Create a new person"
            />
            <RadioOption
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              label="Alias onto an existing person"
              disabled={persons.length === 0}
            />
          </div>

          {mode === "new" ? (
            <div className="flex flex-col gap-3">
              <Field label="Display name">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={busy}
                  className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent-left)]"
                />
              </Field>
              <Field label="Relationship note" hint="Optional.">
                <textarea
                  value={relationshipNote}
                  onChange={(e) => setRelationshipNote(e.target.value)}
                  disabled={busy}
                  rows={2}
                  className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent-left)]"
                />
              </Field>
            </div>
          ) : (
            <Field label="Alias onto">
              <select
                value={linkAsPersonId}
                onChange={(e) => setLinkAsPersonId(e.target.value)}
                disabled={busy}
                className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent-left)]"
              >
                {persons.map((p) => (
                  <option key={p.personId} value={p.personId}>
                    {p.displayName}
                    {p.isOperator ? " (operator)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {error && (
            <p className="status-error mt-3 rounded border px-3 py-2 text-xs">{error}</p>
          )}

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => void reject()}
              disabled={busy}
              className="font-ui rounded border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--muted)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] hover:text-[color:var(--foreground)] disabled:opacity-40"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => void approve()}
              disabled={
                busy ||
                (mode === "new" && !displayName.trim()) ||
                (mode === "existing" && !linkAsPersonId)
              }
              className="font-ui rounded bg-[color:var(--accent-left)] px-4 py-1 text-xs font-medium text-[color:var(--on-accent-left)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {busy ? "Approving…" : "Approve"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RadioOption({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-xs ${disabled ? "opacity-40" : "cursor-pointer"}`}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="cursor-pointer"
      />
      {label}
    </label>
  );
}

/* ───────────────────────────── helpers ─────────────────────────────── */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="font-ui mb-1 block text-xs font-medium">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-[color:var(--muted)]">{hint}</p>}
    </div>
  );
}

function formatError(e: unknown): string {
  if (e instanceof ApiError) {
    if (typeof e.body === "object" && e.body !== null && "detail" in e.body) {
      const detail = (e.body as { detail: unknown }).detail;
      if (typeof detail === "object" && detail !== null) {
        const d = detail as { title?: string; detail?: string };
        return d.detail || d.title || `${e.status} ${e.statusText}`;
      }
      if (typeof detail === "string") return detail;
    }
    return `${e.status} ${e.statusText}`;
  }
  return e instanceof Error ? e.message : String(e);
}
