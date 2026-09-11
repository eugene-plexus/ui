"use client";

/**
 * First-run wizard — the orchestrator.
 *
 * Five screens. At M9 this file stopped containing them: it was 1548
 * lines holding eight screens, the
 * persisted draft, the backend-creation logic, port allocation, topology
 * validation and seven leaf inputs, so **nothing in it could be tested
 * without mounting the whole wizard** — which is why its test was 258
 * lines asserting a call sequence, and why the four bugs Troy found on
 * 2026-09-10 were all found by hand and none by tests.
 *
 * Now:
 *
 *   draft.ts          the shape, the defaults, and what finishes a screen
 *   start.ts          what Start does, minus the rendering
 *   chrome.tsx        the step indicator and the navigation buttons
 *   fields.tsx        the leaf inputs
 *   screens/*.tsx     one file per screen
 *   page.tsx          this — the flow, and the one place that writes
 *
 * Screen order, cut from eight to five on 2026-09-11:
 *
 *   1. Welcome       — plain-language framing of what gets set up
 *   2. Security      — passphrase + securityMode
 *   3. Models        — the operator's model directories
 *   4. Backend       — one external backend, optional
 *   5. Done          — summary + Start (or the model picker, if a backend
 *                      was created and can be asked what it serves)
 *
 * **What went, and why it is not a matter of taste.** Deployment and
 * Gateway collected `deployment`, `gatewayHost` and `gatewayPort`, which
 * the Start transaction below never wrote to anything — grep them and the
 * only reader was the Ready screen's own summary. So the wizard asked two
 * questions, discarded both answers, and then printed one of them back as
 * if it were configuration: set `0.0.0.0:9000` there and you got an
 * install on `127.0.0.1:8080` and a summary claiming otherwise. In the
 * default local path the Gateway screen also rendered no inputs at all.
 * Look & feel wrote only `localStorage`, and `UIPreferences` on `/config`
 * has been the same two controls all along.
 *
 * **And Welcome was third**, which is how the split found it: a
 * plain-language "here is what is about to happen" arriving after the
 * operator had already chosen a font size and committed a passphrase.
 * Either it is first or it is nothing.
 *
 * What remains is what cannot be derived or defaulted: the passphrase,
 * where the model files already are, and optionally one backend the agent
 * does not supervise (which has no runtime, so nothing declares a
 * companion driver for it).
 *
 * State lives in React (with a sessionStorage mirror so a tab refresh
 * doesn't lose progress). **The actual write-to-install happens only on
 * Start** — the wizard treats the whole flow as one transaction and
 * either commits everything or commits nothing.
 *
 * Transactional order on Start:
 *   1. POST /v1/auth/initialize on the agent → session token, master key.
 *   1b. Read the topology for real, now that there is a token, and stop
 *      if a required component is missing. The first moment an empty
 *      install is distinguishable from an unauthorized read.
 *   2. POST /v1/auth/initialize on the control root. Separate because it
 *      is the trust root and mints its own auth; until it has a
 *      passphrase it answers 503 across its whole surface, by design.
 *   3. Patch securityMode, if it is not the default.
 *   4. Patch the library's model directories, if any were given.
 *   5. Create and configure the external backend's driver, if chosen,
 *      then ask it what models it has.
 *   6. Flip firstRunComplete: true.
 *
 * The passphrase is never written to sessionStorage — it lives only in
 * component state and is dropped from the saved draft. A mid-wizard
 * refresh re-prompts.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { setSessionToken } from "@/lib/session";
import type { Component, ComponentList } from "@/lib/types";

import { WizardFooter, WizardHeader } from "./chrome";
import {
  DRAFT_KEY,
  TOTAL_SCREENS,
  blankDraft,
  canContinue,
  requiredKindsMissing,
  type InitializeResponse,
  type WizardDraft,
} from "./draft";
import { ScreenBackend } from "./screens/Backend";
import { ScreenDone } from "./screens/Done";
import { ScreenModels } from "./screens/Models";
import { ScreenPickModel } from "./screens/PickModel";
import { ScreenSecurity } from "./screens/Security";
import { ScreenWelcome } from "./screens/Welcome";
import {
  buildBackendPatch,
  controlUrlFrom,
  driverNameFor,
  enrollLocalAgent,
  fetchBackendModels,
  formatStartError,
  freeDriverPort,
  initializeControlRoot,
  withRetry,
} from "./start";

export default function WizardPage() {
  const router = useRouter();
  const [screen, setScreen] = useState(1);
  const [draft, setDraft] = useState<WizardDraft>(blankDraft());
  const [hydrated, setHydrated] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [startMessage, setStartMessage] = useState<string | null>(null);
  const [knownComponents, setKnownComponents] = useState<Component[]>([]);
  // Whether that list is an answer or just an absence. Before a passphrase
  // exists the agent 401s this read, so an empty list means "not told",
  // not "nothing there" - and reporting the difference wrongly accused a
  // perfectly good install of missing every component.
  const [topologyKnown, setTopologyKnown] = useState(false);
  // Set once a backend driver has been created and asked what it can serve.
  // Its presence turns the last screen into a model picker: the driver has to
  // exist before it can list models, so this is the earliest the operator can
  // be offered a real list instead of a text box.
  const [pendingBackend, setPendingBackend] = useState<{
    name: string;
    models: string[];
  } | null>(null);
  // Passphrase state lives OUTSIDE the persisted draft — never written
  // to sessionStorage. A mid-wizard refresh re-prompts for it.
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");

  // Hydrate from sessionStorage so a tab refresh mid-wizard doesn't
  // throw away typed values.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<WizardDraft> & { screen?: number };
        // A draft saved by an earlier wizard has a `driver` object (or a
        // `drivers` tuple, older still) and no `modelRoots`. Merging one
        // produces a half-shaped draft that renders undefined fields, so
        // ignore it and start clean. The shape check moves with the shape.
        if (Array.isArray(parsed.modelRoots)) {
          setDraft((prev) => ({ ...prev, ...parsed }));
          if (
            typeof parsed.screen === "number" &&
            parsed.screen >= 1 &&
            parsed.screen <= TOTAL_SCREENS
          ) {
            setScreen(parsed.screen);
          }
        }
      }
    } catch {
      // ignore — start from defaults
    }
    setHydrated(true);
  }, []);

  // Auto-save: every draft change rewrites sessionStorage, so closing
  // the tab mid-wizard doesn't lose state. Durable cross-browser resume
  // is not attempted.
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, screen }));
    } catch {
      // ignore
    }
  }, [hydrated, draft, screen]);

  // Pull the agent's current component list once. The final screen
  // uses it for the summary and to decide what to PATCH vs. skip. The
  // endpoint is auth-protected; the wizard hasn't initialized the
  // install yet so we skip auth and tolerate a 401 — an empty list is
  // fine, Start surfaces real errors later.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await api.get<ComponentList>("agent", "/v1/components", { skipAuth: true });
        if (cancelled) return;
        setKnownComponents(list.components ?? []);
        setTopologyKnown(true);
      } catch {
        // Agent unreachable or auth-required — leave empty.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function patchDraft(patch: Partial<WizardDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function next() {
    setScreen((s) => Math.min(s + 1, TOTAL_SCREENS));
  }
  function back() {
    setScreen((s) => Math.max(s - 1, 1));
  }

  function cancel() {
    // Cancel only fires from screen 1; bail-out from later screens goes
    // back to 1 first. Stopping already-spawned children belongs to a
    // agent endpoint that doesn't exist; here we just clear the draft
    // and return so the operator can decide what to do next.
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
    router.replace("/");
  }

  async function start() {
    setStarting(true);
    setStartError(null);
    try {
      // Step 1: initialize the install. Sets the passphrase hash + master
      // salt on the agent, derives the master key into memory, and
      // returns a session token. After this call, the rest of the
      // wizard's PATCHes are authenticated by the api client's
      // auto-attach.
      setStartMessage("Setting your passphrase and deriving keys…");
      const initResp = await api.post<InitializeResponse>(
        "agent",
        "/v1/auth/initialize",
        { passphrase },
        { skipAuth: true },
      );
      setSessionToken(initResp.sessionToken);

      // Step 1b: now that there is a token, read the topology for real.
      // This is the first moment the wizard can tell an empty install from
      // an unauthorized read, and it is the check that should have stopped
      // a first run finishing against nothing. The agent declares control,
      // gateway and library on its first boot, so a missing one means its
      // package is absent from the agent's environment - unfixable from
      // here, and worth stopping for rather than reporting success.
      setStartMessage("Checking this node's components…");
      const live = await api.get<ComponentList>("agent", "/v1/components");
      const missing = requiredKindsMissing(live.components ?? []);
      if (missing.length > 0) {
        throw new Error(
          `This node has no ${missing.join(", ")}. The agent declares those on its ` +
            `first boot, so they are missing from its Python environment. Install ` +
            `them there (scripts/bootstrap.ps1 does this) and restart the agent. ` +
            `Your passphrase is set; re-run setup after fixing it.`,
        );
      }

      // Step 2: give the trust root its passphrase.
      //
      // The control root mints its own auth - the agent deliberately hands it
      // no service token - and the flip side of that is nothing else can set
      // its passphrase for it. Until it has one it answers 503 "Setup
      // required" across its entire surface (node registry, join tokens, its
      // own /v1/config) and by design it does not fall open. A first run that
      // skipped this produced an install the wizard called finished with an
      // inert trust root: only scripts/dev-seed.ps1 ever set it.
      setStartMessage("Setting up the trust root…");
      await initializeControlRoot(passphrase);

      // Step 2b: enroll THIS host's agent with the root it just spawned.
      //
      // A locked decision nothing outside an acceptance script had ever
      // done - "every node enrolls the same way, including the control
      // host's ... that is also what puts the control host in /v1/nodes
      // at all". Skipping it leaves the agent minting its own random
      // signing key while the root mints the install's, so the session
      // token this browser holds does not verify at the control root and
      // every control-root page 401s straight back to the login screen.
      // Found by M9's browser arc on /nodes, which was the first page to
      // try.
      //
      // It replaces the session, because the key it was signed with is
      // gone - the same price a rotation charges, for the same reason.
      const controlUrl = controlUrlFrom(live.components ?? []);
      if (controlUrl) {
        setStartMessage("Joining this machine to the install…");
        setSessionToken(await enrollLocalAgent(passphrase, controlUrl));
      }

      // Step 3: persist the chosen securityMode. Default is
      // prompt_on_startup; skip the patch if unchanged so we don't touch
      // the keyring needlessly. Flipping to os_keyring with the session
      // active triggers the agent's keyring write.
      //
      // Deliberately not sent to the control root as well. It declares the
      // same field and depends on `keyring`, but nothing in it reads either -
      // so patching it would record a preference that does nothing, and the
      // root would still ask for the passphrase after a restart. Implementing
      // it belongs in that repo, not in a wizard step that would look like it
      // already works.
      if (draft.securityMode !== "prompt_on_startup") {
        setStartMessage("Applying security mode…");
        await api.patch("agent", "/v1/config", {
          securityMode: draft.securityMode,
        });
      }

      // Step 4: point the library at the operator's model directories.
      // Their files stay exactly where they are - this only says where to
      // look. No driver is configured here: since M6 the agent declares one
      // companion inference-driver per runtime, so there is no driver to
      // configure until a model is launched. Asking about one up front was
      // asking about a component that could not exist yet, which is how a
      // first run could finish against an empty install.
      const roots = draft.modelRoots.map((r) => r.trim()).filter(Boolean);
      if (roots.length > 0) {
        setStartMessage("Pointing the library at your models…");
        // Retried, because step 1 caused a restart: making the master key
        // available makes the agent respawn every supervised child so they
        // pick it up, and the library is one of them. Patching it in that
        // window gets a connection refusal that has nothing to do with the
        // operator's input.
        await withRetry(() => api.patch("library", "/v1/config", { modelRoots: roots }));
      }

      // Step 5: create the external backend's driver, if one was chosen.
      // CREATE, not just configure: nothing declares a driver for a backend
      // the agent doesn't supervise, so the previous wizard's PATCH had
      // nothing to patch on a fresh install and silently did nothing.
      if (draft.backend.provider) {
        setStartMessage("Adding your backend…");
        const name = driverNameFor(draft.backend.provider, live.components ?? []);
        const port = freeDriverPort(live.components ?? []);
        await api.post("agent", "/v1/components", {
          name,
          kind: "inference-driver",
          url: `http://127.0.0.1:${port}`,
          spawn: { configFile: `${name}.yaml` },
        });
        // Its config is its own file, written once it is up. Retried for the
        // same reason as the library: this install is mid restart-on-login.
        setStartMessage("Configuring your backend…");
        await withRetry(() => api.patch(name, "/v1/config", buildBackendPatch(draft.backend)));
        // A driver reads its provider and model at startup, so PATCH alone
        // leaves `pendingRestart` and a driver still serving nothing. The
        // previous wizard called this "best-effort"; it is not optional.
        setStartMessage("Restarting your backend so it picks up the settings…");
        await withRetry(() =>
          api.post("agent", `/v1/components/${encodeURIComponent(name)}/restart`, {}),
        );

        // Now that it exists and is talking to the backend, ask it what it
        // can serve. The driver publishes discovered models as `suggestions`
        // on the modelId field of its own config schema - the same list the
        // Config page renders as a dropdown. Nothing earlier in the wizard
        // could have obtained this: there was no driver to ask, and before
        // Start there is not even a session token.
        setStartMessage("Asking your backend which models it has…");
        const models = await withRetry(() => fetchBackendModels(name));
        setPendingBackend({ name, models });
        setStarting(false);
        setStartMessage(null);
        return;
      }

      await finishSetup(null, "");
    } catch (e) {
      setStartError(formatStartError(e));
      setStarting(false);
    }
  }

  /** The last write. Separate because a backend needs a model chosen first,
   * and `firstRunComplete` must not flip until everything has landed. */
  async function finishSetup(driverName: string | null, modelId: string) {
    setStarting(true);
    setStartError(null);
    try {
      if (driverName && modelId.trim()) {
        setStartMessage("Setting the model…");
        await withRetry(() => api.patch(driverName, "/v1/config", { modelId: modelId.trim() }));
        // Read at startup, like the provider: without this the gateway lists
        // nothing and the backend is silently inert.
        setStartMessage("Restarting your backend…");
        await withRetry(() =>
          api.post("agent", `/v1/components/${encodeURIComponent(driverName)}/restart`, {}),
        );
      }

      setStartMessage("Finalizing setup…");
      await api.patch("agent", "/v1/config", { firstRunComplete: true });

      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
      setStartMessage("Done — opening the playground…");
      // Small delay so the operator sees the final message.
      setTimeout(() => router.replace("/"), 500);
    } catch (e) {
      setStartError(formatStartError(e));
      setStarting(false);
    }
  }

  // Don't render screen content until hydration finishes, otherwise the
  // first paint shows defaults and overwrites whatever the user typed
  // before refresh.
  if (!hydrated) {
    return (
      <main className="relative z-10 flex h-screen items-center justify-center">
        <p className="font-ui text-xs text-[color:var(--muted)]">Loading setup…</p>
      </main>
    );
  }

  return (
    <main className="relative z-10 flex h-screen flex-col">
      <WizardHeader screen={screen} />
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-2xl">
          {screen === 1 && <ScreenWelcome />}
          {screen === 2 && (
            <ScreenSecurity
              passphrase={passphrase}
              passphraseConfirm={passphraseConfirm}
              securityMode={draft.securityMode}
              onPassphrase={setPassphrase}
              onPassphraseConfirm={setPassphraseConfirm}
              onSecurityMode={(v) => patchDraft({ securityMode: v })}
            />
          )}
          {screen === 3 && (
            <ScreenModels
              roots={draft.modelRoots}
              onChange={(modelRoots) => patchDraft({ modelRoots })}
            />
          )}
          {screen === 4 && (
            <ScreenBackend
              backend={draft.backend}
              onChange={(patch) => patchDraft({ backend: { ...draft.backend, ...patch } })}
            />
          )}
          {screen === 5 && pendingBackend && (
            <ScreenPickModel
              driverName={pendingBackend.name}
              models={pendingBackend.models}
              value={draft.backend.modelId}
              onChange={(v) => patchDraft({ backend: { ...draft.backend, modelId: v } })}
              starting={starting}
              startMessage={startMessage}
              startError={startError}
            />
          )}
          {screen === 5 && !pendingBackend && (
            <ScreenDone
              draft={draft}
              knownComponents={knownComponents}
              topologyKnown={topologyKnown}
              starting={starting}
              startMessage={startMessage}
              startError={startError}
            />
          )}
        </div>
      </div>
      <WizardFooter
        screen={screen}
        onCancel={cancel}
        onBack={back}
        onNext={next}
        onStart={
          pendingBackend
            ? () => void finishSetup(pendingBackend.name, draft.backend.modelId)
            : start
        }
        startLabel={pendingBackend ? "Finish" : "Start"}
        starting={starting}
        canContinue={canContinue(screen, draft, passphrase, passphraseConfirm)}
      />
    </main>
  );
}
