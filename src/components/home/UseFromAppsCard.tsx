"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ClientKeyLimitsEditor,
  DEFAULT_CLIENT_LIMITS,
  cleanClientLimits,
  describeClientLimits,
} from "./ClientKeyLimitsEditor";

import { ConfirmButton } from "@/components/ConfirmButton";
import { CopyButton } from "@/components/CopyButton";
import { ApiError, api, describeError } from "@/lib/api";
import {
  blockers,
  clientKeyTarget,
  keyLabel,
  keyStatus,
  recipes as buildRecipes,
} from "@/lib/clientKeys";
import type { BoundAddressLike, RemapEvidence, Verdict } from "@/lib/gatewayAddress";
import {
  describeCandidate,
  describeRemap,
  describeVerdict,
  portRemapEvidence,
  sameEvidence,
  sameOffsetCandidate,
  verifyGatewayAddress,
} from "@/lib/gatewayAddress";
import type {
  ClientKey,
  ClientKeyCreated,
  ClientKeyLimits,
  ClientKeyList,
  ComponentPlacementList,
  Model,
} from "@/lib/types";

const BASE_URL_OVERRIDE = "eugene-gateway-base-url";

/** Semantic tone -> the theme-aware status classes in `globals.css`. */
const TONE_CLASS = {
  ok: "status-success",
  warn: "status-warn",
  error: "status-error",
} as const;

/**
 * "Use it from your apps": the second job, which had no path at all.
 *
 * Hobbyist UX §6.1 and §0.8. What a person needs to point Continue,
 * Cline, Open WebUI, SillyTavern or a coding harness at this install is
 * three strings — an address ending in `/v1`, a key that is not empty,
 * and the exact model id — and until this card they were shown nowhere
 * together. The key on offer was the operator session token, which can
 * do everything and dies in a fortnight; §3 ranks getting these three
 * wrong as the sixth-commonest failure across every comparable project.
 *
 * **The address is a guess, and it says so.** The browser reaches the
 * gateway through the agent's proxy and never learns its address; what
 * survives is the port from the topology, so the guess is this page's
 * own host plus that port. On a container that publishes 8080 as 8280 it
 * is wrong in exactly the way a harness handed the same numbers would
 * be — so it is editable, and the correction is remembered in this
 * browser (`easy-default-expert-override`: detect, and always leave a
 * way to override).
 *
 * **And since 2026-09-16 the card stops guessing out loud and checks.**
 * Saying "this is a guess" in muted 11px turned out to be nowhere near
 * enough: the address was pasted into an OpenAI client, the container's
 * published port was 8280 rather than the guessed 8080, and qBittorrent
 * answered on 8080 with a bare `400 Bad Request`. Every layer was
 * behaving correctly and the afternoon was gone. Two additions, both in
 * `lib/gatewayAddress.ts`, which has the reasoning:
 *
 * - `portRemapEvidence` compares the port this page was reached on with
 *   the agent's own listening socket. Disagreement is proof that ports
 *   are rewritten in front of this install, so the guess below is
 *   probably wrong; agreement proves nothing and says nothing.
 * - `verifyGatewayAddress` calls the address the way a harness would.
 *   It needs **no key** — an unauthenticated `/v1/models` comes back as
 *   a readable 401 naming `component: "gateway"`, because the front
 *   door's CORS header is added whatever the status — so the check runs
 *   the moment the card renders, which is before anyone has minted
 *   anything.
 *
 * The verdict is the only thing here allowed to call the address right.
 *
 * Key management uses the local agent, which forwards to the control root
 * when enrolled. The response identifies registry scope and migration status.
 */
export function UseFromAppsCard({
  models,
  gatewayPortUrl,
  placement,
  localNode,
  boundAddresses,
}: {
  /** The models the gateway routes to; the first is proposed. */
  models: Model[];
  /** The guessed base URL (scheme + host + gateway port), or null. */
  gatewayPortUrl: string | null;
  /** The control root's placement view, for which node runs the gateway. */
  placement: ComponentPlacementList | null;
  /** This machine's node name, or null when it is not enrolled. */
  localNode: string | null;
  /** S5's `reach.boundAddresses`: what this install is really listening on. */
  boundAddresses?: BoundAddressLike[] | null;
}) {
  const [registry, setRegistry] = useState<ClientKeyList | null>(null);
  const [keys, setKeys] = useState<ClientKey[] | null>(null);
  const [fresh, setFresh] = useState<ClientKeyCreated | null>(null);
  const [name, setName] = useState("");
  const [limits, setLimits] = useState<ClientKeyLimits>(DEFAULT_CLIENT_LIMITS);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editLimits, setEditLimits] = useState<ClientKeyLimits>(DEFAULT_CLIENT_LIMITS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [openRecipe, setOpenRecipe] = useState<string | null>(null);

  const where = useMemo(() => clientKeyTarget(placement, localNode), [placement, localNode]);

  useEffect(() => {
    try {
      setOverride(localStorage.getItem(BASE_URL_OVERRIDE));
    } catch {
      // Private mode. The guess stands; nothing else changes.
    }
  }, []);

  useEffect(() => {
    setModel((current) =>
      current && models.some((m) => m.id === current) ? current : (models[0]?.id ?? null),
    );
  }, [models]);

  const load = useCallback(async () => {
    try {
      const list = await api.get<ClientKeyList>(where.target, "/v1/auth/client-keys");
      setKeys(list.keys ?? []);
      setRegistry(list);
      setError(null);
    } catch (e) {
      // An agent on another node that is down costs this card its list
      // and nothing else; the address and the model id are still right.
      setKeys([]);
      setRegistry(null);
      setError(describeError(e));
    }
  }, [where.target]);

  useEffect(() => {
    void load();
  }, [load]);

  const baseUrl = (override ?? gatewayPortUrl ?? "").replace(/\/+$/, "");
  const display = baseUrl ? `${baseUrl}/v1` : "";
  // The fresh token while it is on screen, else the newest live key's
  // tail as a placeholder — a person who made a key yesterday needs the
  // address and the model id today, and should not be told to make
  // another just to see them.
  const liveKeys = (keys ?? []).filter((k) => !k.revokedAt);
  const keyString = fresh?.token ?? null;
  const strings = useMemo(
    () => ({ baseUrl: display, key: keyString ?? "YOUR_KEY", model: model ?? "MODEL_ID" }),
    [display, keyString, model],
  );
  const recipes = useMemo(() => buildRecipes(strings), [strings]);
  const missing = blockers({
    baseUrl: display || null,
    key: keyString ?? liveKeys[0]?.id ?? null,
    model,
  });

  // Read after mount rather than in a `useMemo`: this is a static
  // export, so a `window` read during render is a hydration mismatch
  // between a server frame that has no location and a client one that
  // does. Same reason the override above is read in an effect.
  const [evidence, setEvidence] = useState<RemapEvidence>({ kind: "none" });
  useEffect(() => {
    const next = portRemapEvidence(window.location, boundAddresses);
    // The same reading keeps the same object, so the check below does not
    // start again every time Home's slow poll hands down a new array.
    setEvidence((prev) => (sameEvidence(prev, next) ? prev : next));
  }, [boundAddresses]);
  const remap = describeRemap(evidence);

  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // Only the newest check may speak: a slow probe of an address someone
  // has since corrected must not land over the answer about the new one.
  const checkSeq = useRef(0);
  const check = useCallback(async () => {
    if (!baseUrl) return;
    const seq = ++checkSeq.current;
    const current = () => seq === checkSeq.current;
    setChecking(true);
    setCandidate(null);
    try {
      // The key when there is one -- it upgrades the answer from "the
      // gateway is there" to "and it serves these models", which is the
      // other half of the same class of bug: a client configured with a
      // model id that names nothing.
      const found = await verifyGatewayAddress(baseUrl, { key: keyString });
      if (!current()) return;
      setVerdict(found);
      // A failed address on a machine that publishes ports differently
      // has one cheap hypothesis worth testing: the same shift applied
      // to the gateway. It is PROBED, never asserted -- the offer below
      // appears only for a candidate that answered as this gateway, and
      // a candidate that did not is never mentioned. No key: the
      // gateway's own 401 is proof enough of what is there.
      if (found.kind !== "confirmed") {
        const guess = sameOffsetCandidate(baseUrl, evidence);
        if (guess) {
          const probe = await verifyGatewayAddress(guess);
          if (current() && probe.kind === "confirmed") setCandidate(guess);
        }
      }
    } finally {
      if (current()) setChecking(false);
    }
  }, [baseUrl, keyString, evidence]);

  // On every change of address or key, not on a button. A check nobody
  // presses is a check nobody gets, and this one costs one GET to a
  // host the page is already talking to.
  useEffect(() => {
    setVerdict(null);
    void check();
  }, [check]);

  // `baseUrl`, not `display`: what is listening is at the origin, and
  // the first live run said "listening at http://...:8080/v1".
  const verdictText = verdict
    ? describeVerdict(verdict, baseUrl, {
        remapped: evidence.kind === "remapped",
        hasCandidate: candidate !== null,
      })
    : null;

  async function mint(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await api.post<ClientKeyCreated>(where.target, "/v1/auth/client-keys", {
        name: name.trim() || "My app",
        limits: cleanClientLimits(limits),
      });
      setFresh(made);
      setName("");
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? "That machine refused the session. Sign in again, then make the key."
          : describeError(e),
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveLimits(event: React.FormEvent) {
    event.preventDefault();
    if (!editingKey || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(where.target, `/v1/auth/client-keys/${encodeURIComponent(editingKey)}/limits`, {
        limits: cleanClientLimits(editLimits),
      });
      setEditingKey(null);
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: ClientKey) {
    setBusy(true);
    setError(null);
    try {
      await api.delete(where.target, `/v1/auth/client-keys/${encodeURIComponent(key.id)}`);
      if (fresh?.key.id === key.id) setFresh(null);
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  function saveOverride(value: string) {
    const cleaned = value.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    setOverride(cleaned || null);
    try {
      if (cleaned) localStorage.setItem(BASE_URL_OVERRIDE, cleaned);
      else localStorage.removeItem(BASE_URL_OVERRIDE);
    } catch {
      // Remembered for this page only. The value still works now.
    }
    setEditing(false);
  }

  return (
    <section
      data-testid="home-use-from-apps"
      className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3"
    >
      <h2 className="font-ui text-sm font-semibold">Use it from your apps</h2>
      <p className="font-ui mt-1 text-sm text-[color:var(--muted)]">
        One address for Claude Code and OpenAI-compatible apps such as Continue, Open WebUI and
        SillyTavern. Choose your app below for its connection settings.
      </p>

      <dl className="mt-3 flex flex-col gap-2">
        <Row label="Address">
          {editing ? (
            <form
              className="flex flex-1 flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const input = (e.currentTarget.elements.namedItem("base") as HTMLInputElement)
                  .value;
                saveOverride(input);
              }}
            >
              <input
                name="base"
                defaultValue={baseUrl}
                aria-label="Address"
                data-testid="base-url-input"
                placeholder="http://192.168.1.20:8080"
                className="min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 font-mono text-xs"
              />
              <button type="submit" className="font-ui text-[0.6875rem] underline">
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="font-ui text-[0.6875rem] text-[color:var(--muted)] underline"
              >
                Cancel
              </button>
            </form>
          ) : (
            <>
              <code data-testid="base-url" className="min-w-0 flex-1 font-mono text-xs break-all">
                {display || "not known yet"}
              </code>
              {display && <CopyButton text={display} title="Copy the address" />}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="font-ui text-[0.6875rem] text-[color:var(--muted)] underline"
              >
                {override ? "Change" : "Not right?"}
              </button>
            </>
          )}
        </Row>
        <div className="flex flex-col gap-1 pl-[5.5rem]">
          {/* **The offer comes first when there is one.** It is the
              answer; everything below it is why. The live run put the
              solution third, under an error and above two paragraphs
              repeating each other. */}
          {candidate && (
            <p
              data-testid="base-url-candidate"
              className="status-success font-ui flex flex-wrap items-center gap-x-2 rounded-[var(--radius)] px-2 py-1 text-[0.6875rem]"
            >
              <span>{describeCandidate(candidate)}</span>
              <button
                type="button"
                data-testid="base-url-use-candidate"
                onClick={() => saveOverride(candidate)}
                className="font-semibold underline"
              >
                Use this address
              </button>
            </p>
          )}

          {display && (
            <p
              data-testid="base-url-verdict"
              data-verdict={verdict?.kind ?? (checking ? "checking" : "none")}
              className={
                verdictText
                  ? `${TONE_CLASS[verdictText.tone]} font-ui rounded-[var(--radius)] px-2 py-1 text-[0.6875rem]`
                  : "font-ui text-[0.6875rem] text-[color:var(--muted)]"
              }
            >
              {verdictText?.text ?? "Checking this address…"}{" "}
              {!checking && (
                <button
                  type="button"
                  onClick={() => void check()}
                  data-testid="base-url-recheck"
                  className="underline"
                >
                  Check again
                </button>
              )}
            </p>
          )}

          {/* Suppressed once the address is proven: the check outranks
              the doubt, and leaving a warning under a confirmation is
              how a person learns to ignore both. */}
          {remap && verdict?.kind !== "confirmed" && !candidate && (
            <p
              data-testid="base-url-remap"
              className="status-warn font-ui rounded-[var(--radius)] px-2 py-1 text-[0.6875rem]"
            >
              {remap}
            </p>
          )}

          {!candidate && (
            <p className="font-ui text-[0.6875rem] text-[color:var(--muted)]">
              {override
                ? "You corrected this address; this browser will remember it."
                : "Worked out from the gateway's port and this page's address. If your install publishes " +
                  "that port differently — a container remap, for instance — correct it here."}
            </p>
          )}
        </div>

        <Row label="Model">
          {models.length > 1 ? (
            <select
              data-testid="app-model"
              aria-label="Model"
              value={model ?? ""}
              onChange={(e) => setModel(e.target.value)}
              className="min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 font-mono text-xs"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
          ) : (
            <code data-testid="app-model" className="min-w-0 flex-1 font-mono text-xs break-all">
              {model ?? "nothing is running"}
            </code>
          )}
          {model && <CopyButton text={model} title="Copy the model id" />}
        </Row>

        <Row label="Key">
          {fresh ? (
            <>
              <code data-testid="fresh-key" className="min-w-0 flex-1 font-mono text-xs break-all">
                {fresh.token}
              </code>
              <CopyButton text={fresh.token} title="Copy the key" />
            </>
          ) : (
            <span className="font-ui flex-1 text-sm text-[color:var(--muted)]">
              {liveKeys.length === 0
                ? "none yet"
                : `${liveKeys.length} key${liveKeys.length === 1 ? "" : "s"} made; a key is shown once, so make a new one if you no longer have it`}
            </span>
          )}
        </Row>
      </dl>

      {fresh && (
        <p className="status-warn mt-2 rounded-[var(--radius)] px-2 py-1 text-[0.6875rem]">
          Copy this now — it is shown once and is not stored anywhere. Lose it and you make another.
        </p>
      )}

      {missing.length > 0 && !fresh && (
        <ul className="font-ui mt-2 flex flex-col gap-1 text-[0.6875rem] text-[color:var(--muted)]">
          {missing.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <form onSubmit={mint} className="mt-3 flex flex-wrap items-center gap-2">
        <ClientKeyLimitsEditor value={limits} onChange={setLimits} disabled={busy} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="What the key is for"
          data-testid="key-name"
          placeholder="What is it for? e.g. Continue on the laptop"
          className="font-ui min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 text-sm"
        />
        <button
          type="submit"
          data-testid="make-key"
          disabled={busy}
          className="font-ui rounded-[var(--radius)] border border-[color:var(--accent-left)] px-3 py-1 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "Working…" : "Make a key"}
        </button>
      </form>
      <p className="font-ui mt-1 text-[0.6875rem] text-[color:var(--muted)]">
        Good for a year, works for model discovery, chat and embeddings, and can be turned off on
        its own.
        {registry?.scope === "install"
          ? " Keys and revocations apply to every gateway in this install."
          : registry?.scope === "standalone"
            ? " This machine currently manages its own keys."
            : " Registry status has not been confirmed."}
      </p>

      {registry?.migration && (
        <p
          data-testid="key-migration"
          role="status"
          className={
            registry.migration === "error" || registry.migration === "pending"
              ? "status-warn mt-2 text-sm"
              : "font-ui mt-2 text-sm text-[color:var(--muted)]"
          }
        >
          {registry.detail ??
            (registry.migration === "standalone"
              ? "Existing keys will migrate when this machine joins an install."
              : "Existing keys are registered install-wide.")}
        </p>
      )}
      <p className="font-ui mt-1 text-[0.6875rem] text-[color:var(--muted)]">
        Client requests need the active key authority. If it is unreachable, clients cannot start
        inference or list models; operator management remains available. Permission changes stop
        active requests when their reservation next renews.
      </p>
      <button type="button" onClick={() => void load()} className="font-ui mt-1 text-sm underline">
        Refresh key status
      </button>

      {error && (
        <p
          data-testid="key-error"
          className="status-error mt-2 rounded-[var(--radius)] px-2 py-1 text-[0.6875rem]"
        >
          {error}
        </p>
      )}

      {liveKeys.length > 0 && (
        <ul data-testid="key-list" className="mt-3 flex flex-col gap-1">
          {liveKeys.map((key) => {
            const status = keyStatus(key);
            return (
              <li
                key={key.id}
                className="font-ui flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[color:var(--border)] pt-1 text-[0.6875rem]"
              >
                <span className="font-semibold">{key.name}</span>
                {key.migrated && <span>migrated from {key.originNode ?? "another node"}</span>}
                <code className="font-mono">{keyLabel(key.tail)}</code>
                <span className="text-[color:var(--muted)]">{status.text}</span>
                <span className="basis-full">{describeClientLimits(key.limits)}</span>
                <button
                  type="button"
                  disabled={busy}
                  className="underline"
                  onClick={() => {
                    setEditingKey(key.id);
                    setEditLimits(key.limits ?? DEFAULT_CLIENT_LIMITS);
                  }}
                >
                  {key.limits ? "Edit limits" : "Set limits"}
                </button>
                {editingKey === key.id && (
                  <form onSubmit={saveLimits} className="basis-full space-y-2 py-2">
                    <ClientKeyLimitsEditor
                      value={editLimits}
                      onChange={setEditLimits}
                      disabled={busy}
                    />
                    <button type="submit" disabled={busy} className="mr-3 underline">
                      Save limits
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="underline"
                      onClick={() => setEditingKey(null)}
                    >
                      Cancel
                    </button>
                    <p>
                      The existing key keeps working with these permissions; there is no new token
                      to copy.
                    </p>
                  </form>
                )}
                {/* Asked twice: every app holding this key stops working
                    and the key leaves the list, and neither can be taken
                    back. The cost of asking is one click on a key
                    somebody really meant to turn off. */}
                <span className="ml-auto">
                  <ConfirmButton
                    label="Turn off"
                    prompt="Apps using this key will stop working."
                    onConfirm={() => revoke(key)}
                    disabled={busy}
                    className="text-[color:var(--muted)] underline disabled:opacity-50"
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 border-t border-[color:var(--border)] pt-2">
        <p className="font-ui text-[0.6875rem] text-[color:var(--muted)]">Set up:</p>
        <ul className="mt-1 flex flex-wrap gap-2">
          {recipes.map((recipe) => (
            <li key={recipe.name}>
              <button
                type="button"
                onClick={() => setOpenRecipe(openRecipe === recipe.name ? null : recipe.name)}
                aria-expanded={openRecipe === recipe.name}
                className={`font-ui rounded-[var(--radius)] border px-2 py-1 text-[0.6875rem] ${
                  openRecipe === recipe.name
                    ? "border-[color:var(--accent-left)]"
                    : "border-[color:var(--border)]"
                }`}
              >
                {recipe.name}
              </button>
            </li>
          ))}
        </ul>
        {recipes
          .filter((r) => r.name === openRecipe)
          .map((recipe) => (
            <div key={recipe.name} className="mt-2" data-testid="recipe">
              <p className="font-ui text-[0.6875rem] text-[color:var(--muted)]">{recipe.where}</p>
              <div className="mt-1 flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-2 font-mono text-[0.6875rem]">
                  {recipe.snippet}
                </pre>
                <CopyButton text={recipe.snippet} title={`Copy the ${recipe.name} snippet`} />
              </div>
              {recipe.note && (
                <p className="font-ui mt-1 text-[0.6875rem] text-[color:var(--muted)]">
                  {recipe.note}
                </p>
              )}
              {!keyString && (
                <p className="font-ui mt-1 text-[0.6875rem] text-[color:var(--muted)]">
                  <code className="font-mono">YOUR_KEY</code> is a placeholder — make a key above
                  and it is filled in.
                </p>
              )}
            </div>
          ))}
      </div>
    </section>
  );
}

/**
 * One term and its value. The value is a `<dd>`: a `<dt>` followed by
 * bare elements is a description list with every description missing,
 * which is how a screen reader announces it. The `<dd>` is the flex row
 * the children used to sit in directly, so their `flex-1` still applies.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <dt className="font-ui w-20 shrink-0 text-sm text-[color:var(--muted)]">{label}</dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</dd>
    </div>
  );
}
