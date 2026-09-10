"use client";

/**
 * First-run wizard.
 *
 * Linear seven-screen flow:
 *
 *   1. Look & feel   — local theme + font, live preview
 *   2. Security      — passphrase + securityMode
 *   3. Welcome       — plain-language framing of what gets set up
 *   4. Deployment    — all-local vs. networked
 *   5. Gateway       — host:port shown only in networked mode
 *   6. Driver        — provider + credential + model for one backend
 *   7. Done          — summary + Start
 *
 * Was ten screens. Memory, Identity and Connectors were screens for
 * components that no longer exist, and the second Driver screen existed
 * because two hemispheres had to disagree with each other — a control
 * plane's N drivers are all the same kind of thing, so one is the shape
 * of the question and the rest get added from Config.
 *
 * This is a cut, not the rewrite. The wizard still assumes the operator
 * has components in the agent topology already and cannot create
 * them, and it has nothing to say about engine runtimes or a model
 * library because neither is acquirable yet. The real first-run flow —
 * fetch an engine, point at a model directory, launch a runtime, front
 * it with a driver, none of it by hand-editing YAML — needs M1 and M2 to
 * exist first, and lands at M6.
 *
 * Navigation rules:
 *   - Screen 1: `Cancel` + `Continue →`
 *   - Screens 2–6: `← Back` + `Continue →`
 *   - Screen 7: `← Back` + `Start`
 *
 * State lives in React (with sessionStorage mirror so a tab refresh
 * doesn't lose progress). The actual write-to-agent happens only on
 * the final Start button — the wizard treats the entire flow as one
 * transaction and either commits everything or commits nothing.
 *
 * Transactional order on Start:
 *   1. POST /v1/auth/initialize with the wizard's passphrase → get a
 *      session token, populate AuthState.master_key on the agent.
 *   2. Patch the chosen securityMode (default is prompt_on_startup,
 *      skip the patch if unchanged). Switching to os_keyring with the
 *      session active persists the master key for auto-unlock.
 *   3. Patch the driver's provider / credential / model config
 *      (encrypted at rest now that a master key exists).
 *   4. Flip firstRunComplete: true.
 *
 * If step 1 fails (e.g. install already initialized), surface the error
 * and let the operator either log in or reset the install by hand.
 *
 * The wizard never persists the passphrase to sessionStorage — it lives
 * only in component state and is dropped from the saved draft when the
 * mirror writes. Refreshing mid-wizard re-prompts.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { setSessionToken } from "@/lib/session";
import { useFontSize, FONT_SIZE_LABELS, type FontSize } from "@/lib/useFontSize";
import { useTheme, type Theme } from "@/lib/useTheme";
import type { Component, ComponentList } from "@/lib/types";

const DRAFT_KEY = "eugene-wizard-draft";
const TOTAL_SCREENS = 7;

type DeploymentMode = "local" | "networked";
type SecurityMode = "prompt_on_startup" | "os_keyring";

interface InitializeResponse {
  sessionToken: string;
  expiresAt: string;
  operatorName?: string | null;
}

interface WizardDraft {
  deployment: DeploymentMode;
  gatewayHost: string;
  gatewayPort: number;
  modelRoots: string[];
  securityMode: SecurityMode;
}

function blankDraft(): WizardDraft {
  return {
    deployment: "local",
    gatewayHost: "127.0.0.1",
    gatewayPort: 8080,
    modelRoots: [],
    securityMode: "prompt_on_startup",
  };
}

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

      // Step 2: persist the chosen securityMode. Default is
      // prompt_on_startup; skip the patch if unchanged so we don't touch
      // the keyring needlessly. Flipping to os_keyring with the session
      // active triggers the agent's keyring write.
      if (draft.securityMode !== "prompt_on_startup") {
        setStartMessage("Applying security mode…");
        await api.patch("agent", "/v1/config", {
          securityMode: draft.securityMode,
        });
      }

      // Step 3: point the library at the operator's model directories.
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
      const detail = formatStartError(e);
      setStartError(detail);
      setStarting(false);
    }
  }

  function formatStartError(e: unknown): string {
    if (e instanceof ApiError) {
      if (e.status === 409) {
        return (
          "This install already has a passphrase set. Use the login page " +
          "to sign in, or reset the install by removing the auth block " +
          "from agent.yaml by hand."
        );
      }
      if (
        typeof e.body === "object" &&
        e.body !== null &&
        "detail" in e.body &&
        typeof (e.body as { detail?: unknown }).detail === "object"
      ) {
        const detail = (e.body as { detail: { title?: string; detail?: string } }).detail;
        return detail.detail || detail.title || `${e.status} ${e.statusText}`;
      }
      return `${e.status} ${e.statusText}`;
    }
    return e instanceof Error ? e.message : String(e);
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
          {screen === 1 && <ScreenLookFeel />}
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
          {screen === 3 && <ScreenWelcome />}
          {screen === 4 && (
            <ScreenDeployment
              value={draft.deployment}
              onChange={(v) => patchDraft({ deployment: v })}
            />
          )}
          {screen === 5 && (
            <ScreenGateway
              mode={draft.deployment}
              host={draft.gatewayHost}
              port={draft.gatewayPort}
              onChange={(host, port) => patchDraft({ gatewayHost: host, gatewayPort: port })}
            />
          )}
          {screen === 6 && (
            <ScreenModels
              roots={draft.modelRoots}
              onChange={(modelRoots) => patchDraft({ modelRoots })}
            />
          )}
          {screen === 7 && (
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
        onStart={start}
        starting={starting}
        canContinue={canContinue(screen, draft, passphrase, passphraseConfirm)}
      />
    </main>
  );
}

/**
 * Retry a call across the restart the wizard itself causes.
 *
 * `POST /v1/auth/initialize` makes the master key available, and the agent
 * responds by respawning every supervised child so each one gets it. Anything
 * the wizard does immediately afterwards can land in that window and be
 * refused, which reads to the operator as their setup failing.
 */
async function withRetry<T>(call: () => Promise<T>, attempts = 10, delayMs = 1000): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await call();
    } catch (e) {
      lastError = e;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

const REQUIRED_KINDS = ["control", "gateway", "library"] as const;

/**
 * Which of the components every install must have are absent.
 *
 * Only meaningful against a list that was actually read. An unauthenticated
 * `GET /v1/components` 401s on an install with no passphrase yet, and
 * treating that empty result as an answer told an operator with a perfectly
 * good three-component install that all three were missing.
 */
function requiredKindsMissing(components: Component[]): string[] {
  return REQUIRED_KINDS.filter((kind) => !components.some((c) => c.kind === kind));
}

function canContinue(
  screen: number,
  draft: WizardDraft,
  passphrase: string,
  passphraseConfirm: string,
): boolean {
  // Screen 2 is Security — passphrase non-empty AND confirmation
  // matches. Length validation lives server-side (Argon2 will accept
  // anything non-empty); we only block the obvious typo.
  if (screen === 2) {
    return passphrase.length > 0 && passphrase === passphraseConfirm;
  }
  // Screen 6 is model directories, and none is a valid answer: directories
  // can be added later from Config, and Discover downloads into one. Nothing
  // on this screen should be able to block a first run.
  return true;
}

function WizardHeader({ screen }: { screen: number }) {
  // Progress fill = current screen / total. Screen 1 shows 10% (the
  // user has just landed on the first screen, not zero progress);
  // Screen 10 shows 100% — Start is the only action left.
  const progressPercent = Math.round((screen / TOTAL_SCREENS) * 100);
  return (
    <header className="bg-[color:var(--panel)]">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <p className="font-mono text-[10px] tracking-wider text-[color:var(--muted)] uppercase">
            first-run setup
          </p>
          <h1 className="font-ui text-base font-semibold">Eugene Plexus</h1>
        </div>
        <p className="font-mono text-[11px] text-[color:var(--muted)]">
          Step {screen} of {TOTAL_SCREENS}
        </p>
      </div>
      <div
        className="h-1 w-full bg-[color:var(--border)]"
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Setup progress: step ${screen} of ${TOTAL_SCREENS}`}
      >
        <div
          className="h-full bg-[color:var(--accent-left)] transition-[width] duration-300 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </header>
  );
}

function WizardFooter({
  screen,
  onCancel,
  onBack,
  onNext,
  onStart,
  starting,
  canContinue,
}: {
  screen: number;
  onCancel: () => void;
  onBack: () => void;
  onNext: () => void;
  onStart: () => void;
  starting: boolean;
  canContinue: boolean;
}) {
  const showCancel = screen === 1;
  const showBack = screen > 1;
  const showStart = screen === TOTAL_SCREENS;

  return (
    <footer className="flex items-center justify-between border-t border-[color:var(--border)] bg-[color:var(--panel)] px-6 py-4">
      <div>
        {showCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-4 py-2 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Cancel
          </button>
        ) : showBack ? (
          <button
            type="button"
            onClick={onBack}
            disabled={starting}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-4 py-2 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Back
          </button>
        ) : null}
      </div>
      <div>
        {showStart ? (
          <button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-5 py-2 text-xs font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {starting ? "Starting…" : "Start"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            disabled={!canContinue}
            className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-5 py-2 text-xs font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue →
          </button>
        )}
      </div>
    </footer>
  );
}

/* ────────────────────────────── screens ────────────────────────────── */

function ScreenLookFeel() {
  const [theme, setTheme] = useTheme();
  const [fontSize, setFontSize] = useFontSize();
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Look &amp; feel</h2>
      <p className="mb-6 text-sm text-[color:var(--muted)]">
        These choices apply immediately so the rest of setup is comfortable to read. You can change
        them later from the Config page.
      </p>
      <Field
        label="Theme"
        description="Visual style. System follows your OS dark / light preference and updates live."
      >
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
          aria-label="Theme"
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm transition-colors outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]"
        >
          <option value="cyberpunk">Cyberpunk (dark)</option>
          <option value="modern">Modern (light)</option>
          <option value="system">System</option>
        </select>
      </Field>
      <Field label="Font size" description="Scales chat content and most UI chrome.">
        <select
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value as FontSize)}
          aria-label="Font size"
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm transition-colors outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]"
        >
          {(Object.keys(FONT_SIZE_LABELS) as FontSize[]).map((k) => (
            <option key={k} value={k}>
              {FONT_SIZE_LABELS[k]}
            </option>
          ))}
        </select>
      </Field>
    </section>
  );
}

function ScreenSecurity({
  passphrase,
  passphraseConfirm,
  securityMode,
  onPassphrase,
  onPassphraseConfirm,
  onSecurityMode,
}: {
  passphrase: string;
  passphraseConfirm: string;
  securityMode: SecurityMode;
  onPassphrase: (v: string) => void;
  onPassphraseConfirm: (v: string) => void;
  onSecurityMode: (v: SecurityMode) => void;
}) {
  const mismatch = passphraseConfirm.length > 0 && passphrase !== passphraseConfirm;
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Security</h2>
      <p className="mb-6 text-sm leading-relaxed text-[color:var(--muted)]">
        Eugene Plexus protects sensitive config (like provider API keys) with an encryption key
        derived from a passphrase you set here. You&rsquo;ll use the same passphrase to sign in from
        a fresh browser tab. Pick something you can remember — Eugene can&rsquo;t reset it.
      </p>
      <Field
        label="Passphrase"
        description="Used to derive the encryption key. Anything non-empty works; a longer phrase is stronger."
      >
        <SecretInput
          value={passphrase}
          onChange={onPassphrase}
          placeholder="A line of poetry, a sentence, a long phrase…"
        />
      </Field>
      <Field label="Confirm passphrase" description="Same again — guard against typos.">
        <SecretInput
          value={passphraseConfirm}
          onChange={onPassphraseConfirm}
          placeholder="(repeat the passphrase)"
        />
      </Field>
      {mismatch && (
        <p className="text-status-error -mt-2 mb-4 text-xs">Passphrases don&rsquo;t match yet.</p>
      )}
      <hr className="my-6 border-[color:var(--border)]" />
      <h3 className="font-ui mb-3 text-sm font-semibold">Auto-unlock</h3>
      <p className="mb-4 text-xs leading-relaxed text-[color:var(--muted)]">
        How Eugene should handle its encryption key between restarts. You can change this later from
        the Config page.
      </p>
      <Radio
        checked={securityMode === "os_keyring"}
        onChange={() => onSecurityMode("os_keyring")}
        label="OS keyring auto-unlock"
        description={
          "Best for: home / personal-use installs, AI hobbyists, anyone " +
          "who wants Eugene to auto-recover after a power outage. " +
          "Eugene's encryption key is stored in your OS's password " +
          "manager (Windows Credential Manager / macOS Keychain / Linux " +
          "Secret Service) and unlocked automatically when you log in. " +
          "Anyone with access to your user account can also start Eugene."
        }
      />
      <Radio
        checked={securityMode === "prompt_on_startup"}
        onChange={() => onSecurityMode("prompt_on_startup")}
        label="Prompt on startup"
        description={
          "Best for: shared environments, sensitive conversations, " +
          "security-conscious operators. Eugene's encryption key is " +
          "never written to disk. You'll type the passphrase by hand " +
          "every time the agent starts. A power outage means Eugene " +
          "stays offline until you re-enter the passphrase. Stronger " +
          "security; less convenience."
        }
      />
    </section>
  );
}

function ScreenWelcome() {
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Welcome</h2>
      <p className="mb-4 text-sm leading-relaxed">
        Eugene Plexus is a control plane for local inference. It doesn&rsquo;t run models itself —
        it supervises the engines that do, and puts one endpoint in front of them. The pieces:
      </p>
      <ul className="mb-4 ml-6 list-disc text-sm leading-relaxed text-[color:var(--muted)]">
        <li>
          <span className="text-[color:var(--foreground)]">Supervisor</span> — starts and watches
          engine processes, holds the topology, serves this UI.
        </li>
        <li>
          <span className="text-[color:var(--foreground)]">Gateway</span> — one OpenAI-compatible
          endpoint. It works out which backend serves which model from the topology, so there is no
          routing table to maintain by hand.
        </li>
        <li>
          <span className="text-[color:var(--foreground)]">Drivers</span> — one per backend. A
          driver knows how to talk to its own engine and nothing else. Setup configures one; add
          more from Config whenever.
        </li>
      </ul>
      <p className="text-sm leading-relaxed text-[color:var(--muted)]">
        Every step has a sensible default and nothing here is permanent — the Config page edits all
        of it later.
      </p>
    </section>
  );
}

function ScreenGateway({
  mode,
  host,
  port,
  onChange,
}: {
  mode: DeploymentMode;
  host: string;
  port: number;
  onChange: (host: string, port: number) => void;
}) {
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Gateway</h2>
      <p className="mb-6 text-sm leading-relaxed text-[color:var(--muted)]">
        The gateway is the address you point a client at — anything that speaks the OpenAI API works
        unmodified. It resolves a model name to whichever driver serves it and falls back to another
        when one dies. Nothing to configure here beyond where it listens; defaults for temperature
        and token limits are on the Config page.
      </p>
      {mode === "networked" && <HostPortRow host={host} port={port} onChange={onChange} />}
    </section>
  );
}

/**
 * Where the operator's models already live.
 *
 * This replaced a Driver screen. A driver fronts exactly one backend, and
 * since M6 the agent declares one per runtime automatically - so at first-run
 * time there is no driver to configure and no way to make one, which is
 * exactly what the old screen kept asking about.
 *
 * What genuinely cannot be guessed is where the operator keeps their models.
 * Nothing here moves, renames or copies a file: the library scans these
 * directories in place. Delete us and the models are still there, correctly
 * named, where they were put.
 */
function ScreenModels({
  roots,
  onChange,
}: {
  roots: string[];
  onChange: (roots: string[]) => void;
}) {
  const rows = roots.length > 0 ? roots : [""];

  function setAt(index: number, value: string) {
    const next = [...rows];
    next[index] = value;
    onChange(next);
  }
  function addRow() {
    onChange([...rows, ""]);
  }
  function removeAt(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Your models</h2>
      <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
        Point the library at directories you already keep models in. They are scanned where they are
        &mdash; nothing is moved, renamed or copied, and downloads land in these same directories as
        plainly-named files.
      </p>
      {rows.map((root, i) => (
        <div key={i} className="mb-2 flex gap-2">
          <input
            type="text"
            value={root}
            onChange={(e) => setAt(i, e.target.value)}
            placeholder="D:\models  or  /home/you/models"
            aria-label={`Model directory ${i + 1}`}
            className="font-ui flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
          />
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={`Remove model directory ${i + 1}`}
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="font-ui mb-4 rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
      >
        + Add another directory
      </button>
      <p className="text-xs leading-relaxed text-[color:var(--muted)]">
        You can skip this. Directories can be added later from Config, and Discover downloads into
        one of them. GGUF and Hugging Face safetensors are both recognised.
      </p>
    </section>
  );
}

function ScreenDeployment({
  value,
  onChange,
}: {
  value: DeploymentMode;
  onChange: (v: DeploymentMode) => void;
}) {
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Deployment</h2>
      <p className="mb-6 text-sm text-[color:var(--muted)]">
        Where do the parts of Eugene live? This determines whether the next screens ask for host
        addresses.
      </p>
      <Radio
        checked={value === "local"}
        onChange={() => onChange("local")}
        label="All on this machine (recommended)"
        description="Every component runs as a local process. The agent handles spawning and supervision; you won't need to think about ports."
      />
      <Radio
        checked={value === "networked"}
        onChange={() => onChange("networked")}
        label="Across a network"
        description="Some or all components run on other machines. You'll be asked for host:port for each one."
      />
    </section>
  );
}

function ScreenDone({
  draft,
  knownComponents,
  topologyKnown,
  starting,
  startMessage,
  startError,
}: {
  draft: WizardDraft;
  knownComponents: Component[];
  topologyKnown: boolean;
  starting: boolean;
  startMessage: string | null;
  startError: string | null;
}) {
  const summary: { label: string; value: string }[] = [
    {
      label: "Gateway",
      value:
        draft.deployment === "networked" ? `${draft.gatewayHost}:${draft.gatewayPort}` : "local",
    },
    {
      label: "Model directories",
      value:
        draft.modelRoots.filter((r) => r.trim()).join(", ") ||
        "none yet — add them from Config, or use Discover",
    },
    {
      label: "Security",
      value:
        draft.securityMode === "os_keyring"
          ? "master key in the OS keyring (auto-unlock)"
          : "passphrase prompt on startup",
    },
  ];

  // The agent declares these itself on a first boot. If one is missing, its
  // package is missing from the agent's environment - a real error, not a
  // step the operator forgot.
  // Only when the list is an answer. Unauthenticated, it is not one, and the
  // real check happens at Start with a token - see requiredKindsMissing.
  const missingKinds = topologyKnown ? requiredKindsMissing(knownComponents) : [];

  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Ready</h2>
      <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
        Start writes all of this at once. Nothing has been saved yet.
      </p>
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-3 text-sm">
        {summary.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-[color:var(--muted)]">{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <MissingTopologyHints missingKinds={missingKinds} />
      <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
        Afterwards: the Runtimes page is where you start an engine and confirm it reached{" "}
        <span className="font-mono">ready</span>, and the playground picks up any model the gateway
        can route to.
      </p>
      {starting && startMessage && (
        <p className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs text-[color:var(--muted)]">
          {startMessage}
        </p>
      )}
      {startError && (
        <p className="status-error rounded-[var(--radius)] border px-3 py-2 text-xs">
          {startError}
        </p>
      )}
    </section>
  );
}

/**
 * Every install has one control root, one gateway and one library, and the
 * agent declares them itself on its first boot. So a missing one is not a
 * step the operator skipped - it means that component's package is missing
 * from the agent's environment, and no amount of clicking here will fix it.
 *
 * This used to warn that no inference-driver existed and let Start proceed
 * anyway, which is how a first run could report success against an install
 * with nothing in it. Drivers are companions of runtimes now; there is
 * nothing to warn about before a model is launched.
 */
function MissingTopologyHints({ missingKinds }: { missingKinds: readonly string[] }) {
  if (missingKinds.length === 0) return null;
  return (
    <div className="status-warn mb-4 rounded-[var(--radius)] border px-3 py-2 text-xs">
      <p className="mb-1 font-medium">Missing from this node: {missingKinds.join(", ")}</p>
      <p>
        The agent declares these on a first boot, so this means their packages are not installed in
        the agent&rsquo;s environment. Install them there and restart the agent &mdash;{" "}
        <span className="font-mono">bootstrap.ps1</span> does this for every component.
      </p>
    </div>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <label className="font-ui block text-sm font-medium">{label}</label>
      {description && (
        <p className="mt-1 mb-2 text-xs leading-relaxed text-[color:var(--muted)]">{description}</p>
      )}
      {children}
    </div>
  );
}

function HostPortRow({
  host,
  port,
  onChange,
}: {
  host: string;
  port: number;
  onChange: (host: string, port: number) => void;
}) {
  return (
    <div className="mb-5 grid grid-cols-[2fr_1fr] gap-3">
      <Field label="Host">
        <input
          type="text"
          value={host}
          onChange={(e) => onChange(e.target.value, port)}
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
      </Field>
      <Field label="Port">
        <input
          type="number"
          value={port}
          onChange={(e) => onChange(host, parseInt(e.target.value, 10) || 0)}
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
      </Field>
    </div>
  );
}

function Radio({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
}) {
  return (
    <label
      className={`mb-3 flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border px-4 py-3 transition-colors ${
        checked
          ? "border-[color:var(--accent-left)] bg-[color:var(--panel-soft)]"
          : "border-[color:var(--border)] hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
      }`}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="mt-1 accent-[color:var(--accent-left)]"
      />
      <span>
        <span className="font-ui block text-sm font-medium">{label}</span>
        <span className="mt-1 block text-xs leading-relaxed text-[color:var(--muted)]">
          {description}
        </span>
      </span>
    </label>
  );
}

function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [reveal, setReveal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-stretch gap-2">
      <input
        ref={inputRef}
        type={reveal ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="font-ui flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
      />
      <button
        type="button"
        onClick={() => setReveal((r) => !r)}
        className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
      >
        {reveal ? "Hide" : "Show"}
      </button>
    </div>
  );
}
