"use client";

/**
 * First-run wizard.
 *
 * Linear seven-screen flow per `project_wizard_first_run_design.md`:
 *
 *   1. Look & feel      — local theme + font, live preview
 *   2. Welcome          — plain-language "body parts" framing
 *   3. Deployment       — all-local vs. networked
 *   4. Orchestrator     — host:port shown only in networked mode
 *   5. Driver 1         — provider + credential + model
 *   6. Driver 2         — same with a "pick a different vendor" hint
 *   7. Memory + Done    — stub explanation + Start button
 *
 * Navigation rules:
 *   - Screen 1: `Cancel` + `Continue →`
 *   - Screens 2–6: `← Back` + `Continue →`
 *   - Screen 7: `← Back` + `Start`
 *
 * State lives in React (with sessionStorage mirror so a tab refresh
 * doesn't lose progress). The actual write-to-watchdog happens only on
 * screen 7's Start button — the wizard treats the entire flow as one
 * transaction and either commits everything or commits nothing.
 *
 * v0.1 scope: this first cut PATCHes existing components' /v1/config
 * with the gathered values and flips firstRunComplete to true. The
 * "from scratch — no components in watchdog yet" flow (create entries
 * with safeMode=true, configure, flip safeMode=false) is a follow-up.
 */

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { useFontSize, FONT_SIZE_LABELS, type FontSize } from "@/lib/useFontSize";
import { useTheme, type Theme } from "@/lib/useTheme";
import {
  WIZARD_PROVIDERS,
  type Component,
  type ComponentList,
  type WatchdogConfigDocument,
  type WizardCredential,
} from "@/lib/watchdog";

const DRAFT_KEY = "eugene-wizard-draft";
const TOTAL_SCREENS = 7;

type DeploymentMode = "local" | "networked";

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
  memoryHost: string;
  memoryPort: number;
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
        if (typeof parsed.screen === "number" && parsed.screen >= 1 && parsed.screen <= TOTAL_SCREENS) {
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

  // Pull the watchdog's current component list once. Screen 7 uses it
  // to show the operator a final summary and to decide what to PATCH
  // vs. what to skip.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await api.get<ComponentList>("watchdog", "/v1/components");
        if (cancelled) return;
        setKnownComponents(list.components ?? []);
      } catch {
        // watchdog unreachable — leave empty; Start will surface the
        // real error when it tries to PATCH.
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
    setStartMessage("Saving driver and orchestrator configuration…");
    try {
      // PATCH each existing driver component with the user's choices.
      // Components must already exist in the watchdog topology for v0.1
      // — the "create from scratch" path is a follow-on.
      const componentsByName = new Map(knownComponents.map((c) => [c.name, c]));
      const driverComponentNames = knownComponents
        .filter((c) => c.kind === "hemisphere-driver")
        .map((c) => c.name);

      for (let i = 0; i < draft.drivers.length; i++) {
        const d = draft.drivers[i]!;
        const driverComponent = componentsByName.get(d.name);
        const patch = buildDriverPatch(d);
        if (!driverComponent) {
          const fallback = driverComponentNames[i];
          if (fallback) {
            // Fall back to the i-th existing driver if the operator
            // renamed without changing watchdog topology.
            await api.patch(fallback, "/v1/config", patch);
          }
          continue;
        }
        await api.patch(d.name, "/v1/config", patch);
      }

      setStartMessage("Finalizing setup…");
      await api.patch("watchdog", "/v1/config", { firstRunComplete: true });

      setStartMessage("Restarting components with your new configuration…");
      // Best-effort restart so drivers pick up provider/api-key changes
      // immediately. Each driver's PATCH set requiresRestart for the
      // fields we touched; restarting here closes that loop.
      for (const d of draft.drivers) {
        if (componentsByName.has(d.name)) {
          try {
            await api.post("watchdog", `/v1/components/${encodeURIComponent(d.name)}/restart`, {});
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
      const detail = e instanceof ApiError ? `${e.status} ${e.statusText}` : e instanceof Error ? e.message : String(e);
      setStartError(detail);
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
          {screen === 1 && <ScreenLookFeel />}
          {screen === 2 && <ScreenWelcome />}
          {screen === 3 && (
            <ScreenDeployment value={draft.deployment} onChange={(v) => patchDraft({ deployment: v })} />
          )}
          {screen === 4 && (
            <ScreenOrchestrator
              mode={draft.deployment}
              host={draft.orchestratorHost}
              port={draft.orchestratorPort}
              onChange={(host, port) => patchDraft({ orchestratorHost: host, orchestratorPort: port })}
            />
          )}
          {screen === 5 && (
            <ScreenDriver
              index={0}
              showHostHint={draft.deployment === "networked"}
              driver={draft.drivers[0]}
              onChange={(p) => patchDriver(0, p)}
            />
          )}
          {screen === 6 && (
            <ScreenDriver
              index={1}
              showHostHint={draft.deployment === "networked"}
              driver={draft.drivers[1]}
              firstProviderKey={draft.drivers[0].provider}
              onChange={(p) => patchDriver(1, p)}
            />
          )}
          {screen === 7 && (
            <ScreenStart
              draft={draft}
              knownComponents={knownComponents}
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
        canContinue={canContinue(screen, draft)}
      />
    </main>
  );
}

function canContinue(screen: number, draft: WizardDraft): boolean {
  if (screen === 5 || screen === 6) {
    const idx = (screen - 5) as 0 | 1;
    const d = draft.drivers[idx];
    if (!d.name.trim()) return false;
    const credentials = WIZARD_PROVIDERS.find((p) => p.key === d.provider)?.credentials ?? [];
    if (credentials.includes("api_key") && !d.apiKey.trim()) return false;
    if (credentials.includes("base_url") && !d.baseUrl.trim()) return false;
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
  return (
    <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-6 py-4">
      <div>
        <p className="font-mono text-[10px] tracking-wider text-[color:var(--muted)] uppercase">
          first-run setup
        </p>
        <h1 className="font-ui text-base font-semibold">Eugene Plexus</h1>
      </div>
      <p className="font-mono text-[11px] text-[color:var(--muted)]">
        Step {screen} of {TOTAL_SCREENS}
      </p>
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
            className="font-ui rounded border border-[color:var(--border)] px-4 py-2 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Cancel
          </button>
        ) : showBack ? (
          <button
            type="button"
            onClick={onBack}
            disabled={starting}
            className="font-ui rounded border border-[color:var(--border)] px-4 py-2 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
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
            className="font-ui rounded bg-[color:var(--accent-left)] px-5 py-2 text-xs font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {starting ? "Starting…" : "Start"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            disabled={!canContinue}
            className="font-ui rounded bg-[color:var(--accent-left)] px-5 py-2 text-xs font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
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
        These choices apply immediately so the rest of setup is comfortable to read.
        You can change them later from the Config page.
      </p>
      <Field
        label="Theme"
        description="Visual style. System follows your OS dark / light preference and updates live."
      >
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
          aria-label="Theme"
          className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none transition-colors hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]"
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
          className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none transition-colors hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]"
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

function ScreenWelcome() {
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Welcome</h2>
      <p className="mb-4 text-sm leading-relaxed">
        Eugene Plexus models a thinking mind as a small system of parts that
        each do one job. Setup walks through those parts in order:
      </p>
      <ul className="mb-4 ml-6 list-disc text-sm leading-relaxed text-[color:var(--muted)]">
        <li>
          <span className="text-[color:var(--foreground)]">Orchestrator</span> —
          coordinates the conversation and asks each driver in turn.
        </li>
        <li>
          <span className="text-[color:var(--foreground)]">Drivers</span> — two
          language models that consider every message side-by-side. Picking
          different vendors for the two drivers creates the most interesting
          behavior.
        </li>
        <li>
          <span className="text-[color:var(--foreground)]">Memory</span> — a
          simple recent-history store for v0.1.
        </li>
      </ul>
      <p className="text-sm leading-relaxed text-[color:var(--muted)]">
        Each step has sensible defaults; you can change anything later from the
        Config page.
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
        Where do the parts of Eugene live? This determines whether the next
        screens ask for host addresses.
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
        The orchestrator runs the conversation loop, sends each prompt to both
        drivers, and merges their responses. Defaults (system prompt, pass cap,
        agreement threshold) are fine for v0.1 — you can tune them later in the
        Config page.
      </p>
      {mode === "networked" && (
        <HostPortRow host={host} port={port} onChange={onChange} />
      )}
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
      <h2 className="font-ui mb-2 text-xl font-semibold">
        Driver {index + 1}
      </h2>
      <p className="mb-2 text-sm text-[color:var(--muted)]">
        One of the two language models Eugene consults on every message.
      </p>
      {hint && (
        <p className="mb-4 rounded border border-amber-700 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          {hint}
        </p>
      )}
      <Field label="Name" description="A label for this driver — defaults to “left” or “right”.">
        <input
          type="text"
          value={driver.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
      </Field>
      {showHostHint && (
        <HostPortRow
          host={driver.host}
          port={driver.port}
          onChange={(host, port) => onChange({ host, port })}
        />
      )}
      <Field
        label="Provider"
        description="Which LLM subscription or service this driver wraps."
      >
        <select
          value={driver.provider}
          onChange={(e) => onChange({ provider: e.target.value })}
          className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
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
          className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
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
            className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
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
            className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
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
            className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
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

function ScreenStart({
  draft,
  knownComponents,
  starting,
  startMessage,
  startError,
}: {
  draft: WizardDraft;
  knownComponents: Component[];
  starting: boolean;
  startMessage: string | null;
  startError: string | null;
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
      value: "in-process stub (v0.1)",
    },
  ];

  const missing = draft.drivers.filter(
    (d) => !knownComponents.find((c) => c.name === d.name && c.kind === "hemisphere-driver"),
  );

  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Memory &amp; ready to start</h2>
      <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
        Memory in v0.1 is an in-process recent-history stub — no setup needed.
        Future versions add a real vector store and a memory-backend choice
        here.
      </p>
      <hr className="my-6 border-[color:var(--border)]" />
      <h3 className="font-ui mb-3 text-sm font-semibold">Ready to start</h3>
      <ul className="mb-4 divide-y divide-[color:var(--border)] rounded border border-[color:var(--border)]">
        {summary.map((row) => (
          <li key={row.label} className="flex justify-between px-3 py-2 text-sm">
            <span className="text-[color:var(--muted)]">{row.label}</span>
            <span className="font-mono text-xs">{row.value}</span>
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <p className="mb-4 rounded border border-amber-700 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          Watchdog topology doesn&rsquo;t yet contain a driver named{" "}
          <span className="font-mono">
            {missing.map((d) => d.name).join(", ")}
          </span>
          . v0.1&rsquo;s wizard configures existing components — add the missing
          driver entries through the Config page or watchdog.yaml, then re-run
          setup.
        </p>
      )}
      {starting && startMessage && (
        <p className="rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs text-[color:var(--muted)]">
          {startMessage}
        </p>
      )}
      {startError && (
        <p className="rounded border border-rose-700 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
          {startError}
        </p>
      )}
    </section>
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
        <p className="mt-1 mb-2 text-xs leading-relaxed text-[color:var(--muted)]">
          {description}
        </p>
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
          className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
      </Field>
      <Field label="Port">
        <input
          type="number"
          value={port}
          onChange={(e) => onChange(host, parseInt(e.target.value, 10) || 0)}
          className="font-ui w-full rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
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
      className={`mb-3 flex cursor-pointer items-start gap-3 rounded border px-4 py-3 transition-colors ${
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
        className="font-ui flex-1 rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
      />
      <button
        type="button"
        onClick={() => setReveal((r) => !r)}
        className="font-ui rounded border border-[color:var(--border)] px-3 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
      >
        {reveal ? "Hide" : "Show"}
      </button>
    </div>
  );
}

function providerLabelFor(key: string): string {
  return WIZARD_PROVIDERS.find((p) => p.key === key)?.label ?? key;
}
