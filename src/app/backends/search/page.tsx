"use client";

/**
 * Add a search account (P8).
 *
 * The page that turns web search on for local models. Codex's live search,
 * Claude Code's WebSearch and chat's `web_search_options` each ask the
 * provider to search; on a local model there was no provider, so Codex
 * lost its search and Claude Code's failed. With an account here, Eugene
 * runs the search and hands the model the results.
 *
 * Three calls, as `/backends/add` makes for a backend: create the search
 * account (a tool-driver the agent supervises), give it its settings, and
 * run one real search with them -- the Test -- so the person learns now,
 * not when a model asks, that SearXNG has JSON output off or that a key
 * was refused.
 *
 * The words are the person's: "search account", "address", "key". Not
 * "tool-driver", "component" or "egress".
 */

import Link from "next/link";
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { SetupGateScreen } from "@/components/SetupGateScreen";
import { api, describeError } from "@/lib/api";
import type { ComponentList } from "@/lib/types";
import { useSetupGate } from "@/lib/useSetupGate";
import { withRetry } from "@/app/setup/start";

import {
  blankSearch,
  freeSearchPort,
  remedyFor,
  SEARCH_PROVIDERS,
  type SearchDraft,
  searchDraftComplete,
  searchNameFor,
  searchPatch,
} from "./searchAccount";

interface TestResult {
  ok: boolean;
  summary?: string | null;
  error?: string | null;
  sampleOutput?: string | null;
}

type Phase = { kind: "form" } | { kind: "done"; name: string; summary: string | null };

export default function AddSearchAccountPage() {
  const gate = useSetupGate();
  const [draft, setDraft] = useState<SearchDraft>(blankSearch());
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The account this page created, when its Test failed: pressing Try
  // again corrects it rather than creating a second one beside it.
  const [created, setCreated] = useState<{ name: string; provider: string } | null>(null);

  function patch(p: Partial<SearchDraft>) {
    setDraft((prev) => ({ ...prev, ...p }));
  }

  async function add() {
    setWorking(true);
    setError(null);
    try {
      let name: string;
      if (created && created.provider === draft.provider) {
        name = created.name;
      } else {
        if (created) {
          // A different provider than the half-added one: take that one back.
          await api
            .delete<void>("agent", `/v1/components/${encodeURIComponent(created.name)}`)
            .catch(() => undefined);
          setCreated(null);
        }
        const live = await api.get<ComponentList>("agent", "/v1/components");
        const components = live.components ?? [];
        name = searchNameFor(draft.provider, components);
        setMessage("Adding the search account…");
        await api.post("agent", "/v1/components", {
          name,
          kind: "tool-driver",
          url: `http://127.0.0.1:${freeSearchPort(components)}`,
          spawn: { configFile: `${name}.yaml` },
        });
        setCreated({ name, provider: draft.provider });
      }
      // Settings are read per search, so no restart is needed after this.
      setMessage("Saving its settings…");
      await withRetry(() => api.patch(name, "/v1/config", searchPatch(draft)));
      setMessage("Running a test search…");
      const test = await withRetry(() => api.post<TestResult>(name, "/v1/config/test", {}));
      if (!test.ok) {
        const said = test.error ?? "the test search failed";
        const remedy = remedyFor(draft.provider, said);
        setError(`The test search failed: ${said}${remedy ? ` ${remedy}` : ""}`);
        return;
      }
      setCreated(null);
      setPhase({ kind: "done", name, summary: test.summary ?? null });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setWorking(false);
      setMessage(null);
    }
  }

  if (gate.state !== "ready") {
    return <SetupGateScreen state={gate.state} onRetry={gate.retry} />;
  }

  return (
    <AppShell>
      <main data-testid="search-add" className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto w-full max-w-2xl">
          <h1 className="font-ui mb-2 text-xl font-semibold">Add a search account</h1>
          <p className="mb-6 text-sm leading-relaxed text-[color:var(--muted)]">
            Lets your local models search the web when an app asks them to: Codex, Claude Code, or
            any chat app that asks for a search. Eugene runs the search here and gives the model the
            results. The words searched for go to the internet.
          </p>

          {phase.kind === "form" && (
            <section>
              <fieldset disabled={working} className="mb-4 space-y-3">
                <legend className="font-ui mb-2 text-sm font-semibold">Search with</legend>
                {SEARCH_PROVIDERS.map((p) => (
                  <label key={p.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="search-provider"
                      checked={draft.provider === p.id}
                      onChange={() => patch({ provider: p.id })}
                      data-testid={`search-provider-${p.id}`}
                    />
                    <span>
                      <span className="font-medium">{p.label}</span>{" "}
                      <span className="text-[color:var(--muted)]">— {p.says}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {draft.provider === "searxng" ? (
                <label className="mb-4 block text-sm">
                  SearXNG address
                  <input
                    className={field}
                    type="url"
                    placeholder="http://192.168.1.20:8888"
                    value={draft.address}
                    onChange={(e) => patch({ address: e.target.value })}
                    disabled={working}
                    data-testid="search-address"
                  />
                  <span className="mt-1 block text-[color:var(--muted)]">
                    Its settings must allow JSON: in settings.yml, under <code>search:</code>, the
                    list <code>formats:</code> needs <code>- json</code> beside <code>- html</code>.
                  </span>
                </label>
              ) : (
                <label className="mb-4 block text-sm">
                  Brave Search API key
                  <input
                    className={field}
                    type="password"
                    autoComplete="off"
                    value={draft.apiKey}
                    onChange={(e) => patch({ apiKey: e.target.value })}
                    disabled={working}
                    data-testid="search-key"
                  />
                  <span className="mt-1 block text-[color:var(--muted)]">
                    From api-dashboard.search.brave.com. Stored encrypted.
                  </span>
                </label>
              )}

              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void add()}
                  disabled={working || !searchDraftComplete(draft)}
                  className={primary}
                  data-testid="search-add-button"
                >
                  {working ? "Adding…" : created ? "Try again" : "Add"}
                </button>
                <Link href="/inference?sel=backends" className={secondary}>
                  Not now
                </Link>
              </div>
            </section>
          )}

          {phase.kind === "done" && (
            <section data-testid="search-added">
              <p className="mb-2 text-sm leading-relaxed">
                <span className="font-mono">{phase.name}</span> is added, and web search is on.
                {phase.summary ? ` The test search worked: ${phase.summary}` : ""}
              </p>
              <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
                A model searches when an app asks and the model can use tools. In Codex, set{" "}
                <code>web_search = &quot;live&quot;</code>. Claude Code&rsquo;s WebSearch works as
                it is. Each app key can be kept from searching under its permissions.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href={`/playground?search=1`} className={primary} data-testid="search-try">
                  Try a search in the playground
                </Link>
                <Link
                  href={`/config?sel=${encodeURIComponent(`driver:${phase.name}`)}`}
                  className={secondary}
                >
                  Its settings
                </Link>
              </div>
            </section>
          )}

          {working && message && (
            <p
              data-testid="search-status"
              className="mt-6 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm text-[color:var(--muted)]"
            >
              {message}
            </p>
          )}
          {error && (
            <p
              data-testid="search-error"
              className="status-error mt-6 rounded-[var(--radius)] border px-3 py-2 text-sm"
            >
              {error}
            </p>
          )}
        </div>
      </main>
    </AppShell>
  );
}

const field =
  "mt-1 block w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 font-mono";
const primary =
  "action-button action-button--primary font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-5 py-2 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";
const secondary =
  "action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-4 py-2 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40";
