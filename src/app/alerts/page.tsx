"use client";

/**
 * Alerts (row 38, `specs/docs/design/rows/row-38.md`).
 *
 * What fired comes first, then what resolved, then the settings: the rules,
 * the SLO targets and the webhook. The control root evaluates the rules once
 * a minute; this page shows what it decided and, for the owner, edits what
 * it watches. A person with an operations power reads what fired and nothing
 * else. Every value shown in the settings is the one the root answered with
 * after the last save, never the one typed.
 */

import Link from "next/link";
import { Bell, BellRing, CircleCheck, Plus, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { DashboardSection } from "@/components/GatewayOperations";
import { api, describeError } from "@/lib/api";
import {
  newRule,
  newSlo,
  ruleLine,
  RULE_KINDS,
  type Alert,
  type AlertingSettings,
  type AlertRule,
  type AlertRuleKind,
  type AlertsView,
  type AlertWebhookStatus,
  type SloTarget,
} from "@/lib/alerts";
import { labelOf } from "@/lib/nodeLabels";
import { inOperationsMode } from "@/lib/operations";
import { clockTime, formatTimestamp } from "@/lib/relativeTime";
import type { ClientKeyList } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const POLL_MS = 30_000;

const field =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 text-sm";
const button =
  "action-button font-ui inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm disabled:opacity-50";

export default function AlertsPage() {
  const [view, setView] = useState<AlertsView | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const owner = !inOperationsMode();

  const load = useCallback(async () => {
    try {
      setView(await api.get<AlertsView>("control", "/v1/alerts"));
      setViewError(null);
    } catch (e) {
      setViewError(describeError(e));
    }
  }, []);
  usePolling(load, POLL_MS);

  const firing = view?.firing ?? [];
  const headline = view
    ? firing.length
      ? `${firing.length} alert${firing.length === 1 ? "" : "s"} firing.`
      : "Nothing is firing."
    : "Alerts";

  return (
    <AppShell>
      <main data-testid="alerts-scroll" className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
          <header className="mb-6 border-b border-[color:var(--border)] pb-5">
            <p className="font-ui mb-2 flex items-center gap-2 text-xs font-semibold tracking-widest text-[color:var(--accent-right)]">
              <Bell size={15} aria-hidden />
              ALERTS
            </p>
            <h1 className="font-ui text-3xl font-semibold tracking-tight">{headline}</h1>
            {view && <EvaluationLine view={view} />}
          </header>

          {viewError && (
            <p className="text-status-error font-ui mb-4 text-sm" role="alert">
              Alerts not read: {viewError}
            </p>
          )}

          {view && (
            <>
              <DashboardSection id="firing" title="Firing now" description="Newest first">
                {firing.length === 0 ? (
                  <p className="flex items-center gap-2 text-sm text-[color:var(--muted)]">
                    <CircleCheck
                      size={15}
                      aria-hidden
                      className="text-[color:var(--status-success-fg)]"
                    />
                    No rule holds now.
                  </p>
                ) : (
                  <AlertList alerts={[...firing].sort(newestFirst)} />
                )}
              </DashboardSection>
              <DashboardSection id="recent" title="Resolved lately" description="The last 100">
                {view.recent.length === 0 ? (
                  <p className="text-sm text-[color:var(--muted)]">Nothing has resolved yet.</p>
                ) : (
                  <AlertList alerts={view.recent} />
                )}
              </DashboardSection>
            </>
          )}

          {owner ? (
            <AlertSettings onSaved={load} webhook={view?.webhook ?? null} />
          ) : (
            <p className="text-sm text-[color:var(--muted)]">
              The owner sets the rules, the SLO targets and where alerts are sent.
            </p>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function newestFirst(a: Alert, b: Alert): number {
  return Date.parse(b.startedAt) - Date.parse(a.startedAt);
}

function EvaluationLine({ view }: { view: AlertsView }) {
  return (
    <div className="mt-2 space-y-1 text-sm text-[color:var(--muted)]">
      <p>
        {view.evaluating
          ? view.evaluatedAt
            ? `Checked at ${clockTime(view.evaluatedAt)}, once a minute.`
            : "Checking once a minute; the first check is not done yet."
          : "Not checking now: the control root is locked, or this is a standby."}
      </p>
      {view.problems.length > 0 && (
        <details>
          <summary className="cursor-pointer">
            {view.problems.length} read{view.problems.length === 1 ? "" : "s"} failed in the last
            check
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {view.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function AlertList({ alerts }: { alerts: Alert[] }) {
  return (
    <ul className="section-panel divide-y divide-[color:var(--border)]">
      {alerts.map((a) => (
        <li key={`${a.id}|${a.startedAt}`} className="flex flex-wrap items-baseline gap-x-3 py-2">
          {a.state === "firing" ? (
            <BellRing size={14} aria-hidden className="text-status-error self-center" />
          ) : (
            <CircleCheck size={14} aria-hidden className="self-center text-[color:var(--muted)]" />
          )}
          <span className="font-ui text-sm">{a.message}</span>
          <span className="text-xs text-[color:var(--muted)]">
            {a.state === "firing"
              ? `since ${formatTimestamp(a.startedAt)}`
              : `${formatTimestamp(a.startedAt)} to ${formatTimestamp(a.resolvedAt)}`}
          </span>
          {a.link && (
            <Link href={a.link} className="text-xs underline">
              See it
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

// --------------------------------------------------------------------------- //
// Settings: the owner's
// --------------------------------------------------------------------------- //

function AlertSettings({
  onSaved,
  webhook,
}: {
  onSaved: () => Promise<void>;
  webhook: AlertWebhookStatus | null;
}) {
  const [held, setHeld] = useState<AlertingSettings | null>(null);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [slos, setSlos] = useState<SloTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [keys, setKeys] = useState<{ id: string; name: string }[]>([]);
  const [machines, setMachines] = useState<string[]>([]);

  const take = useCallback((settings: AlertingSettings) => {
    setHeld(settings);
    setRules(settings.rules);
    setSlos(settings.slos);
  }, []);

  useEffect(() => {
    api
      .get<AlertingSettings>("control", "/v1/alerting")
      .then(take)
      .catch((e: unknown) => setError(describeError(e)));
    api
      .get<ClientKeyList>("agent", "/v1/auth/client-keys")
      .then((list) =>
        setKeys(
          (list.keys ?? [])
            .filter((k) => !k.revokedAt)
            .map((k) => ({ id: k.id, name: k.name ?? k.id })),
        ),
      )
      .catch(() => setKeys([]));
    api
      .get<{ nodes?: { name: string }[] }>("control", "/v1/nodes")
      .then((list) => setMachines((list.nodes ?? []).map((n) => n.name)))
      .catch(() => setMachines([]));
  }, [take]);

  const changed = useMemo(
    () =>
      held !== null &&
      JSON.stringify({ rules, slos }) !== JSON.stringify({ rules: held.rules, slos: held.slos }),
    [held, rules, slos],
  );

  const save = async (extra: { webhookUrl?: string | null } = {}) => {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const answer = await api.put<AlertingSettings>("control", "/v1/alerting", {
        rules,
        slos,
        ...extra,
      });
      take(answer);
      setSaved("Saved.");
      await onSaved();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!held) {
    return error ? (
      <p className="text-status-error font-ui text-sm" role="alert">
        Alert settings not read: {error}
      </p>
    ) : null;
  }

  const ruleIds = rules.map((r) => r.id);
  const sloIds = slos.map((s) => s.id);
  const setRule = (i: number, patch: Partial<AlertRule>) =>
    setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setSlo = (i: number, patch: Partial<SloTarget>) =>
    setSlos(slos.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <>
      <DashboardSection
        id="rules"
        title="Rules"
        description={held.defaults ? "The built-in rules, until you save your own" : "Yours"}
      >
        <div className="section-panel space-y-3">
          {rules.length === 0 && (
            <p className="text-sm text-[color:var(--muted)]">No rules: nothing fires.</p>
          )}
          {rules.map((rule, i) => {
            const kind = RULE_KINDS[rule.kind];
            return (
              <fieldset
                key={i}
                aria-label={`Rule ${rule.id}`}
                className="flex flex-wrap items-end gap-3 border-b border-[color:var(--border)] pb-3"
              >
                <legend className="font-ui mb-1 w-full text-sm font-medium">
                  {ruleLine(rule)}
                </legend>
                <label className="font-ui flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={rule.enabled !== false}
                    onChange={(e) => setRule(i, { enabled: e.target.checked })}
                  />
                  On
                </label>
                {kind.threshold && (
                  <label className="font-ui flex flex-col text-xs text-[color:var(--muted)]">
                    {kind.threshold}
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={rule.threshold ?? 0}
                      onChange={(e) => setRule(i, { threshold: Number(e.target.value) })}
                      className={`${field} w-24`}
                    />
                  </label>
                )}
                <label className="font-ui flex flex-col text-xs text-[color:var(--muted)]">
                  {rule.kind === "failure-rate" ? "Over minutes" : "For minutes"}
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={rule.forMinutes ?? 5}
                    onChange={(e) => setRule(i, { forMinutes: Number(e.target.value) })}
                    className={`${field} w-20`}
                  />
                </label>
                {(rule.kind === "machine-down" ||
                  rule.kind === "disk-full" ||
                  rule.kind === "gpu-hot") && (
                  <label className="font-ui flex flex-col text-xs text-[color:var(--muted)]">
                    Machine
                    <select
                      value={rule.machine ?? ""}
                      onChange={(e) => setRule(i, { machine: e.target.value || null })}
                      className={field}
                    >
                      <option value="">Every machine</option>
                      {machines.map((m) => (
                        <option key={m} value={m}>
                          {labelOf(m) ?? m}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {rule.kind === "failure-rate" && (
                  <label className="font-ui flex flex-col text-xs text-[color:var(--muted)]">
                    Model (empty: every model)
                    <input
                      value={rule.model ?? ""}
                      onChange={(e) => setRule(i, { model: e.target.value.trim() || null })}
                      className={`${field} w-48`}
                    />
                  </label>
                )}
                {rule.kind === "slo-burn" && (
                  <label className="font-ui flex flex-col text-xs text-[color:var(--muted)]">
                    SLO
                    <select
                      value={rule.sloId ?? ""}
                      onChange={(e) => setRule(i, { sloId: e.target.value || null })}
                      className={field}
                    >
                      <option value="">Every SLO</option>
                      {slos.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name ?? s.id}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => setRules(rules.filter((_, j) => j !== i))}
                  className={button}
                  aria-label={`Remove rule ${rule.id}`}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </fieldset>
            );
          })}
          <label className="font-ui flex items-center gap-2 text-sm">
            <Plus size={14} aria-hidden />
            Add a rule:
            <select
              value=""
              onChange={(e) => {
                if (e.target.value)
                  setRules([...rules, newRule(e.target.value as AlertRuleKind, ruleIds)]);
              }}
              className={field}
              aria-label="Add a rule"
            >
              <option value="">Choose what to watch</option>
              {(Object.keys(RULE_KINDS) as AlertRuleKind[]).map((k) => (
                <option key={k} value={k}>
                  {RULE_KINDS[k].label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </DashboardSection>

      <DashboardSection
        id="slos"
        title="SLO targets"
        description="Success over a rolling window, for one model, one key or every request"
      >
        <div className="section-panel space-y-3">
          {slos.length === 0 && (
            <p className="text-sm text-[color:var(--muted)]">No targets set.</p>
          )}
          {slos.map((slo, i) => (
            <fieldset
              key={i}
              aria-label={`SLO ${slo.id}`}
              className="flex flex-wrap items-end gap-3 border-b border-[color:var(--border)] pb-3"
            >
              <label className="font-ui flex flex-col text-xs text-[color:var(--muted)]">
                Name
                <input
                  value={slo.name ?? ""}
                  onChange={(e) => setSlo(i, { name: e.target.value || null })}
                  className={`${field} w-40`}
                  placeholder={slo.id}
                />
              </label>
              <label className="font-ui flex flex-col text-xs text-[color:var(--muted)]">
                For
                <select
                  value={slo.clientKeyId ? `key:${slo.clientKeyId}` : slo.model ? "model" : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v.startsWith("key:"))
                      setSlo(i, {
                        clientKeyId: v.slice(4),
                        model: null,
                        firstTokenSeconds: null,
                        firstTokenPercentile: null,
                      });
                    else if (v === "model")
                      setSlo(i, { clientKeyId: null, model: slo.model ?? "" });
                    else setSlo(i, { clientKeyId: null, model: null });
                  }}
                  className={field}
                >
                  <option value="">Every request</option>
                  <option value="model">One model</option>
                  {keys.map((k) => (
                    <option key={k.id} value={`key:${k.id}`}>
                      Key: {k.name}
                    </option>
                  ))}
                </select>
              </label>
              {slo.model !== null && slo.model !== undefined && !slo.clientKeyId && (
                <label className="font-ui flex flex-col text-xs text-[color:var(--muted)]">
                  Model
                  <input
                    value={slo.model}
                    onChange={(e) => setSlo(i, { model: e.target.value })}
                    className={`${field} w-48`}
                  />
                </label>
              )}
              <label className="font-ui flex flex-col text-xs text-[color:var(--muted)]">
                Served, %
                <input
                  type="number"
                  min={50}
                  max={99.999}
                  step="any"
                  value={slo.successPercent}
                  onChange={(e) => setSlo(i, { successPercent: Number(e.target.value) })}
                  className={`${field} w-24`}
                />
              </label>
              <label className="font-ui flex flex-col text-xs text-[color:var(--muted)]">
                Over days
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={slo.windowDays ?? 30}
                  onChange={(e) => setSlo(i, { windowDays: Number(e.target.value) })}
                  className={`${field} w-20`}
                />
              </label>
              {!slo.clientKeyId && (
                <>
                  <label className="font-ui flex flex-col text-xs text-[color:var(--muted)]">
                    First token within, s
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={slo.firstTokenSeconds ?? ""}
                      onChange={(e) =>
                        setSlo(
                          i,
                          e.target.value === ""
                            ? { firstTokenSeconds: null, firstTokenPercentile: null }
                            : {
                                firstTokenSeconds: Number(e.target.value),
                                firstTokenPercentile: slo.firstTokenPercentile ?? 90,
                              },
                        )
                      }
                      className={`${field} w-20`}
                    />
                  </label>
                  {slo.firstTokenSeconds !== null && slo.firstTokenSeconds !== undefined && (
                    <label className="font-ui flex flex-col text-xs text-[color:var(--muted)]">
                      For this share
                      <select
                        value={slo.firstTokenPercentile ?? 90}
                        onChange={(e) =>
                          setSlo(i, {
                            firstTokenPercentile: Number(e.target.value) as 50 | 90 | 99,
                          })
                        }
                        className={field}
                      >
                        <option value={50}>50%</option>
                        <option value={90}>90%</option>
                        <option value={99}>99%</option>
                      </select>
                    </label>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={() => setSlos(slos.filter((_, j) => j !== i))}
                className={button}
                aria-label={`Remove SLO ${slo.id}`}
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() => setSlos([...slos, newSlo(sloIds)])}
            className={button}
          >
            <Plus size={14} aria-hidden />
            Add a target
          </button>
        </div>
      </DashboardSection>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!changed || saving}
          onClick={() => void save()}
          className={button}
        >
          {saving ? "Saving…" : "Save rules and targets"}
        </button>
        {changed && (
          <button type="button" onClick={() => take(held)} className={button} disabled={saving}>
            Undo changes
          </button>
        )}
        {saved && !changed && <span className="text-sm text-[color:var(--muted)]">{saved}</span>}
        {error && (
          <span className="text-status-error text-sm" role="alert">
            {error}
          </span>
        )}
      </div>

      <WebhookSettings
        held={held}
        status={webhook}
        busy={saving}
        onSet={(url) => save({ webhookUrl: url })}
        onSaved={onSaved}
      />
    </>
  );
}

function WebhookSettings({
  held,
  status,
  busy,
  onSet,
  onSaved,
}: {
  held: AlertingSettings;
  status: AlertWebhookStatus | null;
  busy: boolean;
  onSet: (url: string | null) => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<AlertWebhookStatus | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const shown = tested ?? status;

  const line = !held.webhook.configured
    ? "No webhook: alerts show here and on Home only."
    : shown?.state === "failing"
      ? `The webhook at ${held.webhook.host} did not answer: ${shown.lastError ?? "no cause given"}.`
      : `Alerts are posted to ${held.webhook.host}.`;

  return (
    <DashboardSection
      id="webhook"
      title="Webhook"
      description="Off unless you set one · JSON that Slack, Discord, ntfy and Home Assistant take"
    >
      <div className="section-panel space-y-3">
        <p
          className={`font-ui text-sm ${shown?.state === "failing" && held.webhook.configured ? "text-status-error" : ""}`}
        >
          {line}
        </p>
        {held.webhook.configured && shown?.lastSuccessAt && (
          <p className="text-xs text-[color:var(--muted)]">
            Last answered {formatTimestamp(shown.lastSuccessAt)}.
          </p>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void onSet(url.trim()).then(() => setUrl(""));
          }}
        >
          <label className="font-ui flex flex-col text-xs text-[color:var(--muted)]">
            {held.webhook.configured ? "Replace the address" : "Address"}
            <input
              type="url"
              autoComplete="off"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/…"
              className={`${field} w-96 max-w-full`}
            />
          </label>
          <button type="submit" disabled={busy || url.trim() === ""} className={button}>
            Set the webhook
          </button>
          {held.webhook.configured && (
            <>
              <button
                type="button"
                disabled={busy || testing}
                className={button}
                onClick={async () => {
                  setTesting(true);
                  setTestError(null);
                  try {
                    setTested(
                      await api.post<AlertWebhookStatus>("control", "/v1/alerting/test", {}),
                    );
                    await onSaved();
                  } catch (e) {
                    setTestError(describeError(e));
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                <Send size={14} aria-hidden />
                {testing ? "Sending…" : "Send a test"}
              </button>
              <button
                type="button"
                disabled={busy}
                className={button}
                onClick={() => void onSet(null).then(() => setTested(null))}
              >
                Remove the webhook
              </button>
            </>
          )}
        </form>
        {testError && (
          <p className="text-status-error text-sm" role="alert">
            {testError}
          </p>
        )}
        <p className="text-xs text-[color:var(--muted)]">
          The address is kept sealed and never shown again. Each alert is posted when it fires and
          when it resolves, tried three times. A webhook that fails never stops alerts showing here.
        </p>
      </div>
    </DashboardSection>
  );
}
