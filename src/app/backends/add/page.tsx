"use client";

/**
 * Add an app you already run.
 *
 * Hobbyist UX §6.2, slice S2: the wizard's Backend screen, moved out of
 * first-run setup and made a page of the install root, reached from Home's
 * first-model card and from Inference. It is the same three calls the
 * wizard made after Start - create the driver, give it its settings,
 * restart it - followed by the same question the wizard asked last, which
 * model, from the list the app itself reports.
 *
 * **Why a page and not a wizard step.** The person who has just installed
 * Eugene and has no models is the one the wizard is for, and §0.4 counted
 * "which external backend" among the questions they cannot answer yet.
 * The person who already runs Ollama knows the answer and wants it as a
 * task they can reach later, from wherever they notice nothing is
 * serving. Both are served by the same form in a different place.
 *
 * **The words are the person's (P5).** "app", "backend", "model". Not
 * "driver", "declaration", "companion" or "topology" - the shape
 * underneath is a driver component the agent does not otherwise declare,
 * and the page knows that so the person does not have to.
 *
 * Three states, one primary action each: the form (Add), the model picker
 * (Save), and done (a link to Inference, where the app now appears).
 */

import Link from "next/link";
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { api } from "@/lib/api";
import { providerLabel } from "@/lib/agent";
import type { ComponentList } from "@/lib/types";
import { useSetupGate } from "@/lib/useSetupGate";
import { type BackendDraft, blankBackend } from "@/app/setup/draft";
import {
  backendCredentialsComplete,
  buildBackendPatch,
  driverNameFor,
  fetchBackendModels,
  formatStartError,
  freeDriverPort,
  withRetry,
} from "@/app/setup/start";

import { BackendForm } from "./BackendForm";
import { PickModel } from "./PickModel";

type Phase =
  | { kind: "form" }
  | { kind: "pick"; name: string; models: string[] }
  | { kind: "done"; name: string; modelId: string | null };

export default function AddBackendPage() {
  const gate = useSetupGate();
  const [backend, setBackend] = useState<BackendDraft>(blankBackend());
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function patch(p: Partial<BackendDraft>) {
    setBackend((prev) => ({ ...prev, ...p }));
  }

  /** Add: create the app's driver, give it its settings, ask what it serves. */
  async function add() {
    setWorking(true);
    setError(null);
    try {
      // The live list, for a free name and a free port. Read now rather
      // than on mount so a driver added in another tab meanwhile is seen.
      const live = await api.get<ComponentList>("agent", "/v1/components");
      const components = live.components ?? [];
      const name = driverNameFor(backend.provider, components);
      const port = freeDriverPort(components);

      // CREATE, not configure: nothing declares a driver for an app the
      // agent does not supervise, so a PATCH alone has nothing to patch.
      setMessage("Adding the app…");
      await api.post("agent", "/v1/components", {
        name,
        kind: "inference-driver",
        url: `http://127.0.0.1:${port}`,
        spawn: { configFile: `${name}.yaml` },
      });
      // Its config is its own file, written once it is up. Retried because
      // a just-created component answers nothing for its first second.
      setMessage("Saving its settings…");
      await withRetry(() => api.patch(name, "/v1/config", buildBackendPatch(backend)));
      // A driver reads its provider and model at startup, so PATCH alone
      // leaves `pendingRestart` and an app still serving nothing.
      setMessage("Restarting it so the settings take…");
      await withRetry(() =>
        api.post("agent", `/v1/components/${encodeURIComponent(name)}/restart`, {}),
      );
      // Now that it exists and is talking to the app, ask what it can
      // serve. The driver publishes discovered models as `suggestions` on
      // the modelId field of its own config schema - the same list Config
      // renders as a dropdown.
      setMessage("Asking it which models it has…");
      const models = await withRetry(() => fetchBackendModels(name));
      setPhase({ kind: "pick", name, models });
      setMessage(null);
    } catch (e) {
      setError(formatStartError(e));
    } finally {
      setWorking(false);
    }
  }

  /** Save: the model, then a restart so the gateway starts routing to it. */
  async function save(name: string) {
    const modelId = backend.modelId.trim();
    setWorking(true);
    setError(null);
    try {
      setMessage("Setting the model…");
      await withRetry(() => api.patch(name, "/v1/config", { modelId }));
      // Read at startup, like the provider: without this the gateway lists
      // nothing and the app is silently inert.
      setMessage("Restarting it…");
      await withRetry(() =>
        api.post("agent", `/v1/components/${encodeURIComponent(name)}/restart`, {}),
      );
      setPhase({ kind: "done", name, modelId });
      setMessage(null);
    } catch (e) {
      setError(formatStartError(e));
    } finally {
      setWorking(false);
    }
  }

  function reset() {
    setBackend(blankBackend());
    setPhase({ kind: "form" });
    setError(null);
    setMessage(null);
  }

  if (gate === "checking") {
    return (
      <main className="relative z-10 flex h-screen items-center justify-center">
        <p className="font-ui text-xs text-[color:var(--muted)]">Checking setup state…</p>
      </main>
    );
  }

  return (
    <AppShell>
      <main data-testid="backends-add" className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto w-full max-w-2xl">
          <h1 className="font-ui mb-2 text-xl font-semibold">Add an app you already run</h1>
          <p className="mb-6 text-sm leading-relaxed text-[color:var(--muted)]">
            Ollama, LM Studio, a cloud API, or a subscription you already pay for. Eugene adds it
            beside your own models and sends requests to it the same way.
          </p>

          {phase.kind === "form" && (
            <section>
              <BackendForm backend={backend} disabled={working} onChange={patch} />
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void add()}
                  disabled={working || !backendCredentialsComplete(backend)}
                  className={primary}
                >
                  {working ? "Adding…" : "Add"}
                </button>
                <Link href="/" className={secondary}>
                  Not now
                </Link>
              </div>
            </section>
          )}

          {phase.kind === "pick" && (
            <section>
              <h2 className="font-ui mb-2 text-base font-semibold">Which model?</h2>
              <PickModel
                driverName={phase.name}
                models={phase.models}
                value={backend.modelId}
                disabled={working}
                onChange={(v) => patch({ modelId: v })}
              />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void save(phase.name)}
                  disabled={working || backend.modelId.trim() === ""}
                  className={primary}
                >
                  {working ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setPhase({ kind: "done", name: phase.name, modelId: null })}
                  disabled={working}
                  className={secondary}
                >
                  Choose later
                </button>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[color:var(--muted)]">
                Choosing later is fine. The app will not answer anything until a model is set, under
                Config.
              </p>
            </section>
          )}

          {phase.kind === "done" && (
            <section data-testid="backend-added">
              <p className="mb-4 text-sm leading-relaxed">
                <span className="font-mono">{phase.name}</span> is added
                {phase.modelId ? (
                  <>
                    {" "}
                    and answers for <span className="font-mono">{phase.modelId}</span>.
                  </>
                ) : (
                  <>. It has no model yet, so set one under Config before it can answer.</>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/inference" className={primary}>
                  See it on Inference
                </Link>
                <button type="button" onClick={reset} className={secondary}>
                  Add another
                </button>
              </div>
            </section>
          )}

          {working && message && (
            <p
              data-testid="backend-status"
              className="mt-6 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs text-[color:var(--muted)]"
            >
              {message}
            </p>
          )}
          {error && (
            <p className="status-error mt-6 rounded-[var(--radius)] border px-3 py-2 text-xs">
              {phase.kind === "form" && backend.provider
                ? `${providerLabel(backend.provider)} could not be added. ${error}`
                : error}
            </p>
          )}
        </div>
      </main>
    </AppShell>
  );
}

const primary =
  "font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-5 py-2 text-xs font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";
const secondary =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-4 py-2 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40";
