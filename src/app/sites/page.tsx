"use client";

/**
 * Job sites: the machines people lend to their tools, as the install sees them.
 *
 * **Design:** `specs/docs/design/job-sites-own-enrollment.md` §2.9. A job
 * site is its own enrollment, separate from a machine of the install
 * (J19), so it has its own branch in the tree and its own page. In
 * production this page is membership only: who owns each site, whether it is
 * online, how to add one and how to remove one. What a site shares, and
 * with whom, is its owner's, and is managed in Workbench.
 *
 * **Dev mode adds one clearly labelled section per site** (J33): the
 * folders and servers the site last reported, and Eugene's owner's own
 * access to them. It is absent in production: when `dev` is not on a
 * site, no folder name is rendered at all.
 *
 * Every read and write goes to the control root through the UI's proxy.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CopyButton } from "@/components/CopyButton";
import { api, describeError } from "@/lib/api";
import { isLoopbackUrl, rootControlUrl } from "@/lib/joinCommand";
import { timeAgo, timeUntil } from "@/lib/relativeTime";
import {
  describeContact,
  describeOwnerInDevMode,
  machineHref,
  personHref,
  siteInviteCommands,
  siteName,
} from "@/lib/sites";
import { parseSelection } from "@/lib/resourceTree";
import type { Person, PersonList, Site, SiteInvitation, SiteList } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const POLL_MS = 5000;

const buttonClass =
  "action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2.5 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40";
const inputClass =
  "w-56 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 text-sm outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]";
const rowClass =
  "flex flex-col gap-2 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2";

export default function SitesPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const searchParams = useSearchParams();
  const selection = parseSelection(searchParams.get("sel"));
  const onlySite = selection?.type === "site" ? selection.name : null;
  const onlyOwner = searchParams.get("owner");

  const [list, setList] = useState<SiteList | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [rootUrl, setRootUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api.get<SiteList>("control", "/v1/sites"));
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, []);
  usePolling(load, POLL_MS);

  useEffect(() => {
    api
      .get<PersonList>("control", "/v1/people")
      .then((data) => setPeople((data.people ?? []).filter((p) => !p.disabled)))
      .catch(() => setPeople([]));
    // The address the guess starts from: this root's own machine, as the
    // registry lists it, the way the Machines page's invite does it.
    api
      .get<{ nodes?: { role?: string; url?: string | null }[] }>("control", "/v1/nodes")
      .then((data) => {
        const root = (data.nodes ?? []).find((n) => n.role === "control" && n.url);
        if (root?.url) setRootUrl(rootControlUrl(root.url));
      })
      .catch(() => undefined);
  }, []);

  const shown = useMemo(() => {
    const all = list?.sites ?? [];
    if (onlySite) return all.filter((s) => s.id === onlySite);
    if (onlyOwner) return all.filter((s) => s.owner === onlyOwner);
    return all;
  }, [list, onlySite, onlyOwner]);
  const ownerFilterName = onlyOwner ? people.find((p) => p.id === onlyOwner) : undefined;
  const filtered = Boolean(onlySite || onlyOwner);

  return (
    <AppShell>
      <main data-testid="sites-scroll" className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-8">
          <p className="text-sm text-[color:var(--muted)]">
            A job site is a machine a person lends to their tools. Each site belongs to one person,
            who manages it from Workbench (Job sites). It is separate from the machines under{" "}
            <Link href="/nodes" className="underline">
              Machines
            </Link>
            . Here you can add a site and remove one.
          </p>
          {error && (
            <p className="status-error rounded-[var(--radius)] px-2 py-1 text-sm" role="alert">
              {error}
            </p>
          )}

          <section aria-labelledby="sites-heading" className="section-panel flex flex-col gap-3">
            <h2 id="sites-heading" className="section-heading font-ui mb-0 text-base font-semibold">
              Job sites
            </h2>
            {filtered && (
              <p className="text-sm" data-testid="sites-filter">
                {onlySite
                  ? "Showing one job site. "
                  : `Showing the job sites ${ownerFilterName ? ownerFilterName.name : "one person"} owns. `}
                <Link href="/sites" className="underline">
                  Show all job sites
                </Link>
              </p>
            )}
            {list === null ? (
              !error && <p className="font-ui text-sm text-[color:var(--muted)]">Loading…</p>
            ) : shown.length === 0 ? (
              <p className="text-sm text-[color:var(--muted)]" data-testid="sites-empty">
                {filtered ? "No job site matches." : "No job sites yet. Add one below."}
              </p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="sites-list">
                {shown.map((site) => (
                  <SiteRow key={site.id} site={site} onChanged={load} />
                ))}
              </ul>
            )}
          </section>

          <Invite
            people={people}
            joinUrl={list?.joinUrl ?? null}
            guessUrl={rootUrl}
            onInvited={load}
          />
        </div>
      </main>
    </AppShell>
  );
}

function SiteRow({ site, onChanged }: { site: Site; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const contact = describeContact(site, (iso) => timeAgo(iso));
  const name = siteName(site);

  async function remove() {
    setError(null);
    try {
      await api.delete("control", `/v1/sites/${encodeURIComponent(site.id)}`);
      await onChanged();
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <li className={rowClass} data-testid={`site-${site.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-ui font-semibold">{name}</span>
        <span
          className={`font-ui rounded-[var(--radius)] px-1.5 text-sm ${
            contact.state === "online" ? "status-success" : "status-warn"
          }`}
          data-testid={`site-state-${site.id}`}
        >
          {contact.text}
        </span>
        <span className="ml-auto">
          <ConfirmButton
            label="Remove"
            confirmLabel={`Remove ${name}`}
            prompt="The machine stops being a job site. Its owner can add it again."
            onConfirm={remove}
            className={buttonClass}
            testId={`site-remove-${site.id}`}
          />
        </span>
      </div>
      <p className="text-sm">
        <span className="text-[color:var(--muted)]">Owner: </span>
        <Link
          href={personHref(site.owner)}
          className="underline"
          data-testid={`site-owner-${site.id}`}
        >
          {site.ownerName}
        </Link>
        {site.hostVersion ? (
          <span className="text-[color:var(--muted)]" data-testid={`site-version-${site.id}`}>
            {" "}
            · version {site.hostVersion}
          </span>
        ) : null}
        {site.hostNode ? (
          <span data-testid={`site-host-${site.id}`}>
            <span className="text-[color:var(--muted)]"> · runs on </span>
            <Link href={machineHref(site.hostNode)} className="underline">
              {site.hostNode}
            </Link>
          </span>
        ) : null}
      </p>
      {!site.ready && site.reason ? (
        <p className="text-sm text-[color:var(--muted)]">{site.reason}</p>
      ) : null}
      {site.dev ? <DevSection site={site} onChanged={onChanged} /> : null}
      {error && (
        <p className="status-error text-sm" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** Dev mode only (J33): what the site last reported, and Eugene's owner's own access. */
function DevSection({ site, onChanged }: { site: Site; onChanged: () => Promise<void> }) {
  const dev = site.dev!;
  const [error, setError] = useState<string | null>(null);
  const closed = describeOwnerInDevMode(dev.ownerInDevMode, site.ownerName);

  async function setAccess(folderId: string, ownerAccess: string) {
    setError(null);
    try {
      await api.patch(
        "control",
        `/v1/sites/${encodeURIComponent(site.id)}/folders/${encodeURIComponent(folderId)}`,
        { ownerAccess },
      );
      await onChanged();
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <section
      className="flex flex-col gap-2 rounded-[var(--radius)] border border-dashed border-[color:var(--border)] p-3 text-sm"
      data-testid={`site-dev-${site.id}`}
      aria-label={`Dev mode details for ${siteName(site)}`}
    >
      <h3 className="font-ui text-sm font-semibold">Dev mode only</h3>
      <p className="text-[color:var(--muted)]">
        This install is in dev mode, so you see what the site last reported. Its owner manages all
        of it from Workbench.
      </p>
      {closed && <p data-testid={`site-closed-${site.id}`}>{closed}</p>}
      {dev.folders.length === 0 ? (
        <p className="text-[color:var(--muted)]">No folders reported.</p>
      ) : (
        dev.folders.map((folder) => (
          <div
            key={folder.id}
            className="flex flex-col gap-1 border-t border-[color:var(--border)] pt-2"
          >
            <p className="font-semibold">
              {folder.name} · {folder.writable ? "Text writes allowed" : "Read only"}
            </p>
            <p className="break-all text-[color:var(--muted)]">{folder.path}</p>
            <label className="flex flex-wrap items-center gap-2">
              Your own access (dev mode only)
              <select
                aria-label={`Your access to ${folder.name} on ${siteName(site)}`}
                className={inputClass}
                value={folder.ownerAccess}
                onChange={(e) => void setAccess(folder.id, e.target.value)}
              >
                <option value="none">No access</option>
                <option value="read">Read only</option>
                {folder.writable && <option value="write">Read and write text</option>}
              </select>
            </label>
          </div>
        ))
      )}
      <div className="border-t border-[color:var(--border)] pt-2">
        <p className="font-semibold">Servers</p>
        {dev.servers.length === 0 ? (
          <p className="text-[color:var(--muted)]">No servers reported.</p>
        ) : (
          <ul className="list-disc pl-5">
            {dev.servers.map((server) => (
              <li key={server.id}>
                {server.name} ({server.kind === "files" ? "files" : "local"},{" "}
                {server.enabled ? "on" : "off"}
                {server.available ? "" : server.reason ? `, ${server.reason}` : ", not available"})
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p className="status-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function Invite({
  people,
  joinUrl,
  guessUrl,
  onInvited,
}: {
  people: Person[];
  joinUrl: string | null;
  guessUrl: string;
  onInvited: () => Promise<void>;
}) {
  const [owner, setOwner] = useState("");
  const [label, setLabel] = useState("");
  // Null until the person types, so clearing the box leaves it empty.
  const [typedUrl, setTypedUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<SiteInvitation | null>(null);

  // The address the machine joins through: what the root said, else what
  // was typed here, else the guess from this install's own machine.
  const address = invitation?.joinUrl ?? joinUrl ?? (typedUrl ?? guessUrl).trim();

  async function invite() {
    setBusy(true);
    setError(null);
    setInvitation(null);
    try {
      const made = await api.post<SiteInvitation>("control", "/v1/sites/invitations", {
        owner,
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      setInvitation(made);
      await onInvited();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const commands = invitation && address ? siteInviteCommands(invitation, address) : null;
  const rows = commands
    ? [
        {
          id: "windows",
          label: "Windows, in PowerShell",
          note: "It asks for administrator rights.",
          command: commands.windows,
        },
        {
          id: "posix",
          label: "Linux or macOS, in a terminal",
          note: "It may ask for your password.",
          command: commands.posix,
        },
      ]
    : [];

  return (
    <section aria-labelledby="invite-heading" className="section-panel flex flex-col gap-3">
      <h2 id="invite-heading" className="section-heading font-ui mb-0 text-base font-semibold">
        Add a job site
      </h2>
      <p className="text-sm text-[color:var(--muted)]">
        Choose the person the machine belongs to, then run the command on that machine. The machine
        must already have Eugene installed and joined as one of your machines.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="font-ui text-sm">
          <span className="mb-1 block text-[color:var(--muted)]">Whose machine</span>
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            data-testid="site-invite-owner"
            className={inputClass}
          >
            <option value="">Choose a person</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName || p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="font-ui text-sm">
          <span className="mb-1 block text-[color:var(--muted)]">Machine name (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="work-laptop"
            data-testid="site-invite-label"
            className={inputClass}
          />
        </label>
        {joinUrl === null && (
          <label className="font-ui text-sm">
            <span className="mb-1 block text-[color:var(--muted)]">
              Address the machine can reach
            </span>
            <input
              value={typedUrl ?? guessUrl}
              onChange={(e) => setTypedUrl(e.target.value)}
              placeholder="http://192.168.1.20:8083"
              data-testid="site-invite-url"
              className={`${inputClass} w-72 font-mono`}
            />
          </label>
        )}
        <button
          type="button"
          onClick={() => void invite()}
          disabled={busy || !owner}
          data-testid="site-invite-submit"
          className={buttonClass}
        >
          {busy ? "Making…" : "Make an invitation"}
        </button>
      </div>
      {error && (
        <p className="status-error rounded-[var(--radius)] px-2 py-1 text-sm" role="alert">
          {error}
        </p>
      )}
      {invitation && (
        <div
          className="rounded-[var(--radius)] border border-[color:var(--border)] p-3"
          data-testid="site-invitation"
        >
          <p className="font-ui mb-3 text-sm text-[color:var(--muted)]">
            Run one of these on the machine, which is already one of your machines. It adds the job
            site without installing Eugene again. The invitation works once and expires{" "}
            <span title={new Date(invitation.expiresAt).toLocaleString()}>
              {timeUntil(invitation.expiresAt) ?? "soon"}
            </span>
            .
          </p>
          {rows.map((c) => (
            <div key={c.id} className="mb-3">
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="font-ui text-sm">
                  {c.label}
                  <span className="text-[color:var(--muted)]"> &middot; {c.note}</span>
                </span>
                <CopyButton text={c.command} label="Copy" />
              </div>
              <pre
                data-testid={`site-command-${c.id}`}
                className="overflow-x-auto rounded-[var(--radius)] bg-[color:var(--panel)] p-3 font-mono text-xs"
              >
                {c.command}
              </pre>
            </div>
          ))}
          <ul className="list-disc pl-5 text-sm text-[color:var(--muted)]">
            <li>
              {invitation.ownerName} confirms on that machine by typing their own Eugene password.
            </li>
            <li>
              After that, {invitation.ownerName} manages the job site from Workbench (Job sites).
            </li>
          </ul>
          {!address && (
            <p className="mt-2 text-sm text-[color:var(--muted)]">
              This install has not said where other machines can reach it. Type that address in the
              box above, then make the invitation again.
            </p>
          )}
          {address && isLoopbackUrl(address) && (
            <p
              data-testid="site-loopback"
              role="alert"
              className="status-warn mt-2 rounded-[var(--radius)] border px-3 py-2 text-sm"
            >
              That address only works on this machine, so the command will fail on the other one.
              Type an address the other machine can reach in the box above.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
