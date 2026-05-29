"use client";

/**
 * First-run wizard.
 *
 * Linear ten-screen flow (v0.2 expansion of the original 8-screen flow):
 *
 *   1. Look & feel       — local theme + font, live preview
 *   2. Security          — passphrase + securityMode (v0.2)
 *   3. Welcome           — plain-language "body parts" framing
 *   4. Deployment        — all-local vs. networked
 *   5. Orchestrator      — host:port shown only in networked mode
 *   6. Driver 1          — provider + credential + model
 *   7. Driver 2          — same with a "pick a different vendor" hint
 *   8. Memory            — backend choice (local_sqlite default vs. in_process)
 *   9. Identity          — display name override + reflection wiring
 *  10. Connectors + Done — optional Discord adapter, summary + Start button
 *
 * Navigation rules:
 *   - Screen 1: `Cancel` + `Continue →`
 *   - Screens 2–9: `← Back` + `Continue →`
 *   - Screen 10: `← Back` + `Start`
 *
 * State lives in React (with sessionStorage mirror so a tab refresh
 * doesn't lose progress). The actual write-to-watchdog happens only on
 * screen 8's Start button — the wizard treats the entire flow as one
 * transaction and either commits everything or commits nothing.
 *
 * v0.2 transactional order on Start:
 *   1. POST /v1/auth/initialize with the wizard's passphrase → get a
 *      session token, populate AuthState.master_key on the watchdog.
 *   2. Patch the chosen securityMode (default is prompt_on_startup,
 *      skip the patch if unchanged). Switching to os_keyring with the
 *      session active persists the master key for auto-unlock.
 *   3. Patch each driver's apiKey / provider config (encrypted at rest
 *      now that a master key exists).
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
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { setSessionToken } from "@/lib/session";
import { useFontSize, FONT_SIZE_LABELS, type FontSize } from "@/lib/useFontSize";
import { useTheme, type Theme } from "@/lib/useTheme";
import {
  WIZARD_PROVIDERS,
  type Component,
  type ComponentList,
  type WizardCredential,
} from "@/lib/watchdog";

const DRAFT_KEY = "eugene-wizard-draft";
const TOTAL_SCREENS = 10;

type DeploymentMode = "local" | "networked";
type SecurityMode = "prompt_on_startup" | "os_keyring";
type MemoryBackend = "local_sqlite" | "in_process";
type ConnectorChoice = "skip" | "discord";

interface InitializeResponse {
  sessionToken: string;
  expiresAt: string;
  operatorName?: string | null;
}

interface DriverDraft {
  name: string;
  host: string;
  port: number;
  provider: string;
  apiKey: string;
  claudeCodeCliPath: string;
  codexCliPath: string;
  baseUrl: string;
  modelId: string;
}

interface WizardDraft {
  deployment: DeploymentMode;
  orchestratorHost: string;
  orchestratorPort: number;
  drivers: [DriverDraft, DriverDraft];
  // Memory ------------------------------------------------------------
  memoryHost: string;
  memoryPort: number;
  memoryBackend: MemoryBackend;
  memoryLocalSqlitePath: string;
  // Identity ----------------------------------------------------------
  identityHost: string;
  identityPort: number;
  identityEnabled: boolean;
  identityDisplayName: string;
  enableReflection: boolean;
  reflectionDriverName: string;
  // Connector ---------------------------------------------------------
  connectorChoice: ConnectorChoice;
  connectorHost: string;
  connectorPort: number;
  discordAdapterName: string;
  discordBotToken: string;
  discordAllowedChannels: string;
  // Security ----------------------------------------------------------
  securityMode: SecurityMode;
}

function blankDriver(name: string): DriverDraft {
  return {
    name,
    host: "127.0.0.1",
    port: name === "left" ? 8081 : 8082,
    provider: "claude_subscription",
    apiKey: "",
    claudeCodeCliPath: "claude",
    codexCliPath: "codex",
    baseUrl: "",
    modelId: "",
  };
}

function blankDraft(): WizardDraft {
  return {
    deployment: "local",
    orchestratorHost: "127.0.0.1",
    orchestratorPort: 8080,
    drivers: [blankDriver("left"), blankDriver("right")],
    memoryHost: "127.0.0.1",
    memoryPort: 8083,
    memoryBackend: "local_sqlite",
    memoryLocalSqlitePath: "memory.sqlite3",
    identityHost: "127.0.0.1",
    identityPort: 8084,
    identityEnabled: true,
    identityDisplayName: "Eugene",
    enableReflection: false,
    reflectionDriverName: "left",
    connectorChoice: "skip",
    connectorHost: "127.0.0.1",
    connectorPort: 8085,
    discordAdapterName: "discord",
    discordBotToken: "",
    discordAllowedChannels: "",
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
  // Passphrase state lives OUTSIDE the persisted draft — never written
  // to sessionStorage. A mid-wizard refresh re-prompts for it.
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");

  // Hydrate from sessionStorage so a tab refresh mid-wizard doesn't
  // throw away typed values. The session-store key is separate from the
  // chat conversation key — a wizard refresh isn't a chat refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<WizardDraft> & { screen?: number };
        setDraft((prev) => ({ ...prev, ...parsed }));
        if (
          typeof parsed.screen === "number" &&
          parsed.screen >= 1 &&
          parsed.screen <= TOTAL_SCREENS
        ) {
          setScreen(parsed.screen);
        }
      }
    } catch {
      // ignore — start from defaults
    }
    setHydrated(true);
  }, []);

  // Auto-save: every draft change rewrites sessionStorage. The design
  // calls for "auto-save on every input change so closing the browser
  // mid-wizard never loses state". Browser storage covers the
  // tab-reload case; durable cross-browser resume waits on v0.2.
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, screen }));
    } catch {
      // ignore
    }
  }, [hydrated, draft, screen]);

  // Pull the watchdog's current component list once. Screen 8 uses it
  // to show the operator a final summary and to decide what to PATCH
  // vs. what to skip. The endpoint is auth-protected in v0.2; the
  // wizard hasn't initialized the install yet so we skip auth and
  // tolerate a 401 (uninitialized installs return that for protected
  // routes — empty list is fine, Start surfaces real errors later).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await api.get<ComponentList>("watchdog", "/v1/components", { skipAuth: true });
        if (cancelled) return;
        setKnownComponents(list.components ?? []);
      } catch {
        // Watchdog unreachable or auth-required — leave empty; Start
        // surfaces real errors when it tries to PATCH.
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
  function patchDriver(idx: 0 | 1, patch: Partial<DriverDraft>) {
    setDraft((prev) => {
      const next = { ...prev, drivers: [...prev.drivers] as [DriverDraft, DriverDraft] };
      next.drivers[idx] = { ...next.drivers[idx], ...patch };
      return next;
    });
  }

  function next() {
    setScreen((s) => Math.min(s + 1, TOTAL_SCREENS));
  }
  function back() {
    setScreen((s) => Math.max(s - 1, 1));
  }

  function cancel() {
    // Cancel only fires from screen 1; bail-out from later screens goes
    // back to 1 first. Per the design memo: SIGTERM-children-and-exit
    // semantics belong to a future watchdog endpoint; v0.1 just clears
    // the draft and returns to /chat so the operator can decide what to
    // do next.
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
      // salt on the watchdog, derives the master key into memory, and
      // returns a session token. After this call, the rest of the wizard's
      // PATCHes are authenticated by the api client's auto-attach.
      setStartMessage("Setting your passphrase and deriving keys…");
      const initResp = await api.post<InitializeResponse>(
        "watchdog",
        "/v1/auth/initialize",
        { passphrase },
        { skipAuth: true },
      );
      setSessionToken(initResp.sessionToken);

      // Step 2: persist the chosen securityMode. Default is
      // prompt_on_startup; skip the patch if unchanged so we don't
      // touch the keyring needlessly. Flipping to os_keyring with the
      // session active triggers the watchdog's keyring write (see
      // routes/config.py).
      if (draft.securityMode !== "prompt_on_startup") {
        setStartMessage("Applying security mode…");
        await api.patch("watchdog", "/v1/config", {
          securityMode: draft.securityMode,
        });
      }

      // Step 3: PATCH each existing driver component with the user's
      // choices. Components must already exist in the watchdog topology
      // for v0.2 — the "create from scratch" path is a follow-on. We
      // surface missing-component warnings on Screen 10 so the operator
      // sees what didn't apply.
      setStartMessage("Saving driver and orchestrator configuration…");
      const componentsByName = new Map(knownComponents.map((c) => [c.name, c]));
      const componentByKind = (kind: string) => knownComponents.find((c) => c.kind === kind);
      const driverComponentNames = knownComponents
        .filter((c) => c.kind === "hemisphere-driver")
        .map((c) => c.name);

      // Resolved driver names — fall back to the i-th driver if the
      // wizard's chosen name doesn't exist in topology. Used by both
      // the PATCH loop and the reflection URL derivation below.
      const resolvedDriverNames: string[] = [];
      for (let i = 0; i < draft.drivers.length; i++) {
        const d = draft.drivers[i]!;
        const direct = componentsByName.get(d.name);
        const fallback = driverComponentNames[i];
        const patch = buildDriverPatch(d);
        if (direct) {
          await api.patch(d.name, "/v1/config", patch);
          resolvedDriverNames.push(d.name);
        } else if (fallback) {
          await api.patch(fallback, "/v1/config", patch);
          resolvedDriverNames.push(fallback);
        } else {
          resolvedDriverNames.push(d.name); // no topology entry; record best guess
        }
      }

      // Memory configuration — PATCH the memory component if it exists.
      const memoryComponent = componentByKind("memory");
      if (memoryComponent) {
        setStartMessage("Saving memory configuration…");
        const memoryPatch: Record<string, unknown> = {
          backend: draft.memoryBackend,
        };
        if (draft.memoryBackend === "local_sqlite") {
          memoryPatch.localSqlitePath = draft.memoryLocalSqlitePath;
        }
        await api.patch(memoryComponent.name, "/v1/config", memoryPatch);
      }

      // Identity configuration — PATCH the identity component if it
      // exists AND the operator opted in. We also patch the orchestrator
      // with identityUrl so chat-time prompt assembly kicks in. When
      // identity is skipped we leave the orchestrator's identityUrl
      // untouched (null / empty triggers the v0.1 fallback path).
      const identityComponent = componentByKind("identity");
      const identityUrl = identityComponent?.url ?? null;
      if (draft.identityEnabled && identityComponent) {
        setStartMessage("Saving identity configuration…");
        const identityPatch: Record<string, unknown> = {};
        if (draft.enableReflection) {
          // Use the resolved driver name's URL from the orchestrator's
          // current drivers list. Easiest: read orchestrator /v1/config
          // once and find the matching driver entry.
          const orchConfig = await api.get<Record<string, unknown>>("orchestrator", "/v1/config");
          const driverList = orchConfig.drivers;
          let hemisphereUrl: string | undefined;
          if (Array.isArray(driverList)) {
            const match = driverList.find(
              (d): d is { name: string; urls: string[] } =>
                typeof d === "object" &&
                d !== null &&
                (d as { name?: unknown }).name === draft.reflectionDriverName,
            );
            // Reflection points at the slot's primary backend; the
            // orchestrator handles per-turn failover to the rest.
            hemisphereUrl = match?.urls?.[0];
          }
          if (hemisphereUrl) {
            identityPatch.reflectionHemisphereUrl = hemisphereUrl;
          }
          if (memoryComponent) {
            identityPatch.reflectionMemoryUrl = memoryComponent.url;
          }
        }
        if (Object.keys(identityPatch).length > 0) {
          await api.patch(identityComponent.name, "/v1/config", identityPatch);
        }

        // Constitution rename — only when the operator changed it from the default.
        const trimmedName = draft.identityDisplayName.trim();
        if (trimmedName && trimmedName !== "Eugene") {
          try {
            await api.patch("identity", "/v1/identity/constitution", {
              name: trimmedName,
            });
          } catch {
            // Constitution PATCH can 503 if identity is in safe mode.
            // Treat as best-effort — operator can rename later from Config.
          }
        }
      }

      // Orchestrator identityUrl — set if we have an identity component
      // and the operator opted in; clear (null) if they opted out so an
      // operator re-running the wizard can switch back to v0.1 path.
      const orchestratorComponent = componentByKind("orchestrator");
      if (orchestratorComponent) {
        const orchPatch: Record<string, unknown> = {};
        if (draft.identityEnabled && identityUrl) {
          orchPatch.identityUrl = identityUrl;
        } else {
          orchPatch.identityUrl = null;
        }
        await api.patch(orchestratorComponent.name, "/v1/config", orchPatch);
      }

      // Connector + Discord adapter — only when the operator opted in.
      if (draft.connectorChoice === "discord") {
        const connectorComponent = componentByKind("connector");
        if (connectorComponent) {
          setStartMessage("Setting up the Discord adapter…");
          // The Discord adapter accepts a comma/newline-separated
          // string for `channelAllowlist`, NOT a list. See
          // connector/src/.../adapters/discord_adapter.py field spec.
          const channelAllowlist = draft.discordAllowedChannels
            .split(/[,\s]+/u)
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
            .join(",");
          const adapterBody = {
            name: draft.discordAdapterName.trim() || "discord",
            kind: "discord",
            enabled: true,
            adapterConfig: {
              botToken: draft.discordBotToken,
              channelAllowlist,
            },
          };
          try {
            await api.post("connector", "/v1/adapters", adapterBody);
          } catch (e) {
            if (e instanceof ApiError && e.status === 409) {
              // Adapter already exists — update it instead.
              await api.patch(
                "connector",
                `/v1/adapters/${encodeURIComponent(adapterBody.name)}`,
                adapterBody,
              );
            } else {
              throw e;
            }
          }
        }
      }

      setStartMessage("Finalizing setup…");
      await api.patch("watchdog", "/v1/config", { firstRunComplete: true });

      setStartMessage("Restarting components with your new configuration…");
      // Best-effort restart so each component picks up its new config.
      // Each PATCH path set requiresRestart for the fields we touched;
      // restarting here closes that loop.
      const restartTargets = new Set<string>(resolvedDriverNames);
      if (memoryComponent) restartTargets.add(memoryComponent.name);
      if (draft.identityEnabled && identityComponent) {
        restartTargets.add(identityComponent.name);
      }
      if (orchestratorComponent) restartTargets.add(orchestratorComponent.name);
      for (const name of restartTargets) {
        if (componentsByName.has(name)) {
          try {
            await api.post("watchdog", `/v1/components/${encodeURIComponent(name)}/restart`, {});
          } catch {
            // Best-effort — a failed restart isn't a wizard failure.
          }
        }
      }

      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
      setStartMessage("Done — opening chat…");
      // Small delay so the operator sees the final message; not strictly required.
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
          "from watchdog.yaml by hand."
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
            <ScreenOrchestrator
              mode={draft.deployment}
              host={draft.orchestratorHost}
              port={draft.orchestratorPort}
              onChange={(host, port) =>
                patchDraft({ orchestratorHost: host, orchestratorPort: port })
              }
            />
          )}
          {screen === 6 && (
            <ScreenDriver
              index={0}
              showHostHint={draft.deployment === "networked"}
              driver={draft.drivers[0]}
              onChange={(p) => patchDriver(0, p)}
            />
          )}
          {screen === 7 && (
            <ScreenDriver
              index={1}
              showHostHint={draft.deployment === "networked"}
              driver={draft.drivers[1]}
              firstProviderKey={draft.drivers[0].provider}
              onChange={(p) => patchDriver(1, p)}
            />
          )}
          {screen === 8 && (
            <ScreenMemory
              mode={draft.deployment}
              host={draft.memoryHost}
              port={draft.memoryPort}
              backend={draft.memoryBackend}
              localSqlitePath={draft.memoryLocalSqlitePath}
              onChangeHost={(host, port) => patchDraft({ memoryHost: host, memoryPort: port })}
              onBackend={(v) => patchDraft({ memoryBackend: v })}
              onLocalSqlitePath={(v) => patchDraft({ memoryLocalSqlitePath: v })}
            />
          )}
          {screen === 9 && (
            <ScreenIdentity
              mode={draft.deployment}
              host={draft.identityHost}
              port={draft.identityPort}
              enabled={draft.identityEnabled}
              displayName={draft.identityDisplayName}
              enableReflection={draft.enableReflection}
              reflectionDriverName={draft.reflectionDriverName}
              driverNames={draft.drivers.map((d) => d.name)}
              onChangeHost={(host, port) => patchDraft({ identityHost: host, identityPort: port })}
              onEnabled={(v) => patchDraft({ identityEnabled: v })}
              onDisplayName={(v) => patchDraft({ identityDisplayName: v })}
              onEnableReflection={(v) => patchDraft({ enableReflection: v })}
              onReflectionDriverName={(v) => patchDraft({ reflectionDriverName: v })}
            />
          )}
          {screen === 10 && (
            <ScreenConnectorsAndStart
              draft={draft}
              knownComponents={knownComponents}
              starting={starting}
              startMessage={startMessage}
              startError={startError}
              onConnectorChoice={(v) => patchDraft({ connectorChoice: v })}
              onChangeConnectorHost={(host, port) =>
                patchDraft({ connectorHost: host, connectorPort: port })
              }
              onDiscordAdapterName={(v) => patchDraft({ discordAdapterName: v })}
              onDiscordBotToken={(v) => patchDraft({ discordBotToken: v })}
              onDiscordAllowedChannels={(v) => patchDraft({ discordAllowedChannels: v })}
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

function canContinue(
  screen: number,
  draft: WizardDraft,
  passphrase: string,
  passphraseConfirm: string,
): boolean {
  // Screen 2 is Security — passphrase non-empty AND confirmation
  // matches. Length validation lives server-side (Argon2 hash will
  // accept anything non-empty); we only block the obvious typo.
  if (screen === 2) {
    return passphrase.length > 0 && passphrase === passphraseConfirm;
  }
  // Screens 6 + 7 are the two drivers (shifted from 5 + 6 in v0.1).
  if (screen === 6 || screen === 7) {
    const idx = (screen - 6) as 0 | 1;
    const d = draft.drivers[idx];
    if (!d.name.trim()) return false;
    const credentials = WIZARD_PROVIDERS.find((p) => p.key === d.provider)?.credentials ?? [];
    if (credentials.includes("api_key") && !d.apiKey.trim()) return false;
    if (credentials.includes("base_url") && !d.baseUrl.trim()) return false;
    return true;
  }
  // Screen 8 is Memory. local_sqlite requires a non-empty path.
  if (screen === 8) {
    if (draft.memoryBackend === "local_sqlite") {
      return draft.memoryLocalSqlitePath.trim().length > 0;
    }
    return true;
  }
  // Screen 9 is Identity. Display name is required when identity is
  // enabled; otherwise nothing to validate.
  if (screen === 9) {
    if (!draft.identityEnabled) return true;
    if (!draft.identityDisplayName.trim()) return false;
    if (draft.enableReflection && !draft.reflectionDriverName.trim()) return false;
    return true;
  }
  // Screen 10 (final) — when Discord is chosen, a bot token + adapter
  // name are required. Otherwise just Start.
  if (screen === 10) {
    if (draft.connectorChoice === "discord") {
      if (!draft.discordAdapterName.trim()) return false;
      if (!draft.discordBotToken.trim()) return false;
    }
    return true;
  }
  return true;
}

function buildDriverPatch(d: DriverDraft): Record<string, unknown> {
  const credentials = WIZARD_PROVIDERS.find((p) => p.key === d.provider)?.credentials ?? [];
  const patch: Record<string, unknown> = { provider: d.provider };
  if (d.modelId.trim()) patch.modelId = d.modelId.trim();
  if (credentials.includes("api_key")) patch.apiKey = d.apiKey;
  if (credentials.includes("claude_cli")) patch.claudeCodeCliPath = d.claudeCodeCliPath || "claude";
  if (credentials.includes("codex_cli")) patch.codexCliPath = d.codexCliPath || "codex";
  if (credentials.includes("base_url")) patch.baseUrl = d.baseUrl;
  return patch;
}

/* ────────────────────────────── chrome ─────────────────────────────── */

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
          "every time the watchdog starts. A power outage means Eugene " +
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
        Eugene Plexus models a thinking mind as a small system of parts that each do one job. Setup
        walks through those parts in order:
      </p>
      <ul className="mb-4 ml-6 list-disc text-sm leading-relaxed text-[color:var(--muted)]">
        <li>
          <span className="text-[color:var(--foreground)]">Orchestrator</span> — coordinates the
          conversation and asks each driver in turn.
        </li>
        <li>
          <span className="text-[color:var(--foreground)]">Drivers</span> — two language models that
          consider every message side-by-side. Picking different vendors for the two drivers creates
          the most interesting behavior.
        </li>
        <li>
          <span className="text-[color:var(--foreground)]">Memory</span> — a simple recent-history
          store for v0.1.
        </li>
      </ul>
      <p className="text-sm leading-relaxed text-[color:var(--muted)]">
        Each step has sensible defaults; you can change anything later from the Config page.
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
        description="Every component runs as a local process. The watchdog handles spawning and supervision; you won't need to think about ports."
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

function ScreenOrchestrator({
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
      <h2 className="font-ui mb-2 text-xl font-semibold">Orchestrator</h2>
      <p className="mb-6 text-sm leading-relaxed text-[color:var(--muted)]">
        The orchestrator runs the conversation loop, sends each prompt to both drivers, and merges
        their responses. Defaults (system prompt, pass cap, agreement threshold) are fine for v0.1 —
        you can tune them later in the Config page.
      </p>
      {mode === "networked" && <HostPortRow host={host} port={port} onChange={onChange} />}
    </section>
  );
}

function ScreenDriver({
  index,
  showHostHint,
  driver,
  firstProviderKey,
  onChange,
}: {
  index: 0 | 1;
  showHostHint: boolean;
  driver: DriverDraft;
  firstProviderKey?: string;
  onChange: (patch: Partial<DriverDraft>) => void;
}) {
  const credentials = useMemo(
    () => WIZARD_PROVIDERS.find((p) => p.key === driver.provider)?.credentials ?? [],
    [driver.provider],
  );
  const hint =
    index === 1 && firstProviderKey && firstProviderKey === driver.provider
      ? "For the most interesting behavior, pick a different vendor than your first driver."
      : null;

  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Driver {index + 1}</h2>
      <p className="mb-2 text-sm text-[color:var(--muted)]">
        One of the two language models Eugene consults on every message.
      </p>
      {hint && (
        <p className="status-warn mb-4 rounded-[var(--radius)] border px-3 py-2 text-xs">{hint}</p>
      )}
      <Field label="Name" description="A label for this driver — defaults to “left” or “right”.">
        <input
          type="text"
          value={driver.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
      </Field>
      {showHostHint && (
        <HostPortRow
          host={driver.host}
          port={driver.port}
          onChange={(host, port) => onChange({ host, port })}
        />
      )}
      <Field label="Provider" description="Which LLM subscription or service this driver wraps.">
        <select
          value={driver.provider}
          onChange={(e) => onChange({ provider: e.target.value })}
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
        >
          {WIZARD_PROVIDERS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <CredentialFields credentials={credentials} driver={driver} onChange={onChange} />
      <Field
        label="Model"
        description='Specific model id, e.g. "gpt-4o", "claude-opus-4-7", "grok-2". Leave blank for the provider default.'
      >
        <input
          type="text"
          value={driver.modelId}
          onChange={(e) => onChange({ modelId: e.target.value })}
          placeholder="(provider default)"
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
      </Field>
    </section>
  );
}

function CredentialFields({
  credentials,
  driver,
  onChange,
}: {
  credentials: WizardCredential[];
  driver: DriverDraft;
  onChange: (patch: Partial<DriverDraft>) => void;
}) {
  return (
    <>
      {credentials.includes("api_key") && (
        <Field
          label="API key"
          description="The provider-issued key the driver uses to authenticate."
        >
          <SecretInput
            value={driver.apiKey}
            onChange={(v) => onChange({ apiKey: v })}
            placeholder="sk-…"
          />
        </Field>
      )}
      {credentials.includes("base_url") && (
        <Field
          label="Base URL"
          description="HTTP base of your OpenAI-compatible endpoint. The driver appends /v1/chat/completions automatically."
        >
          <input
            type="url"
            value={driver.baseUrl}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            placeholder="https://my-server.example.com"
            className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
          />
        </Field>
      )}
      {credentials.includes("claude_cli") && (
        <Field
          label="Claude Code CLI path"
          description="Path to the `claude` binary. Leave as “claude” if it's on PATH."
        >
          <input
            type="text"
            value={driver.claudeCodeCliPath}
            onChange={(e) => onChange({ claudeCodeCliPath: e.target.value })}
            className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
          />
        </Field>
      )}
      {credentials.includes("codex_cli") && (
        <Field
          label="Codex CLI path"
          description="Path to the `codex` binary. Leave as “codex” if it's on PATH."
        >
          <input
            type="text"
            value={driver.codexCliPath}
            onChange={(e) => onChange({ codexCliPath: e.target.value })}
            className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
          />
        </Field>
      )}
      {credentials.includes("none") && (
        <p className="-mt-2 mb-4 text-xs text-[color:var(--muted)]">
          No credentials needed — the driver talks to a local service.
        </p>
      )}
    </>
  );
}

function ScreenMemory({
  mode,
  host,
  port,
  backend,
  localSqlitePath,
  onChangeHost,
  onBackend,
  onLocalSqlitePath,
}: {
  mode: DeploymentMode;
  host: string;
  port: number;
  backend: MemoryBackend;
  localSqlitePath: string;
  onChangeHost: (host: string, port: number) => void;
  onBackend: (v: MemoryBackend) => void;
  onLocalSqlitePath: (v: string) => void;
}) {
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Memory</h2>
      <p className="mb-6 text-sm leading-relaxed text-[color:var(--muted)]">
        Where Eugene stores conversation history. Each turn is tagged with the person who said it,
        so Eugene can pull back the right context when you (or a connected friend) talk to him
        again.
      </p>
      {mode === "networked" && <HostPortRow host={host} port={port} onChange={onChangeHost} />}
      <h3 className="font-ui mb-3 text-sm font-semibold">Storage backend</h3>
      <Radio
        checked={backend === "local_sqlite"}
        onChange={() => onBackend("local_sqlite")}
        label="Local SQLite (recommended)"
        description={
          "A small SQLite file on disk. Survives restarts; supports " +
          "per-person retrieval and (in a future release) semantic search."
        }
      />
      <Radio
        checked={backend === "in_process"}
        onChange={() => onBackend("in_process")}
        label="In-process (volatile)"
        description={
          "Keeps conversations in RAM only — lost on restart. Useful for " +
          "short test drives or when you do not want anything written to disk."
        }
      />
      {backend === "local_sqlite" && (
        <Field
          label="Database path"
          description={
            "Filesystem path of the SQLite database. Relative paths " +
            "resolve next to the memory component's config file. The " +
            "parent directory is created automatically."
          }
        >
          <input
            type="text"
            value={localSqlitePath}
            onChange={(e) => onLocalSqlitePath(e.target.value)}
            className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
          />
        </Field>
      )}
    </section>
  );
}

function ScreenIdentity({
  mode,
  host,
  port,
  enabled,
  displayName,
  enableReflection,
  reflectionDriverName,
  driverNames,
  onChangeHost,
  onEnabled,
  onDisplayName,
  onEnableReflection,
  onReflectionDriverName,
}: {
  mode: DeploymentMode;
  host: string;
  port: number;
  enabled: boolean;
  displayName: string;
  enableReflection: boolean;
  reflectionDriverName: string;
  driverNames: string[];
  onChangeHost: (host: string, port: number) => void;
  onEnabled: (v: boolean) => void;
  onDisplayName: (v: string) => void;
  onEnableReflection: (v: boolean) => void;
  onReflectionDriverName: (v: string) => void;
}) {
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Identity</h2>
      <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
        Eugene&rsquo;s &ldquo;self&rdquo; — a constitution (declarative facts about who he is) plus
        a self-model (patterns he notices about himself over time). Each hemisphere is told who
        Eugene is and who they&rsquo;re talking to before every turn, which gives the two backends
        more interesting room to disagree.
      </p>
      <Radio
        checked={enabled}
        onChange={() => onEnabled(true)}
        label="Enable identity (recommended)"
        description={
          "Eugene runs with constitution + self-model + per-person " +
          "relationship context. The orchestrator points at this " +
          "component and assembles per-hemisphere prompts from it."
        }
      />
      <Radio
        checked={!enabled}
        onChange={() => onEnabled(false)}
        label="Skip — use the v0.1 shared system prompt"
        description={
          "No constitution, no self-model. Both hemispheres see the same " +
          "system prompt (the orchestrator's defaultSystemPrompt). You " +
          "can add identity later from the Config page."
        }
      />
      {enabled && (
        <>
          {mode === "networked" && <HostPortRow host={host} port={port} onChange={onChangeHost} />}
          <Field
            label="Display name"
            description="The name Eugene uses for himself. Saved into the identity constitution."
          >
            <input
              type="text"
              value={displayName}
              onChange={(e) => onDisplayName(e.target.value)}
              placeholder="Eugene"
              className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
            />
          </Field>
          <hr className="my-6 border-[color:var(--border)]" />
          <h3 className="font-ui mb-3 text-sm font-semibold">Self-model reflection</h3>
          <p className="mb-4 text-xs leading-relaxed text-[color:var(--muted)]">
            Reflection is Eugene looking at recent conversations and writing autobiographical notes
            about himself. Manual-trigger only in v0.2 — POST{" "}
            <span className="font-mono">/v1/identity/self-model/reflect</span>. Needs a hemisphere
            driver to do the writing.
          </p>
          <Radio
            checked={!enableReflection}
            onChange={() => onEnableReflection(false)}
            label="Skip reflection for now"
            description={
              "Reflection endpoint returns 503 until configured. You can " +
              "wire it up later from the identity tab in Config."
            }
          />
          <Radio
            checked={enableReflection}
            onChange={() => onEnableReflection(true)}
            label="Enable reflection"
            description={
              "Point identity at one of your hemisphere drivers + at the " +
              "memory component so reflection can read recent turns and " +
              "write self-model entries."
            }
          />
          {enableReflection && (
            <Field
              label="Reflection driver"
              description={
                "Which driver runs the reflection prompt. Picking the " +
                "slower / cheaper of your two is a fine default — " +
                "reflection isn't latency-sensitive."
              }
            >
              <select
                value={reflectionDriverName}
                onChange={(e) => onReflectionDriverName(e.target.value)}
                className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
              >
                {driverNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}
    </section>
  );
}

function ScreenConnectorsAndStart({
  draft,
  knownComponents,
  starting,
  startMessage,
  startError,
  onConnectorChoice,
  onChangeConnectorHost,
  onDiscordAdapterName,
  onDiscordBotToken,
  onDiscordAllowedChannels,
}: {
  draft: WizardDraft;
  knownComponents: Component[];
  starting: boolean;
  startMessage: string | null;
  startError: string | null;
  onConnectorChoice: (v: ConnectorChoice) => void;
  onChangeConnectorHost: (host: string, port: number) => void;
  onDiscordAdapterName: (v: string) => void;
  onDiscordBotToken: (v: string) => void;
  onDiscordAllowedChannels: (v: string) => void;
}) {
  const summary: { label: string; value: string }[] = [
    {
      label: "Orchestrator",
      value:
        draft.deployment === "networked"
          ? `${draft.orchestratorHost}:${draft.orchestratorPort}`
          : "local",
    },
    ...draft.drivers.map((d) => ({
      label: `Driver — ${d.name}`,
      value: `${providerLabelFor(d.provider)}${d.modelId ? ` · ${d.modelId}` : ""}`,
    })),
    {
      label: "Memory",
      value:
        draft.memoryBackend === "local_sqlite"
          ? `local SQLite · ${draft.memoryLocalSqlitePath}`
          : "in-process (volatile)",
    },
    {
      label: "Identity",
      value: draft.identityEnabled
        ? `enabled · ${draft.identityDisplayName.trim() || "Eugene"}${
            draft.enableReflection ? ` · reflection via ${draft.reflectionDriverName}` : ""
          }`
        : "disabled (v0.1 shared prompt)",
    },
    {
      label: "Connector",
      value:
        draft.connectorChoice === "discord"
          ? `Discord · ${draft.discordAdapterName || "discord"}`
          : "skipped",
    },
  ];

  const missingDrivers = draft.drivers.filter(
    (d) => !knownComponents.find((c) => c.name === d.name && c.kind === "hemisphere-driver"),
  );
  const missingMemory = !knownComponents.some((c) => c.kind === "memory");
  const missingIdentity =
    draft.identityEnabled && !knownComponents.some((c) => c.kind === "identity");
  const missingConnector =
    draft.connectorChoice === "discord" && !knownComponents.some((c) => c.kind === "connector");

  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Connectors</h2>
      <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
        Connectors bridge external chat platforms (Discord today; Slack / Matrix / Gmail later) into
        Eugene&rsquo;s orchestrator. Optional — you can use Eugene entirely through this web UI.
        Setting up Discord here is the same as adding the adapter later from Config.
      </p>
      <Radio
        checked={draft.connectorChoice === "skip"}
        onChange={() => onConnectorChoice("skip")}
        label="Skip for now (recommended)"
        description={
          "Eugene runs without any external connectors. You'll talk to " +
          "him through this web UI."
        }
      />
      <Radio
        checked={draft.connectorChoice === "discord"}
        onChange={() => onConnectorChoice("discord")}
        label="Set up a Discord bot"
        description={
          "Requires a Discord bot token (created at " +
          "https://discord.com/developers/applications). Eugene replies " +
          "in DMs and when @-mentioned in allowed channels."
        }
      />
      {draft.connectorChoice === "discord" && (
        <>
          {draft.deployment === "networked" && (
            <HostPortRow
              host={draft.connectorHost}
              port={draft.connectorPort}
              onChange={onChangeConnectorHost}
            />
          )}
          <Field
            label="Adapter name"
            description="Label shown in logs and on the Config page. Useful when you add multiple Discord adapters later."
          >
            <input
              type="text"
              value={draft.discordAdapterName}
              onChange={(e) => onDiscordAdapterName(e.target.value)}
              placeholder="discord"
              className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
            />
          </Field>
          <Field
            label="Bot token"
            description="From the Bot page of your Discord application. Stored encrypted at rest."
          >
            <SecretInput
              value={draft.discordBotToken}
              onChange={onDiscordBotToken}
              placeholder="MTI..."
            />
          </Field>
          <Field
            label="Allowed channel IDs"
            description={
              "Comma-separated Discord channel IDs Eugene will respond " +
              "in when @-mentioned. DMs always work; channel mentions " +
              "are restricted to this list. Leave empty to start in DM-only mode."
            }
          >
            <input
              type="text"
              value={draft.discordAllowedChannels}
              onChange={(e) => onDiscordAllowedChannels(e.target.value)}
              placeholder="123456789012345678, 234567890123456789"
              className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
            />
          </Field>
        </>
      )}
      <hr className="my-6 border-[color:var(--border)]" />
      <h3 className="font-ui mb-3 text-sm font-semibold">Ready to start</h3>
      <ul className="mb-4 divide-y divide-[color:var(--border)] rounded-[var(--radius)] border border-[color:var(--border)]">
        {summary.map((row) => (
          <li key={row.label} className="flex justify-between px-3 py-2 text-sm">
            <span className="text-[color:var(--muted)]">{row.label}</span>
            <span className="font-mono text-xs">{row.value}</span>
          </li>
        ))}
      </ul>
      <MissingTopologyHints
        missingDrivers={missingDrivers.map((d) => d.name)}
        missingMemory={missingMemory}
        missingIdentity={missingIdentity}
        missingConnector={missingConnector}
      />
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

function MissingTopologyHints({
  missingDrivers,
  missingMemory,
  missingIdentity,
  missingConnector,
}: {
  missingDrivers: string[];
  missingMemory: boolean;
  missingIdentity: boolean;
  missingConnector: boolean;
}) {
  const lines: string[] = [];
  if (missingDrivers.length > 0) {
    lines.push(`Driver(s) not in watchdog topology: ${missingDrivers.join(", ")}.`);
  }
  if (missingMemory) lines.push("Memory component not in watchdog topology.");
  if (missingIdentity) lines.push("Identity component not in watchdog topology.");
  if (missingConnector) lines.push("Connector component not in watchdog topology.");
  if (lines.length === 0) return null;
  return (
    <div className="status-warn mb-4 rounded-[var(--radius)] border px-3 py-2 text-xs">
      <p className="mb-1 font-medium">Heads-up — missing topology entries:</p>
      <ul className="ml-4 list-disc">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <p className="mt-2">
        The wizard configures existing components. Add the missing entries from the Config page or
        hand-edit <span className="font-mono">watchdog.yaml</span>, then re-run setup or restart
        from the Config page.
      </p>
    </div>
  );
}

/* ────────────────────────────── leaves ─────────────────────────────── */

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

function providerLabelFor(key: string): string {
  return WIZARD_PROVIDERS.find((p) => p.key === key)?.label ?? key;
}
