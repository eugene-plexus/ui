"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api, describeError, getStream } from "@/lib/api";
import {
  downloadName,
  downloadText,
  keepNewest,
  type LogFilters,
  logsQuery,
  looksLikeTrouble,
  type MachineLine,
  mergeByTime,
  parseSse,
  TAILS,
  timeOf,
} from "@/lib/logs";
import type { TargetNode } from "@/lib/nodeBudget";
import type { LogLine, LogPage } from "@/lib/types";

/**
 * Every machine's log, or one machine's: the Logs page's body
 * (2026-09-27). History from `GET /v1/logs`, then a follow on
 * `GET /v1/logs/stream`, per machine, through each one's own proxy target.
 */

interface MachineState {
  lines: MachineLine[];
  sources: string[];
  truncated: boolean;
  error: string | null;
  dropped: number;
}

const EMPTY: MachineState = { lines: [], sources: [], truncated: false, error: null, dropped: 0 };

function keyOf(line: LogLine): string {
  return `${line.time ?? ""}|${line.source}|${line.text}`;
}

export function LogsView({
  machines,
  loaded,
  everyMachine,
  initialSource,
}: {
  machines: TargetNode[];
  loaded: boolean;
  everyMachine: boolean;
  initialSource: string | null;
}) {
  const [filters, setFilters] = useState<LogFilters>({
    sources: initialSource ? [initialSource] : [],
    contains: "",
    tail: TAILS[0],
  });
  const [typed, setTyped] = useState("");
  const [follow, setFollow] = useState(true);
  const [state, setState] = useState<Record<string, MachineState>>({});
  const scroller = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const targets = machines.map((m) => m.target).join("\n");

  // The text filter asks the agents, so it waits for typing to pause.
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => ({ ...f, contains: typed })), 400);
    return () => clearTimeout(timer);
  }, [typed]);

  // History, and then the follow, per machine. The follow opens first
  // and buffers, so a line written while the history is on its way is
  // neither lost nor shown twice.
  useEffect(() => {
    if (!loaded) return;
    const controllers: AbortController[] = [];
    let cancelled = false;
    setState({});
    for (const machine of machines) {
      const label = machine.label;
      const early: MachineLine[] = [];
      let historyIn = false;
      const add = (incoming: MachineLine[]) =>
        setState((prev) => {
          const now = prev[machine.target] ?? EMPTY;
          return {
            ...prev,
            [machine.target]: { ...now, lines: keepNewest([...now.lines, ...incoming]) },
          };
        });

      if (follow) {
        const controller = new AbortController();
        controllers.push(controller);
        void (async () => {
          try {
            const response = await getStream(
              machine.target,
              `/v1/logs/stream${logsQuery(filters, false)}`,
              { signal: controller.signal },
            );
            const reader = response.body?.getReader();
            if (!reader) return;
            const decoder = new TextDecoder();
            let buffer = "";
            for (;;) {
              const { done, value } = await reader.read();
              if (done || cancelled) break;
              buffer += decoder.decode(value, { stream: true });
              const parsed = parseSse(buffer);
              buffer = parsed.rest;
              const fresh: MachineLine[] = [];
              for (const event of parsed.events) {
                if (event.event === "line") {
                  fresh.push({ ...(JSON.parse(event.data) as LogLine), machine: label });
                } else if (event.event === "dropped") {
                  const dropped = (JSON.parse(event.data) as { dropped: number }).dropped;
                  setState((prev) => ({
                    ...prev,
                    [machine.target]: { ...(prev[machine.target] ?? EMPTY), dropped },
                  }));
                }
              }
              if (fresh.length === 0) continue;
              if (historyIn) add(fresh);
              else early.push(...fresh);
            }
          } catch (err) {
            if (cancelled || controller.signal.aborted) return;
            if (err instanceof ApiError && err.status === 401) return;
            setState((prev) => ({
              ...prev,
              [machine.target]: {
                ...(prev[machine.target] ?? EMPTY),
                error: `stopped following: ${describeError(err)}`,
              },
            }));
          }
        })();
      }

      void api
        .get<LogPage>(machine.target, `/v1/logs${logsQuery(filters)}`)
        .then((page) => {
          if (cancelled) return;
          const history = page.lines.map((l) => ({ ...l, machine: label }));
          const seen = new Set(history.slice(-500).map(keyOf));
          const after = early.filter((l) => !seen.has(keyOf(l)));
          historyIn = true;
          setState((prev) => ({
            ...prev,
            [machine.target]: {
              ...(prev[machine.target] ?? EMPTY),
              lines: keepNewest([...history, ...after]),
              sources: page.sources,
              truncated: page.truncated,
              error: null,
            },
          }));
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (err instanceof ApiError && err.status === 401) return;
          historyIn = true;
          setState((prev) => ({
            ...prev,
            [machine.target]: { ...(prev[machine.target] ?? EMPTY), error: describeError(err) },
          }));
        });
    }
    return () => {
      cancelled = true;
      for (const c of controllers) c.abort();
    };
    // `machines` is compared by its targets: the picker hands out a new
    // array on every read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, targets, filters, follow]);

  const lines = useMemo(
    () =>
      everyMachine
        ? mergeByTime(machines.map((m) => state[m.target]?.lines ?? []))
        : (state[machines[0]?.target ?? ""]?.lines ?? []),
    [everyMachine, machines, state],
  );
  const sources = useMemo(() => {
    const all = new Set<string>(filters.sources);
    for (const m of machines) for (const s of state[m.target]?.sources ?? []) all.add(s);
    return [...all].sort();
  }, [machines, state, filters.sources]);

  // Stay at the newest line while the reader is there; leave them alone
  // once they scroll up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  function download() {
    const scope = everyMachine ? "install" : (machines[0]?.label ?? "machine");
    const blob = new Blob([downloadText(lines, everyMachine)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName(scope);
    a.click();
    URL.revokeObjectURL(url);
  }

  const title = everyMachine ? "Logs" : `Logs on ${machines[0]?.label ?? "this machine"}`;
  const troubled = machines.filter((m) => state[m.target]?.error);
  const truncated = machines.some((m) => state[m.target]?.truncated);
  const dropped = machines.reduce((n, m) => n + (state[m.target]?.dropped ?? 0), 0);

  return (
    <main className="flex min-h-0 flex-1 flex-col px-5 py-4" data-testid="logs-view">
      <header className="mb-3">
        <h2 className="font-ui text-sm font-semibold">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-[color:var(--muted)]">
          {everyMachine
            ? "Every machine's log on one timeline: each agent, and every model and service it runs."
            : "This machine's log: its agent, and every model and service it runs."}{" "}
          Times are this browser&rsquo;s clock. Keys and tokens are hidden.
        </p>
      </header>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          <span className="text-[color:var(--muted)]">Source</span>
          <select
            value={filters.sources[0] ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, sources: e.target.value ? [e.target.value] : [] }))
            }
            className={selectClass}
            data-testid="logs-source"
          >
            <option value="">All</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Only lines containing…"
          aria-label="Only lines containing"
          className={`${selectClass} w-56`}
          data-testid="logs-filter"
        />
        <label className="flex items-center gap-1">
          <span className="text-[color:var(--muted)]">Last</span>
          <select
            value={filters.tail}
            onChange={(e) => setFilters((f) => ({ ...f, tail: Number(e.target.value) }))}
            className={selectClass}
            aria-label="How many lines"
          >
            {TAILS.map((t) => (
              <option key={t} value={t}>
                {t.toLocaleString()} lines
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
            data-testid="logs-follow"
          />
          <span>Follow</span>
        </label>
        <button
          type="button"
          onClick={download}
          disabled={lines.length === 0}
          className={buttonClass}
          data-testid="logs-download"
        >
          Download
        </button>
      </div>

      {troubled.map((m) => (
        <p
          key={m.target}
          className="status-error mb-2 rounded-[var(--radius)] border px-3 py-2 text-sm"
          data-testid="logs-unanswered"
        >
          <strong>{m.label}</strong>: {state[m.target]?.error}
        </p>
      ))}
      {(truncated || dropped > 0) && (
        <p className="mb-2 text-sm text-[color:var(--muted)]" data-testid="logs-more">
          {truncated && "Older lines exist; show more with Last. "}
          {dropped > 0 &&
            `${dropped.toLocaleString()} lines were written faster than this page could show them.`}
        </p>
      )}

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-y-auto rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-1"
      >
        {lines.length === 0 ? (
          <p className="py-2 text-sm text-[color:var(--muted)]">
            {!loaded || machines.some((m) => !(m.target in state))
              ? "Reading…"
              : "Nothing matches yet."}
          </p>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              data-testid="log-line"
              className="font-mono text-xs leading-5 break-all whitespace-pre-wrap"
              style={looksLikeTrouble(line.text) ? { color: "var(--status-error-fg)" } : undefined}
            >
              <span className="text-[color:var(--muted)]" title={line.time ?? "no time recorded"}>
                {timeOf(line.time) || "—"}
              </span>{" "}
              {everyMachine && (
                <span className="text-[color:var(--accent-left)]">{line.machine} </span>
              )}
              <span className="text-[color:var(--muted)]">[{line.source}]</span> {line.text}
            </div>
          ))
        )}
      </div>
    </main>
  );
}

const selectClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-1 text-sm";
const buttonClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";
