"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
  sameOffsetCandidate,
  verifyGatewayAddress,
} from "@/lib/gatewayAddress";
import type {
  ClientKey,
  ClientKeyCreated,
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
 * **The key is minted on the gateway's node**, because that is the agent
 * the gateway asks about revocations. Minting anywhere else would leave
 * a Remove button that changes nothing. `clientKeyTarget` works out
 * which, and the card names the machine.
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
  const [keys, setKeys] = useState<ClientKey[] | null>(null);
  const [fresh, setFresh] = useState<ClientKeyCreated | null>(null);
  const [name, setName] = useState("");
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
      setError(null);
    } catch (e) {
      // An agent on another node that is down costs this card its list
      // and nothing else; the address and the model id are still right.
      setKeys([]);
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
    setEvidence(portRemapEvidence(window.location, boundAddresses));
  }, [boundAddresses]);
  const remap = describeRemap(evidence);

  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const check = useCallback(async () => {
    if (!baseUrl) return;
    setChecking(true);
    setCandidate(null);
    try {
      // The key when there is one -- it upgrades the answer from "the
      // gateway is there" to "and it serves these models", which is the
      // other half of the same class of bug: a client configured with a
      // model id that names nothing.
      const found = await verifyGatewayAddress(baseUrl, { key: keyString });
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
          if (probe.kind === "confirmed") setCandidate(guess);
        }
      }
    } finally {
      setChecking(false);
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
    ? describeVerdict(verdict, baseUrl, { remapped: evidence.kind === "remapped" })
    : null;

  async function mint(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await api.post<ClientKeyCreated>(where.target, "/v1/auth/client-keys", {
        name: name.trim() || "My app",
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
      <h2 className="font-ui text-xs font-semibold">Use it from your apps</h2>
      <p className="font-ui mt-1 text-xs text-[color:var(--muted)]">
        Three things to paste into Continue, Open WebUI, SillyTavern or anything that speaks to
        OpenAI.
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
                data-testid="base-url-input"
                placeholder="http://192.168.1.20:8080"
                className="min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs"
              />
              <button type="submit" className="font-ui text-[11px] underline">
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="font-ui text-[11px] text-[color:var(--muted)] underline"
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
                className="font-ui text-[11px] text-[color:var(--muted)] underline"
              >
                {override ? "Change" : "Not right?"}
              </button>
            </>
          )}
        </Row>
        <div className="flex flex-col gap-1 pl-[5.5rem]">
          {display && (
            <p
              data-testid="base-url-verdict"
              data-verdict={verdict?.kind ?? (checking ? "checking" : "none")}
              className={
                verdictText
                  ? `${TONE_CLASS[verdictText.tone]} font-ui rounded-[var(--radius)] px-2 py-1 text-[11px]`
                  : "font-ui text-[11px] text-[color:var(--muted)]"
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

          {/* Only ever rendered for a candidate that ANSWERED as this
              gateway. The offset that produced it is a guess and is
              never shown as one; the probe is what earns it a place. */}
          {candidate && (
            <p
              data-testid="base-url-candidate"
              className="status-success font-ui rounded-[var(--radius)] px-2 py-1 text-[11px]"
            >
              {describeCandidate(candidate)}{" "}
              <button
                type="button"
                data-testid="base-url-use-candidate"
                onClick={() => saveOverride(candidate)}
                className="font-semibold underline"
              >
                Use {candidate}
              </button>
            </p>
          )}

          {/* Suppressed once the address is proven: the check outranks
              the doubt, and leaving a warning under a confirmation is
              how a person learns to ignore both. */}
          {remap && verdict?.kind !== "confirmed" && (
            <p
              data-testid="base-url-remap"
              className="status-warn font-ui rounded-[var(--radius)] px-2 py-1 text-[11px]"
            >
              {remap}
            </p>
          )}

          <p className="font-ui text-[11px] text-[color:var(--muted)]">
            {override
              ? "You corrected this address; this browser will remember it."
              : "Worked out from the gateway's port and this page's address. If your install publishes " +
                "that port differently — a container remap, for instance — correct it here."}
          </p>
        </div>

        <Row label="Model">
          {models.length > 1 ? (
            <select
              data-testid="app-model"
              value={model ?? ""}
              onChange={(e) => setModel(e.target.value)}
              className="min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs"
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
            <span className="font-ui flex-1 text-xs text-[color:var(--muted)]">
              {liveKeys.length === 0
                ? "none yet"
                : `${liveKeys.length} key${liveKeys.length === 1 ? "" : "s"} made; a key is shown once, so make a new one if you no longer have it`}
            </span>
          )}
        </Row>
      </dl>

      {fresh && (
        <p className="status-warn mt-2 rounded-[var(--radius)] px-2 py-1 text-[11px]">
          Copy this now — it is shown once and is not stored anywhere. Lose it and you make another.
        </p>
      )}

      {missing.length > 0 && !fresh && (
        <ul className="font-ui mt-2 flex flex-col gap-1 text-[11px] text-[color:var(--muted)]">
          {missing.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <form onSubmit={mint} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="key-name"
          placeholder="What is it for? e.g. Continue on the laptop"
          className="font-ui min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 text-xs"
        />
        <button
          type="submit"
          data-testid="make-key"
          disabled={busy}
          className="font-ui rounded-[var(--radius)] border border-[color:var(--accent-left)] px-3 py-1 text-xs font-semibold disabled:opacity-50"
        >
          {busy ? "Working…" : "Make a key"}
        </button>
      </form>
      <p className="font-ui mt-1 text-[11px] text-[color:var(--muted)]">
        Good for a year, works only for chatting with your models, and can be turned off on its own.
        Kept on {where.node ?? "this machine"}
        {where.derived === "gateway-node" ? ", the machine running the gateway" : ""}.
      </p>

      {error && (
        <p
          data-testid="key-error"
          className="status-error mt-2 rounded-[var(--radius)] px-2 py-1 text-[11px]"
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
                className="font-ui flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[color:var(--border)] pt-1 text-[11px]"
              >
                <span className="font-semibold">{key.name}</span>
                <code className="font-mono">{keyLabel(key.tail)}</code>
                <span className="text-[color:var(--muted)]">{status.text}</span>
                <button
                  type="button"
                  onClick={() => void revoke(key)}
                  disabled={busy}
                  className="ml-auto text-[color:var(--muted)] underline disabled:opacity-50"
                >
                  Turn off
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 border-t border-[color:var(--border)] pt-2">
        <p className="font-ui text-[11px] text-[color:var(--muted)]">Set up:</p>
        <ul className="mt-1 flex flex-wrap gap-2">
          {recipes.map((recipe) => (
            <li key={recipe.name}>
              <button
                type="button"
                onClick={() => setOpenRecipe(openRecipe === recipe.name ? null : recipe.name)}
                aria-expanded={openRecipe === recipe.name}
                className={`font-ui rounded-[var(--radius)] border px-2 py-1 text-[11px] ${
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
              <p className="font-ui text-[11px] text-[color:var(--muted)]">{recipe.where}</p>
              <div className="mt-1 flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--bg)] p-2 font-mono text-[11px]">
                  {recipe.snippet}
                </pre>
                <CopyButton text={recipe.snippet} title={`Copy the ${recipe.name} snippet`} />
              </div>
              {recipe.note && (
                <p className="font-ui mt-1 text-[11px] text-[color:var(--muted)]">{recipe.note}</p>
              )}
              {!keyString && (
                <p className="font-ui mt-1 text-[11px] text-[color:var(--muted)]">
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <dt className="font-ui w-20 shrink-0 text-xs text-[color:var(--muted)]">{label}</dt>
      {children}
    </div>
  );
}
