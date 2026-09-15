"use client";

/**
 * First-run wizard — the orchestrator.
 *
 * Two screens since S2 of the hobbyist UX plan (2026-09-15). At M9 this
 * file stopped containing its screens: it was 1548 lines holding eight of
 * them, the persisted draft, the backend-creation logic, port allocation,
 * topology validation and seven leaf inputs, so **nothing in it could be
 * tested without mounting the whole wizard** — which is why its test was
 * 258 lines asserting a call sequence, and why the four bugs Troy found
 * on 2026-09-10 were all found by hand and none by tests.
 *
 * Now:
 *
 *   draft.ts          the shape, the defaults, and what finishes a screen
 *   start.ts          the transaction's helpers, minus the rendering
 *   chrome.tsx        the step indicator and the footer button
 *   fields.tsx        the leaf inputs
 *   screens/*.tsx     one file per screen
 *   page.tsx          this — the flow, and the one place that writes
 *
 * **The two screens, and what each one's button commits:**
 *
 *   1. Choose a passphrase   Continue: initialize the agent, check the
 *                            components are there, initialize the trust
 *                            root, enroll this machine, write the reboot
 *                            choice to both processes.
 *   2. Where should models   Finish: point the library at the folder(s),
 *      live?                 flip firstRunComplete, open Home.
 *
 * **Why the write moved from one Start at the end to two buttons.** The
 * five-screen wizard held everything until a Start on a summary screen,
 * so screen 2 could not browse a disk — there was no session yet. Enrolling
 * on screen 1 gives screen 2 a session, and with it a folder picker over
 * the library's host and a proposed folder under that host's home, which
 * is what the design's §0.4 asked for: stop asking a new user where their
 * files are when they have none.
 *
 * **The price is two wizards' worth of state (§10 trap 8).** A tab closed
 * after Continue leaves an initialized, enrolled install with no models
 * folder. So which screen a visit opens on is decided by the INSTALL, not
 * by a saved step: `GET /v1/auth/status` says whether the passphrase step
 * is committed, and if it is, the wizard opens on screen 2 with nothing to
 * redo. A visit with a committed passphrase and no session is sent to sign
 * in and comes straight back here.
 *
 * What is gone: the Welcome screen (its one sentence is screen 1's
 * header), the summary screen, and the Backend screen, which is a task
 * and not a setup step — it lives at `/backends/add`, reachable from Home
 * once the install exists.
 *
 * The passphrase is never written to sessionStorage — it lives only in
 * component state and is dropped from the saved draft. Screen 2's choices
 * are saved, so a refresh there keeps them.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { homeFrom, proposedModelsFolder } from "@/lib/proposedModelsFolder";
import { hasSessionToken, setSessionToken } from "@/lib/session";
import type { ComponentList, DirectoryListing } from "@/lib/types";

import { WizardFooter, WizardHeader } from "./chrome";
import {
  type AuthStatusView,
  DRAFT_KEY,
  blankDraft,
  canContinue,
  chosenFolders,
  type InitializeResponse,
  requiredKindsMissing,
  restoreDraft,
  type WizardDraft,
} from "./draft";
import { type FolderProposal, ScreenFolders } from "./screens/Folders";
import { ScreenPassphrase } from "./screens/Passphrase";
import {
  controlUrlFrom,
  enrollLocalAgent,
  formatStartError,
  initializeControlRoot,
  withRetry,
} from "./start";

export default function WizardPage() {
  const router = useRouter();
  // `null` until the status probe has said which screen this visit opens
  // on. Rendering screen 1 first and then jumping would flash a passphrase
  // form at a person whose passphrase is already set.
  const [screen, setScreen] = useState<1 | 2 | null>(null);
  const [draft, setDraft] = useState<WizardDraft>(blankDraft());
  const [hydrated, setHydrated] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Passphrase state lives OUTSIDE the persisted draft — never written
  // to sessionStorage. A mid-wizard refresh re-prompts for it.
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  // What the agent measured about this host's OS keyring (S0). `null` until
  // the status probe answers, or forever against an agent that predates
  // the field - either way the draft keeps the passphrase prompt.
  const [keyringAvailable, setKeyringAvailable] = useState<boolean | null>(null);
  // The folder Eugene offers to make, once the library has been asked for
  // its home. Asked only on screen 2, because only then is there a session.
  const [proposal, setProposal] = useState<FolderProposal>({ status: "loading" });
  // Whether a saved draft was restored on mount. The probe may only set
  // the securityMode DEFAULT - a choice the operator made before a tab
  // refresh is theirs, and the status read resolves after hydration.
  const hadStoredDraft = useRef(false);
  // The router, for the probe below to redirect with. Behind a ref so the
  // probe can run exactly once: a router whose identity changes per render
  // (the test double's does, and Next's does not promise otherwise) would
  // re-run it after Continue and put a committed install back on screen 1.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // Hydrate from sessionStorage so a tab refresh mid-wizard doesn't
  // throw away typed values.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      const restored = raw ? restoreDraft(JSON.parse(raw)) : null;
      if (restored) {
        hadStoredDraft.current = true;
        setDraft(restored);
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
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // ignore
    }
  }, [hydrated, draft]);

  // One probe, two answers. Unauthenticated by design - this is the one
  // call the UI makes before a passphrase exists.
  //
  // First: can this host keep Eugene unlocked across a reboot? Default the
  // checkbox to it where it can (decision #9 of the hobbyist UX plan; the
  // old default was prompt_on_startup on every host while the copy called
  // the keyring "best for AI hobbyists").
  //
  // Second: is the passphrase step already committed? If so this visit
  // opens on screen 2 - the install exists, this machine is enrolled, and
  // the only thing missing is where models live (§10 trap 8). With no
  // session to do that under, sign in first; the login page returns here.
  useEffect(() => {
    let cancelled = false;
    async function probe() {
      let status: AuthStatusView | null = null;
      try {
        status = await api.get<AuthStatusView>("agent", "/v1/auth/status", { skipAuth: true });
      } catch {
        // Agent unreachable or an older build: open on screen 1 and let
        // Continue surface the real error.
      }
      if (cancelled) return;

      const available = status?.keyringAvailable ?? null;
      setKeyringAvailable(available);
      if (available === true && !hadStoredDraft.current) {
        setDraft((prev) => ({ ...prev, securityMode: "os_keyring" }));
      }
      if (available === false) {
        // Not a choice here: the screen says why, and the value written
        // must match what the screen showed.
        setDraft((prev) => ({ ...prev, securityMode: "prompt_on_startup" }));
      }

      if (!status?.initialized) {
        setScreen(1);
        return;
      }
      if (!hasSessionToken()) {
        routerRef.current.replace(`/login?next=${encodeURIComponent("/setup")}`);
        return;
      }
      // A finished install has nothing for this page to do, and Finish
      // here would overwrite the folders it already has with the proposal.
      try {
        const doc = await api.get<{ firstRunComplete?: boolean }>("agent", "/v1/config");
        if (cancelled) return;
        if (doc.firstRunComplete === true) {
          routerRef.current.replace("/");
          return;
        }
      } catch (e) {
        if (cancelled) return;
        // A 401 means the api client has already cleared the session and
        // is bouncing to /login; anything else is the agent mid-restart,
        // and Finish will say so if it persists.
        if (e instanceof ApiError && e.status === 401) return;
      }
      setScreen(2);
    }
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  // Screen 2 asks the library for its host's home and proposes a folder
  // under it. Retried, because screen 1's Continue restarted every child
  // (initializing, then enrolling) and the library is one of them; a
  // connection refused in that window is not an answer. Ten refusals is:
  // the first radio is disabled and the second selected, so the person
  // types or browses instead of waiting on a proposal that will not come.
  useEffect(() => {
    if (screen !== 2 || proposal.status !== "loading") return;
    let cancelled = false;
    async function lookUpHome() {
      try {
        const roots = await withRetry(() =>
          api.get<DirectoryListing>("library", "/v1/directories"),
        );
        if (cancelled) return;
        const path = proposedModelsFolder(roots);
        const home = homeFrom(roots);
        if (path && home) {
          setProposal({ status: "ready", path, home });
          return;
        }
      } catch {
        // fall through
      }
      if (cancelled) return;
      setProposal({ status: "unavailable" });
      setDraft((prev) => ({ ...prev, folderChoice: "own" }));
    }
    void lookUpHome();
    return () => {
      cancelled = true;
    };
  }, [screen, proposal.status]);

  function patchDraft(patch: Partial<WizardDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function cancel() {
    // Cancel only fires from screen 1 before Continue, so nothing has been
    // written. Clear the draft and return; the setup gate will bring the
    // person back here until the install exists.
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
    router.replace("/");
  }

  /** Screen 1's Continue: the passphrase step, committed. */
  async function commitPassphrase() {
    setWorking(true);
    setError(null);
    try {
      // Step 1: initialize the install. Sets the passphrase hash + master
      // salt on the agent, derives the master key into memory, and
      // returns a session token. After this call, the rest of the
      // wizard's calls are authenticated by the api client's auto-attach.
      setMessage("Setting your passphrase and deriving keys…");
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
      setMessage("Checking this node's components…");
      const live = await api.get<ComponentList>("agent", "/v1/components");
      const components = live.components ?? [];
      const missing = requiredKindsMissing(components);
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
      setMessage("Setting up the trust root…");
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
      const controlUrl = controlUrlFrom(components);
      if (controlUrl) {
        setMessage("Joining this machine to the install…");
        setSessionToken(await enrollLocalAgent(passphrase, controlUrl));
      }

      // Step 3: persist the chosen securityMode - on BOTH processes that
      // hold a master key on this host. Default is prompt_on_startup on
      // both, so an unchanged choice is skipped rather than written.
      //
      // Both, because the control root reads the same field: its lifespan
      // recovers its key from the OS keyring under os_keyring, its login
      // and its config PATCH both store the key, and a flip while unlocked
      // stores it at once - all built 2026-09-10. An earlier comment here
      // said the root ignored the field; it was stale, and its consequence
      // was a root that asked for the passphrase after every restart on an
      // install whose wizard had promised otherwise. Written after
      // enrollment on purpose: the session this browser holds now verifies
      // at the root, so one credential reaches both.
      if (draft.securityMode !== "prompt_on_startup") {
        setMessage("Applying security mode…");
        await api.patch("agent", "/v1/config", { securityMode: draft.securityMode });
        await api.patch("control", "/v1/config", { securityMode: draft.securityMode });
      }

      // Committed. The passphrase has done its job and need not stay in
      // memory for screen 2.
      setPassphrase("");
      setPassphraseConfirm("");
      setMessage(null);
      setWorking(false);
      setScreen(2);
    } catch (e) {
      setError(formatStartError(e));
      setWorking(false);
    }
  }

  /** Screen 2's Finish: where models live, then the install is set up. */
  async function finish() {
    setWorking(true);
    setError(null);
    try {
      const roots = chosenFolders(draft, proposal.status === "ready" ? proposal.path : null);
      // Their files stay exactly where they are - this only says where to
      // look, and where downloads land. A proposed folder that does not
      // exist yet is fine: the library makes it when the first download
      // starts, and reports it "missing" until then, which is the truth.
      setMessage("Saving where models live…");
      // Retried, because screen 1 caused restarts and the library is one of
      // the children that came back; a refusal in that window has nothing
      // to do with the person's input.
      await withRetry(() => api.patch("library", "/v1/config", { modelRoots: roots }));

      setMessage("Finalizing setup…");
      await api.patch("agent", "/v1/config", { firstRunComplete: true });

      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
      setMessage("Done — opening Home…");
      // Small delay so the person sees the final message.
      setTimeout(() => router.replace("/"), 500);
    } catch (e) {
      setError(formatStartError(e));
      setWorking(false);
    }
  }

  // Don't render screen content until hydration finishes and the probe has
  // said which screen this is, otherwise the first paint shows a form the
  // person may not need and overwrites whatever they typed before refresh.
  if (!hydrated || screen === null) {
    return (
      <main className="relative z-10 flex h-screen items-center justify-center">
        <p className="font-ui text-xs text-[color:var(--muted)]">Loading setup…</p>
      </main>
    );
  }

  const proposedPath = proposal.status === "ready" ? proposal.path : null;

  return (
    <main className="relative z-10 flex h-screen flex-col">
      <WizardHeader screen={screen} />
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-2xl">
          {screen === 1 && (
            <ScreenPassphrase
              passphrase={passphrase}
              passphraseConfirm={passphraseConfirm}
              securityMode={draft.securityMode}
              keyringAvailable={keyringAvailable}
              onPassphrase={setPassphrase}
              onPassphraseConfirm={setPassphraseConfirm}
              onSecurityMode={(v) => patchDraft({ securityMode: v })}
            />
          )}
          {screen === 2 && (
            <ScreenFolders draft={draft} proposal={proposal} onChange={patchDraft} />
          )}
          {working && message && (
            <p
              data-testid="wizard-status"
              className="mt-6 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs text-[color:var(--muted)]"
            >
              {message}
            </p>
          )}
          {error && (
            <p className="status-error mt-6 rounded-[var(--radius)] border px-3 py-2 text-xs">
              {error}
            </p>
          )}
        </div>
      </div>
      <WizardFooter
        screen={screen}
        working={working}
        canProceed={canContinue(screen, draft, passphrase, passphraseConfirm, proposedPath)}
        onCancel={cancel}
        onPrimary={screen === 1 ? () => void commitPassphrase() : () => void finish()}
      />
    </main>
  );
}
