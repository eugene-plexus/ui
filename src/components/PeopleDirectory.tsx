"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PermissionGroup, Person } from "@/lib/types";

const button =
  "action-button rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm disabled:opacity-40";
const input =
  "w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm";

function selectedPerson(): string | null {
  if (!window.location.hash.startsWith("#person-")) return null;
  try {
    return decodeURIComponent(window.location.hash.slice(8));
  } catch {
    return null;
  }
}

/** One directory for owner and delegated administration; authorization stays in their editors. */
export function PeopleDirectory({
  people,
  groups,
  renderPerson,
  introduction,
  children,
}: {
  people: Person[];
  groups: PermissionGroup[] | null;
  renderPerson: (person: Person) => ReactNode;
  introduction?: ReactNode;
  children?: ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastOpened = useRef<string | null>(null);

  useEffect(() => {
    const read = () => setSelected(selectedPerson());
    read();
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("popstate", read);
    };
  }, []);

  useEffect(() => {
    if (selected) {
      lastOpened.current = selected;
      heading.current?.focus();
    } else if (lastOpened.current) {
      document.getElementById(`open-person-${lastOpened.current}`)?.focus();
    }
  }, [selected]);

  function show(id: string | null) {
    const url = new URL(window.location.href);
    url.hash = id ? `person-${encodeURIComponent(id)}` : "";
    window.history.pushState(null, "", url);
    setSelected(id);
  }

  const person = people.find((p) => p.id === selected);
  const details =
    selected !== null ? (
      <section className="flex flex-col gap-4" aria-label="Person details">
        <div>
          <button className={button} onClick={() => show(null)}>
            ← Back to people
          </button>
        </div>
        <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">
          {person ? person.displayName || person.name : "Person unavailable"}
        </h2>
        {person ? (
          <div key={person.id}>{renderPerson(person)}</div>
        ) : (
          <p role="status">This person was removed or is no longer available to you.</p>
        )}
      </section>
    ) : null;

  const groupNames = (person: Person) =>
    person.groups?.map((id) => groups?.find((g) => g.id === id)?.name ?? id) ?? [];
  const search = query.trim().toLocaleLowerCase();
  const filtered = people
    .filter(
      (p) =>
        (status === "all" || !!p.disabled === (status === "disabled")) &&
        [p.name, p.displayName, p.email, ...groupNames(p)]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(search),
    )
    .sort(
      (a, b) =>
        (a.displayName || a.name).localeCompare(b.displayName || b.name, undefined, {
          sensitivity: "base",
          numeric: true,
        }) || a.id.localeCompare(b.id),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  return (
    <>
      {details}
      <div hidden={selected !== null} className="min-w-0 space-y-8">
        <section
          aria-labelledby="people-heading"
          className="section-panel flex min-w-0 flex-col gap-4"
        >
          <div>
            <h2 id="people-heading" className="section-heading font-ui mb-1 text-lg font-semibold">
              People ({people.length})
            </h2>
            <p className="text-sm text-[color:var(--muted)]">
              Select a person to view their account and manage their access.
            </p>
          </div>
          {introduction}
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 text-sm">
              Find a person
              <input
                type="search"
                className={`${input} mt-1`}
                placeholder="Name, email or group"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label className="text-sm">
              Account status
              <select
                className={`${input} mt-1`}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All accounts</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-left text-sm" data-testid="people-list">
              <caption className="sr-only">Member accounts</caption>
              <thead className="border-b border-[color:var(--border)] text-[color:var(--muted)]">
                <tr>
                  <th scope="col" className="w-2/3 px-2 py-3 sm:w-1/2">
                    Person
                  </th>
                  <th scope="col" className="px-2 py-3">
                    Status
                  </th>
                  <th scope="col" className="hidden px-2 py-3 sm:table-cell">
                    Access
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {visible.map((p) => {
                  const administration = p.administration;
                  const delegate =
                    administration?.managePeople ||
                    administration?.manageGroups ||
                    !!administration?.membershipGroups?.length;
                  return (
                    <tr key={p.id} className="hover:bg-[color:var(--panel-soft)]">
                      <td className="px-2 py-3 break-words">
                        <a
                          id={`open-person-${p.id}`}
                          href={`#person-${encodeURIComponent(p.id)}`}
                          aria-label={`Manage ${p.name}`}
                          className="font-semibold text-[color:var(--accent-left)] underline underline-offset-4"
                          onClick={(e) => {
                            if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
                              return;
                            e.preventDefault();
                            show(p.id);
                          }}
                        >
                          {p.displayName || p.name}
                        </a>
                        {p.displayName && (
                          <span className="mt-0.5 block text-[color:var(--muted)]">{p.name}</span>
                        )}
                        {p.email && (
                          <span className="mt-0.5 block text-xs text-[color:var(--muted)]">
                            {p.email}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-3 align-top">
                        <span className={p.disabled ? "status-warn" : "status-success"}>
                          {p.disabled ? "Disabled" : "Active"}
                        </span>
                        {delegate && (
                          <span className="mt-1 block text-xs text-[color:var(--muted)]">
                            Administrator
                          </span>
                        )}
                      </td>
                      <td className="hidden px-2 py-3 align-top break-words sm:table-cell">
                        {p.groups == null
                          ? "Individual access"
                          : groupNames(p).join(", ") || "No group access"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {visible.length === 0 && (
            <p role="status" className="py-4 text-sm text-[color:var(--muted)]">
              {people.length === 0 ? "No member accounts yet." : "No people match these filters."}
            </p>
          )}
          <nav
            aria-label="People pages"
            className="flex flex-wrap items-center justify-between gap-3 text-sm"
          >
            <p role="status" aria-live="polite">
              {filtered.length
                ? `${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length} people`
                : "0 people"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                Per page
                <select
                  className={input}
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                >
                  {[10, 25, 50].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={button}
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </button>
              <span>
                Page {currentPage} of {pages}
              </span>
              <button
                className={button}
                disabled={currentPage >= pages}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
          </nav>
        </section>
        {children}
      </div>
    </>
  );
}
