"use client";

/**
 * Usage, allowances and prices (row 40).
 *
 * **Design:** `specs/docs/design/rows/row-40.md`. The control root counts
 * every served request of the install, from any gateway, for its key, the
 * person signed in to the app that sent it, and that person's groups. This
 * page reads `GET /v1/usage` for a day and a month (UTC) and lists each key,
 * group and person with what they used and the allowances that apply.
 *
 * **Prices.** Each model the gateway serves is listed with the price its
 * provider publishes, as its driver reports it, and the owner's own rate,
 * which wins (`PUT /v1/usage/prices`). A local model costs nothing until it
 * has a rate; a cloud model with no price has an unknown cost, never zero.
 * Money is exact: the root says dollars as decimal strings and rates as whole
 * micro-dollars, and nothing here turns either into a float.
 */

import { useCallback, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { DollarInput } from "@/components/home/ClientKeyLimitsEditor";
import { api, describeError } from "@/lib/api";
import type { ModelList } from "@/lib/types";
import {
  allowanceLine,
  microsToDollars,
  type ModelPriceList,
  rateLine,
  tokens,
  usd,
  type UsageReport,
  type UsageSubject,
  type UsageTotals,
} from "@/lib/usage";
import { usePolling } from "@/lib/usePolling";

const POLL_MS = 15_000;
const field =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 text-sm";
const button =
  "action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2.5 py-1 text-sm disabled:opacity-40";

const KIND_HEADINGS: Record<UsageSubject["kind"], string> = {
  key: "Keys",
  group: "Permission groups",
  person: "People",
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "12,040 tokens · 31 requests · $0.42", with the unpriced said, never as $0. */
export function totalsLine(t: UsageTotals): string {
  if (t.requests === 0) return "No requests";
  const unpriced =
    t.unpricedRequests > 0 ? ` (+${t.unpricedRequests} with no price, cost unknown)` : "";
  return `${tokens(t.tokens)} tokens · ${tokens(t.requests)} request${t.requests === 1 ? "" : "s"} · ${usd(t.costUsd)}${unpriced}`;
}

function Subject({ subject }: { subject: UsageSubject }) {
  return (
    <article
      className="flex flex-col gap-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm"
      data-testid={`usage-${subject.kind}-${subject.id}`}
    >
      <h3 className="font-semibold">{subject.name}</h3>
      <p>Day: {totalsLine(subject.day)}</p>
      <p>Month: {totalsLine(subject.month)}</p>
      {subject.range && <p>Range: {totalsLine(subject.range)}</p>}
      {subject.allowances.map((a) => (
        <p
          key={`${a.kind}-${a.setBy ?? ""}`}
          className={a.spent ? "status-error" : undefined}
          data-testid="usage-allowance"
        >
          {a.setBy ? "Group allowance: " : "Allowance: "}
          {allowanceLine(a)}
        </p>
      ))}
      {subject.month.models.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[color:var(--accent-left)]">
            By model this month
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {subject.month.models.map((m) => (
              <li key={m.model}>
                <span className="font-mono">{m.model === "*" ? "Other models" : m.model}</span>:{" "}
                {tokens(m.promptTokens + m.completionTokens)} tokens · {usd(m.costUsd)}
                {m.unpricedRequests > 0 ? ` (+${m.unpricedRequests} unpriced)` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

/** One served model's price row: the provider's beside the owner's rate. */
function PriceRow({
  model,
  provider,
  owner,
  local,
  onSave,
}: {
  model: string;
  provider: { input_per_million_micros: number; output_per_million_micros: number } | null;
  owner: { inputPerMillionMicros: number; outputPerMillionMicros: number } | null;
  local: boolean;
  onSave: (
    price: { inputPerMillionMicros: number; outputPerMillionMicros: number } | null,
  ) => Promise<void>;
}) {
  const [input, setInput] = useState<number | undefined>(owner?.inputPerMillionMicros);
  const [output, setOutput] = useState<number | undefined>(owner?.outputPerMillionMicros);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inEffect = owner
    ? `Your rate: ${rateLine(owner.inputPerMillionMicros, owner.outputPerMillionMicros)}`
    : provider
      ? `Provider's price: ${rateLine(provider.input_per_million_micros, provider.output_per_million_micros)}`
      : local
        ? "No price set: counted as free"
        : "No price: cost unknown, refused under a spend limit";
  const save = async (price: Parameters<typeof onSave>[0]) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(price);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-col gap-1 py-2 text-sm" data-testid={`price-${model}`}>
      <span className="font-mono font-semibold">{model}</span>
      <span>{inEffect}</span>
      {owner && provider && (
        <span className="text-[color:var(--muted)]">
          Provider&rsquo;s price:{" "}
          {rateLine(provider.input_per_million_micros, provider.output_per_million_micros)}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label>
          In, US$ per million{" "}
          <DollarInput
            label={`${model} input price`}
            className={`${field} w-24`}
            micros={input}
            onChange={setInput}
          />
        </label>
        <label>
          Out, US$ per million{" "}
          <DollarInput
            label={`${model} output price`}
            className={`${field} w-24`}
            micros={output}
            onChange={setOutput}
          />
        </label>
        <button
          className={button}
          disabled={busy || input === undefined || output === undefined}
          onClick={() =>
            save({ inputPerMillionMicros: input ?? 0, outputPerMillionMicros: output ?? 0 })
          }
        >
          Set rate
        </button>
        {owner && (
          <button className={button} disabled={busy} onClick={() => save(null)}>
            Clear rate
          </button>
        )}
      </div>
      {error && (
        <span role="alert" className="status-error">
          {error}
        </span>
      )}
    </li>
  );
}

export default function UsagePage() {
  const [day, setDay] = useState(todayUtc());
  const [month, setMonth] = useState(todayUtc().slice(0, 7));
  const [report, setReport] = useState<UsageReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [prices, setPrices] = useState<ModelPriceList | null>(null);
  const [models, setModels] = useState<ModelList | null>(null);
  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ day, month });
      setReport(await api.get<UsageReport>("control", `/v1/usage?${query.toString()}`));
      setPrices(await api.get<ModelPriceList>("control", "/v1/usage/prices"));
      setFailure(null);
    } catch (e) {
      setFailure(describeError(e));
    }
    try {
      setModels(await api.get<ModelList>("gateway", "/v1/models"));
    } catch {
      // The models list is the price list's rows; the usage stands without it.
    }
  }, [day, month]);
  usePolling(load, POLL_MS);
  const grouped = useMemo(() => {
    const out: Record<UsageSubject["kind"], UsageSubject[]> = { key: [], group: [], person: [] };
    for (const s of report?.subjects ?? []) out[s.kind].push(s);
    return out;
  }, [report]);
  const owners = new Map((prices?.prices ?? []).map((p) => [p.model, p]));
  const served = models?.data ?? [];
  return (
    <AppShell
      controls={
        <>
          <label className="font-ui text-sm">
            Day{" "}
            <input
              type="date"
              className={field}
              value={day}
              aria-label="Day"
              onChange={(e) => setDay(e.target.value || todayUtc())}
            />
          </label>
          <label className="font-ui text-sm">
            Month{" "}
            <input
              type="month"
              className={field}
              value={month}
              aria-label="Month"
              onChange={(e) => setMonth(e.target.value || todayUtc().slice(0, 7))}
            />
          </label>
        </>
      }
    >
      {/* The shell is h-dvh with overflow hidden, so the page owns its scroll. */}
      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4">
          <section className="section-panel flex flex-col gap-3" aria-labelledby="usage-heading">
            <h2 id="usage-heading" className="section-heading mb-0 text-base font-semibold">
              Usage
            </h2>
            <p className="text-sm text-[color:var(--muted)]">
              Tokens and spend on every gateway, for {day} and {month} (UTC). Set allowances on a
              key under Connect apps and on a group under People.
            </p>
            {failure && (
              <p role="alert" className="status-error text-sm">
                Usage could not be read: {failure}
              </p>
            )}
            {report &&
              (["key", "group", "person"] as const).map(
                (kind) =>
                  grouped[kind].length > 0 && (
                    <div key={kind} className="flex flex-col gap-2">
                      <h3 className="text-sm font-semibold">{KIND_HEADINGS[kind]}</h3>
                      {grouped[kind].map((s) => (
                        <Subject key={`${s.kind}-${s.id}`} subject={s} />
                      ))}
                    </div>
                  ),
              )}
            {report && report.subjects.length === 0 && (
              <p className="text-sm">No keys, people or groups yet.</p>
            )}
          </section>
          <section className="section-panel flex flex-col gap-2" aria-labelledby="prices-heading">
            <h2 id="prices-heading" className="section-heading mb-0 text-base font-semibold">
              Prices
            </h2>
            <p className="text-sm text-[color:var(--muted)]">
              Your rate for a model wins over its provider&rsquo;s price, from the next request. A
              request answered under another name that has no price is counted at the model it asked
              for. Eugene keeps no price list of its own and does not guess what a local model costs
              you in power or hardware: set a rate to count it.
            </p>
            <ul className="divide-y divide-[color:var(--border)]">
              {served.map((m) => (
                <PriceRow
                  key={`${m.id}-${owners.get(m.id)?.inputPerMillionMicros ?? ""}-${owners.get(m.id)?.outputPerMillionMicros ?? ""}`}
                  model={m.id}
                  provider={m.x_eugene_plexus?.provider_price ?? null}
                  owner={owners.get(m.id) ?? null}
                  local={m.x_eugene_plexus?.locality === "local"}
                  onSave={async (price) => {
                    setPrices(
                      await api.put<ModelPriceList>("control", "/v1/usage/prices", {
                        model: m.id,
                        price,
                      }),
                    );
                  }}
                />
              ))}
              {[...owners.values()]
                .filter((p) => !served.some((m) => m.id === p.model))
                .map((p) => (
                  <li key={p.model} className="py-2 text-sm">
                    <span className="font-mono">{p.model}</span>: your rate $
                    {microsToDollars(p.inputPerMillionMicros)} in, $
                    {microsToDollars(p.outputPerMillionMicros)} out (not served now)
                  </li>
                ))}
            </ul>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
