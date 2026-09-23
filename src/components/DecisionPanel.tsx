"use client";

/**
 * The decision test panel — a usable first client for POST /v1/systemone
 * and a diagnostic in the playground's own sense: "the panel decides
 * fine, so my problem is in my app". Renders only when the install
 * actually serves a decision model (the gateway's /v1/models marks the
 * `decisions` surface), because a panel for a surface nothing serves is
 * a form that can only fail.
 *
 * The pure half — sample ticket, request shape, curl escaping, the
 * pinned SDK snippet, answer descriptions — lives in lib/decisions and
 * is tested there; this component is the wiring.
 */

import { useMemo, useState } from "react";

import { api, describeError } from "@/lib/api";
import {
  REGISTER_SERVER_RECIPE,
  SAMPLE_TICKET,
  type SystemOneRequest,
  type SystemOneResponse,
  buildRequest,
  curlLine,
  describeAnswer,
  sampleQuestions,
  sdkSnippet,
} from "@/lib/decisions";

const panelClass =
  "rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-3 text-sm";
const buttonClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";
const textareaClass =
  "w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-2 font-mono text-xs";

export function DecisionPanel({ models }: { models: string[] }) {
  const [model, setModel] = useState(models[0] ?? "");
  const [stateText, setStateText] = useState(JSON.stringify(SAMPLE_TICKET, null, 2));
  const [questionsText, setQuestionsText] = useState(JSON.stringify(sampleQuestions(), null, 2));
  const [result, setResult] = useState<SystemOneResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [showClients, setShowClients] = useState(false);

  const request: SystemOneRequest | null = useMemo(() => {
    try {
      const questions = JSON.parse(questionsText) as SystemOneRequest["questions"];
      let state: unknown = stateText;
      try {
        state = JSON.parse(stateText);
      } catch {
        // Plain text is a legal state; the protocol takes both.
      }
      return buildRequest(model, state, questions);
    } catch {
      return null;
    }
  }, [model, stateText, questionsText]);

  // Labelled a guess, exactly like the diagnostic panel's base URL: on
  // a port-remapped install (the container publishes 8280) the operator
  // corrects it once for the copyable lines. Requests from THIS panel go
  // through the proxy and never use it.
  const [baseUrl, setBaseUrl] = useState(() =>
    typeof window === "undefined"
      ? "http://127.0.0.1:8080"
      : `${window.location.protocol}//${window.location.hostname}:8080`,
  );

  async function send() {
    if (request === null) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.post<SystemOneResponse>("gateway", "/v1/systemone", request));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={panelClass} data-testid="decision-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">Decisions</h2>
        <span className="text-[0.6875rem] text-[color:var(--muted)]">
          typed questions against one state — POST /v1/systemone, the TypeSafe shape
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="text-xs" htmlFor="decision-model">
          Model
        </label>
        <select
          id="decision-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 text-xs"
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || request === null}
          className={buttonClass}
          data-testid="decision-send"
        >
          {busy ? "Deciding…" : "Decide"}
        </button>
        {request === null && (
          <span className="text-status-error text-xs">The questions are not valid JSON.</span>
        )}
      </div>

      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          State — the record being judged (JSON or plain text)
          <textarea
            value={stateText}
            onChange={(e) => setStateText(e.target.value)}
            rows={7}
            className={textareaClass}
            data-testid="decision-state"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Questions — noul, choice, score
          <textarea
            value={questionsText}
            onChange={(e) => setQuestionsText(e.target.value)}
            rows={7}
            className={textareaClass}
            data-testid="decision-questions"
          />
        </label>
      </div>

      {error && (
        <p className="status-error mt-2 rounded-[var(--radius)] border px-2 py-1 text-xs">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-2" data-testid="decision-result">
          <ul className="flex flex-col gap-1 text-xs">
            {Object.entries(result.answers).map(([name, answer]) => (
              <li key={name} className="font-mono">
                {describeAnswer(name, answer)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[0.6875rem] text-[color:var(--muted)]">
            served by {result.model}
            {result.usage
              ? ` · ${result.usage.input_tokens ?? "?"} in / ${result.usage.output_tokens ?? "?"} out`
              : ""}
          </p>
          <button type="button" onClick={() => setShowRaw((v) => !v)} className={buttonClass}>
            {showRaw ? "Hide raw answer" : "Raw answer"}
          </button>
          {showRaw && (
            <pre className="mt-1 overflow-x-auto rounded-[var(--radius)] border border-[color:var(--border)] p-2 text-[0.625rem]">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowClients((v) => !v)}
          className={buttonClass}
          data-testid="decision-clients"
        >
          {showClients ? "Hide client examples" : "Use it from your code"}
        </button>
        {showClients && request !== null && (
          <div className="mt-2 flex flex-col gap-2 text-xs">
            <label className="flex items-center gap-2">
              Gateway address (a guess — correct it if this install remaps ports)
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="min-w-64 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 font-mono text-xs"
              />
            </label>
            <details>
              <summary>curl — this exact request</summary>
              <pre className="mt-1 overflow-x-auto rounded-[var(--radius)] border border-[color:var(--border)] p-2 text-[0.625rem]">
                {curlLine(baseUrl, request)}
              </pre>
            </details>
            <details>
              <summary>TypeSafe Python SDK (pinned, retries off)</summary>
              <pre className="mt-1 overflow-x-auto rounded-[var(--radius)] border border-[color:var(--border)] p-2 text-[0.625rem]">
                {sdkSnippet(baseUrl, model)}
              </pre>
            </details>
            <details>
              <summary>Registering another System One-compatible server</summary>
              <p className="mt-1 leading-relaxed text-[color:var(--muted)]">
                {REGISTER_SERVER_RECIPE}
              </p>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}
