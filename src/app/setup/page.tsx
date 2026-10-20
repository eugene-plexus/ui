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
 * by a saved step.
 *
 * **Each step's own state, since CX2.** Only the agent's passphrase was
 * read, so when a later step of Continue failed the next visit opened
 * screen 2 and the rest never ran: Finish could leave a control root with
 * no passphrase. Now `readSetupProgress` reads each step (the root's
 * `initialized`, this agent's `enrolled`, both processes' `securityMode`),
 * and anything left opens screen 1 in its resume form (`ScreenResume`),
 * which runs from the first step not done. A failure after the agent's
 * passphrase is set switches to that form too, with Try again. A visit
 * with no session signs in on that form, so a person who comes back types
 * the passphrase once.
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

import { SetupGateScreen } from "@/components/SetupGateScreen";
import { ApiError, api } from "@/lib/api";
import { pageTitle, useDocumentTitle } from "@/lib/pageTitle";
import {
  homeFrom,
  parentOf,
  presetModelsFolder,
  proposedModelsFolder,
} from "@/lib/proposedModelsFolder";
import { hasSessionToken, setSessionToken } from "@/lib/session";
import type { DirectoryListing } from "@/lib/types";
import { SETUP_GATE_TIMEOUT_MS, isNoAnswer } from "@/lib/useSetupGate";
import { expertHint } from "@/lib/vocabulary";

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
  type SecurityMode,
  type WizardDraft,
} from "./draft";
import { type FolderProposal, ScreenFolders } from "./screens/Folders";
import { ScreenPassphrase } from "./screens/Passphrase";
import { ScreenResume } from "./screens/Resume";
import {
  type SetupProgress,
  controlUrlFrom,
  enrollLocalAgent,
  formatStartError,
  initializeControlRoot,
  modeToOffer,
  needsPassphrase,
  readControlMode,
  readSetupProgress,
  screenOneLeft,
  stepsLeft,
  verifyPassphrase,
  withRetry,
} from "./start";

// The progress reads include `GET /v1/node`, which reads the host
// firewall (COM on Windows) and can take seconds; the status probe's 10 s
// would call a slow but healthy agent unreachable.
const PROGRESS_TIMEOUT_MS = 30_000;

export default function WizardPage() {
  const router = useRouter();
  // One install being raised, so there is no machine to name and nothing
  // to tell two tabs of this apart -- the wizard is a linear transaction
  // and a second tab of it is the failure, not a case to label.
  useDocumentTitle(pageTitle({ page: "Set up", node: null, machines: 1 }));
  // `null` until the status probe has said which screen this visit opens
  // on. Rendering screen 1 first and then jumping would flash a passphrase
  // form at a person whose passphrase is already set.
  const [screen, setScreen] = useState<1 | 2 | null>(null);
  // The probe below had no deadline, so a hung agent left "Loading
  // setup…" on screen forever. No answer is its own screen now, with
  // Try again, as the setup gate's is.
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<WizardDraft>(blankDraft());
  const [hydrated, setHydrated] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A step's plain sentence, optionally with the expert term behind a
   *  tooltip -- decision #12's condition. A bare string is the common
   *  case and stays a bare string. */
  type Status = string | { text: string; hint: string };
  const [message, setMessage] = useState<Status | null>(null);
  // Passphrase state lives OUTSIDE the persisted draft — never written
  // to sessionStorage. A mid-wizard refresh re-prompts for it.
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [machineName, setMachineName] = useState("");
  // What the agent measured about this host's OS keyring (S0). `null` until
  // the status probe answers, or forever against an agent that predates
  // the field - either way the draft keeps the passphrase prompt.
  const [keyringAvailable, setKeyringAvailable] = useState<boolean | null>(null);
  // The agent runs under its own account and unlocks itself from a file
  // (the Linux system install). Not a choice: the screen says so.
  const [passphraseFile, setPassphraseFile] = useState(false);
  // CX2. "resume" once the agent's passphrase is set: from then on screen 1
  // carries on from the first step not done and never initializes again.
  const [form, setForm] = useState<"fresh" | "resume">("fresh");
  // What the install already has of screen 1; `null` until read, which
  // takes a session.
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  // The passphrase held in state is the install's: the agent accepted it,
  // at initialize or at sign-in, in this tab.
  const [verified, setVerified] = useState(false);
  // A step failed after the passphrase was set: the button says Try again.
  const [failed, setFailed] = useState(false);
  // The folder Eugene offers to make, once the library has been asked for
  // its home. Asked only on screen 2, because only then is there a session.
  const [proposal, setProposal] = useState<FolderProposal>({ status: "loading" });
  // Whether a saved draft was restored on mount. The probe may only set
  // the securityMode DEFAULT - a choice the operator made before a tab
  // refresh is theirs, and the status read resolves after hydration.
  const hadStoredDraft = useRef(false);
  // What this host recommends for the restart choice, from the probe: the
  // keyring where there is one, the file under its own account.
  const hostDefaultRef = useRef<SecurityMode>("prompt_on_startup");
  // The resume form has shown what is left, so Continue runs it rather
  // than reading and showing it again.
  const listShown = useRef(false);
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
        status = await api.get<AuthStatusView>("agent", "/v1/auth/status", {
          skipAuth: true,
          timeoutMs: SETUP_GATE_TIMEOUT_MS,
        });
      } catch (e) {
        if (cancelled) return;
        if (isNoAnswer(e)) {
          setUnreachable(true);
          return;
        }
        // An older build that answered without the endpoint: open on
        // screen 1 and let Continue surface the real error.
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
      // Last, so it wins over the keyring branch above: an agent under its
      // own account has no keyring (false) and needs none. The control
      // root on this host reads the same file, so step 3 writes the mode
      // to both, as it does for the keyring.
      if (status?.passphraseFile === true) {
        setPassphraseFile(true);
        setDraft((prev) => ({ ...prev, securityMode: "passphrase_file" }));
      }

      hostDefaultRef.current =
        status?.passphraseFile === true
          ? "passphrase_file"
          : available === true
            ? "os_keyring"
            : "prompt_on_startup";
      if (!status?.initialized) {
        setScreen(1);
        return;
      }
      // The passphrase is set. With no session there is nothing to read
      // the other steps with, so the resume form signs in first (this used
      // to send the person to /login, and then the passphrase was asked
      // for again).
      setForm("resume");
      if (!hasSessionToken()) {
        setScreen(1);
        return;
      }
      let read: SetupProgress;
      try {
        read = await readSetupProgress(PROGRESS_TIMEOUT_MS);
      } catch (e) {
        if (cancelled) return;
        // A 401 means the api client has already cleared the session and
        // is bouncing to /login.
        if (e instanceof ApiError && e.status === 401) return;
        if (isNoAnswer(e)) {
          setUnreachable(true);
          return;
        }
        // Anything else: sign in again on the resume form, which reads it
        // afresh.
        setScreen(1);
        return;
      }
      if (cancelled) return;
      // A finished install has nothing for this page to do, and Finish
      // here would overwrite the folders it already has with the proposal.
      if (read.firstRunComplete) {
        routerRef.current.replace("/");
        return;
      }
      const mode = offeredMode(read, status.passphraseFile === true, available);
      setDraft((prev) => ({ ...prev, securityMode: mode }));
      if (screenOneLeft(read, mode)) {
        listShown.current = true;
        setProgress(read);
        setScreen(1);
        return;
      }
      setScreen(2);
    }
    void probe();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

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
        // A folder the installer chose wins: the library's home is its own
        // account's, which on a system install is not the person's.
        const preset = presetModelsFolder(
          await api.get<{ folders?: unknown }>("library", "/v1/folders").catch(() => null),
        );
        if (cancelled) return;
        if (preset) {
          setProposal({ status: "ready", path: preset, home: parentOf(preset) });
          return;
        }
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

  /** The restart choice a resume offers: forced where the host leaves no
   * choice, otherwise the person's own if screen 1 wrote one, otherwise
   * the host's recommendation (`modeToOffer`). */
  function offeredMode(
    read: SetupProgress,
    ownAccount: boolean,
    keyring: boolean | null,
  ): SecurityMode {
    if (ownAccount) return "passphrase_file";
    if (keyring === false) return "prompt_on_startup";
    return modeToOffer(read, hostDefaultRef.current);
  }

  function patchDraft(patch: Partial<WizardDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  /** Screen 1's Continue: the passphrase step, committed. */
  async function commitPassphrase() {
    setWorking(true);
    setError(null);
    // Read once, at the click: `form` is this render's value, and the
    // branch below changes it.
    const resuming = form === "resume";
    try {
      let justSet = false;
      if (!resuming) {
        // Step 1: initialize the install. Sets the passphrase hash + master
        // salt on the agent, derives the master key into memory, and
        // returns a session token. After this call, the rest of the
        // wizard's calls are authenticated by the api client's auto-attach.
        setMessage("Setting your passphrase and deriving keys…");
        try {
          const initResp = await api.post<InitializeResponse>(
            "agent",
            "/v1/auth/initialize",
            { passphrase },
            { skipAuth: true },
          );
          setSessionToken(initResp.sessionToken);
          justSet = true;
        } catch (e) {
          // Already set: an earlier click whose answer was lost, or another
          // tab. Carry on as a resume, which checks this passphrase against
          // the one the agent holds before it goes anywhere else.
          if (!(e instanceof ApiError && e.status === 409)) throw e;
        }
        // From here on a failure resumes; it never initializes again. The
        // person has seen this form and made its choices, so Try again
        // runs what is left rather than stopping to show it.
        listShown.current = true;
        setForm("resume");
        setVerified(justSet);
      }
      await carryOn(justSet, resuming);
    } catch (e) {
      setError(formatStartError(e));
      setFailed(true);
      setWorking(false);
    }
  }

  /**
   * Every step of screen 1 after the agent's passphrase, from the first
   * one not done (CX2).
   *
   * `justSet`: the agent accepted this passphrase at initialize in this
   * same click. Otherwise a held passphrase is checked by signing in at
   * the agent first, which also replaces a session that a half-done
   * enrollment left unverifiable.
   */
  async function carryOn(justSet: boolean, resuming: boolean) {
    if (passphrase && !justSet) {
      setMessage("Checking your passphrase…");
      setSessionToken(await verifyPassphrase(passphrase));
      setVerified(true);
    }
    setMessage("Checking what is left to set up…");
    const read = await readSetupProgress(PROGRESS_TIMEOUT_MS);
    setProgress(read);
    if (read.firstRunComplete) {
      router.replace("/");
      return;
    }

    // Now that there is a token, the topology is read for real. This is
    // the check that should have stopped a first run finishing against
    // nothing. The agent declares control, gateway and library on its
    // first boot, so a missing one means its package is absent from the
    // agent's environment - unfixable from here, and worth stopping for
    // rather than reporting success.
    const missing = requiredKindsMissing(read.components);
    if (missing.length > 0) {
      throw new Error(
        `This machine has no ${missing.join(", ")}: they are missing from the agent's ` +
          `Python environment. Install them there (scripts/bootstrap.ps1 does this) ` +
          `and restart the agent. Your passphrase is set; open setup again afterwards.`,
      );
    }
    // Signed in from a form that did not know what was left: the restart
    // choice comes from the install, as the probe's does, and what is left
    // is shown before any of it runs.
    const firstRead = resuming && !listShown.current;
    let mode = draft.securityMode;
    if (firstRead) {
      mode = offeredMode(read, passphraseFile, keyringAvailable);
      patchDraft({ securityMode: mode });
    }
    if (!screenOneLeft(read, mode)) {
      finishScreenOne();
      return;
    }
    if (firstRead) {
      listShown.current = true;
      setMessage(null);
      setWorking(false);
      return;
    }
    if (needsPassphrase(read) && !passphrase) {
      throw new Error("Type your passphrase to carry on.");
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
    if (!read.controlInitialized) {
      setMessage({
        text: "Setting up this install’s security…",
        // Decision #12, and Troy took it ON CONDITION that "the proper
        // jargon stays available in a tooltip or other hint for advanced
        // users". So the implementation noun moves here rather than going.
        hint: expertHint(
          "Initializing the trust root (the control root), which holds the install’s signing key.",
        ),
      });
      await initializeControlRoot(passphrase);
    }

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
    let controlMode = read.controlMode;
    if (!read.enrolled) {
      const controlUrl = controlUrlFrom(read.components);
      if (controlUrl) {
        setMessage("Joining this machine to the install…");
        setSessionToken(await enrollLocalAgent(passphrase, controlUrl, machineName));
        // Readable now: the session verifies at the root.
        controlMode = await readControlMode();
      }
    }

    // Step 3: persist the chosen securityMode - on BOTH processes that
    // hold a master key on this host, each only where it differs (CX2: it
    // used to skip the default, which a resume cannot assume is in place).
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
    if (read.agentMode !== mode || controlMode !== mode) {
      setMessage("Applying security mode…");
      if (read.agentMode !== mode) {
        await api.patch("agent", "/v1/config", { securityMode: mode });
      }
      if (controlMode !== mode) {
        await api.patch("control", "/v1/config", { securityMode: mode });
      }
    }

    finishScreenOne();
  }

  /** Committed. The passphrase has done its job and need not stay in
   * memory for screen 2. */
  function finishScreenOne() {
    setPassphrase("");
    setPassphraseConfirm("");
    setVerified(false);
    setFailed(false);
    setMessage(null);
    setWorking(false);
    setScreen(2);
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

      // **And then look in it.** `PATCH /v1/config` deliberately does not
      // scan -- the library's own words: "a PATCH that quietly scans" is
      // not a thing to do to somebody's disk without being asked. But
      // Finish *is* being asked, and until something scans, a person who
      // said "I already have models" and pointed at a folder full of them
      // lands on a Home that says *0 models on disk* and offers to
      // download a 16 GB one. Measured on a fresh install by S10's first
      // execution: the library logged "no model directories configured;
      // skipping the startup scan" at boot, the root arrived afterwards,
      // and nothing ever went back to look.
      //
      // Soft, and last: the folder is saved either way, the scan runs in
      // the background, and an install whose library is briefly away
      // should finish setup rather than fail it. The Library's own Scan
      // button is the retry.
      if (roots.length > 0) {
        await api.post("library", "/v1/scan", {}).catch(() => undefined);
      }

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
  if (unreachable) {
    return (
      <SetupGateScreen
        state="unreachable"
        onRetry={() => {
          setUnreachable(false);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  if (!hydrated || screen === null) {
    return (
      <main className="relative z-10 flex h-screen items-center justify-center">
        <p className="font-ui text-sm text-[color:var(--muted)]">Loading setup…</p>
      </main>
    );
  }

  const proposedPath = proposal.status === "ready" ? proposal.path : null;
  // The resume form asks the passphrase only while what is left needs it
  // and this tab does not already hold the install's.
  const askPassphrase = form === "resume" && !verified && needsPassphrase(progress);
  const canProceed =
    screen === 1 && form === "resume"
      ? !askPassphrase || passphrase.length > 0
      : canContinue(screen, draft, passphrase, passphraseConfirm, proposedPath);

  const body = (
    <>
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-2xl">
          {/* Nothing on the screen changes while its button's steps run: a
              choice toggled mid-run would be shown and not applied. */}
          <fieldset disabled={working} className="m-0 min-w-0 border-0 p-0">
            {screen === 1 && form === "resume" && (
              <ScreenResume
                stepsLeft={progress ? stepsLeft(progress, draft.securityMode) : null}
                askPassphrase={askPassphrase}
                askName={progress !== null && !progress.enrolled}
                passphrase={passphrase}
                onPassphrase={setPassphrase}
                machineName={machineName}
                onMachineName={setMachineName}
                securityMode={draft.securityMode}
                keyringAvailable={keyringAvailable}
                passphraseFile={passphraseFile}
                onSecurityMode={(v) => patchDraft({ securityMode: v })}
              />
            )}
            {screen === 1 && form === "fresh" && (
              <ScreenPassphrase
                passphrase={passphrase}
                passphraseConfirm={passphraseConfirm}
                securityMode={draft.securityMode}
                keyringAvailable={keyringAvailable}
                passphraseFile={passphraseFile}
                machineName={machineName}
                onMachineName={setMachineName}
                onPassphrase={setPassphrase}
                onPassphraseConfirm={setPassphraseConfirm}
                onSecurityMode={(v) => patchDraft({ securityMode: v })}
              />
            )}
            {screen === 2 && (
              <ScreenFolders draft={draft} proposal={proposal} onChange={patchDraft} />
            )}
          </fieldset>
          {working && message && (
            <p
              data-testid="wizard-status"
              title={typeof message === "string" ? undefined : message.hint}
              className="mt-6 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm text-[color:var(--muted)]"
            >
              {typeof message === "string" ? message : message.text}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="status-error mt-6 rounded-[var(--radius)] border px-3 py-2 text-sm"
            >
              {error}
            </p>
          )}
        </div>
      </div>
      <WizardFooter
        screen={screen}
        working={working}
        canProceed={canProceed}
        primaryLabel={screen === 1 && failed ? "Try again" : undefined}
        onPrimary={screen === 1 ? () => void commitPassphrase() : () => void finish()}
        submits={screen === 1}
      />
    </>
  );

  // Screen 1 is a form, so Enter in either box presses Continue. Screen 2
  // is not: its folder picker renders a form of its own, and forms do not
  // nest.
  return (
    <main className="relative z-10 flex h-screen flex-col">
      <WizardHeader screen={screen} />
      {screen === 1 ? (
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (!working && canProceed) void commitPassphrase();
          }}
        >
          {body}
        </form>
      ) : (
        body
      )}
    </main>
  );
}
