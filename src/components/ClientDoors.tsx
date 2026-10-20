"use client";

import { useCallback, useEffect, useId, useState } from "react";

import { ConfirmButton } from "@/components/ConfirmButton";
import { api, describeError } from "@/lib/api";
import { certificateLine, namesChanged, parseNames, NAMES_HELP } from "@/lib/connectTls";
import { doorLine, plainSwitch, stateLine, PLAIN_WINDOW, type ClientTls } from "@/lib/clientDoors";
import { useTargetNode, type TargetNode } from "@/lib/nodeBudget";
import { usePolling } from "@/lib/usePolling";

interface Reading {
  tls: ClientTls | null;
  /** Why this machine could not be read, when it could not. */
  error: string | null;
}

/**
 * Encrypted connections (LT2, `docs/design/tls-for-clients.md` §5-§7).
 *
 * Every machine's client doors, read through the agent's browser proxy
 * (`node:<name>`, the same way Hosts reads each machine), so the operator
 * never opens another machine's console. Below them, the switch for plain
 * HTTP: control's `clientPlainHttp`.
 */
export function ClientDoors() {
  const { nodes, loaded } = useTargetNode();
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [plain, setPlain] = useState<"on" | "off" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [otherNames, setOtherNames] = useState<Record<string, string[]>>({});

  const key = (node: TargetNode) => node.name ?? "this machine";

  const load = useCallback(async () => {
    if (!loaded) return;
    const entries = await Promise.all(
      nodes.map(async (node): Promise<[string, Reading]> => {
        try {
          const identity = await api.get<{ clientTls?: ClientTls }>(node.target, "/v1/node");
          return [key(node), { tls: identity.clientTls ?? null, error: null }];
        } catch (err) {
          return [key(node), { tls: null, error: describeError(err) }];
        }
      }),
    );
    setReadings(Object.fromEntries(entries));
    try {
      const list = await api.get<{ nodes?: { name: string; certificateNames?: string[] }[] }>(
        "control",
        "/v1/nodes",
      );
      setOtherNames(
        Object.fromEntries((list.nodes ?? []).map((n) => [n.name, n.certificateNames ?? []])),
      );
    } catch {
      setOtherNames({});
    }
    try {
      const config = await api.get<{ clientPlainHttp?: "on" | "off" }>("control", "/v1/config");
      setPlain(config.clientPlainHttp ?? "on");
    } catch {
      setPlain(null);
    }
  }, [nodes, loaded]);
  usePolling(load, 30000, loaded);

  useEffect(() => {
    setError(null);
  }, [plain]);

  async function setSwitch(value: "on" | "off") {
    setBusy(true);
    setError(null);
    try {
      await api.patch("control", "/v1/config", { clientPlainHttp: value });
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const rows = nodes.map((node) => ({ node, reading: readings[key(node)] }));
  const read = rows.filter((r) => r.reading?.tls);
  const unknown = rows.filter((r) => r.reading && !r.reading.tls).length;
  const gate = plainSwitch(read.map((r) => r.reading!.tls));
  const canTurnOff = gate.canTurnOff && unknown === 0 && read.length > 0;

  return (
    <section
      className="mx-auto w-full max-w-3xl px-6 pb-8"
      aria-label="Encrypted connections"
      data-testid="client-doors"
    >
      <h2 className="font-ui text-lg font-semibold">Encrypted connections</h2>
      <div className="mt-3 space-y-3">
        {rows.map(({ node, reading }) => {
          const tls = reading?.tls ?? null;
          const state = reading ? (reading.error ?? stateLine(tls)) : "Reading…";
          return (
            <div key={key(node)} className="section-panel" data-testid="client-doors-machine">
              <h3 className="font-ui text-base font-semibold">{node.label}</h3>
              {state && <p className="mt-1 text-sm">{state}</p>}
              {tls && tls.doors.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {tls.doors.map((door) => (
                    <li key={door.name}>{doorLine(door)}</li>
                  ))}
                </ul>
              )}
              {certificateLine(tls) && (
                <p
                  className="mt-2 text-sm text-[color:var(--muted)]"
                  data-testid="certificate-line"
                >
                  {certificateLine(tls)}
                </p>
              )}
              {node.name !== null && otherNames[node.name] !== undefined && (
                <OtherNames machine={node.name} saved={otherNames[node.name]!} onSaved={load} />
              )}
            </div>
          );
        })}
      </div>

      {plain !== null && (
        <div className="section-panel mt-4" data-testid="plain-http-switch">
          <p className="font-ui text-sm font-semibold">
            Plain HTTP from other machines: {plain === "on" ? "On" : "Off"}
          </p>
          {plain === "on" ? (
            <>
              <div className="mt-2">
                <ConfirmButton
                  label="Turn off plain HTTP"
                  confirmLabel="Turn off"
                  cancelLabel="Keep it on"
                  prompt="Devices that don't trust Eugene's certificate authority will lose access."
                  disabled={!canTurnOff || busy}
                  onConfirm={() => setSwitch("off")}
                  className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
                  testId="plain-off"
                />
              </div>
              {!canTurnOff && (
                <p className="mt-2 text-sm text-[color:var(--muted)]" data-testid="plain-used-by">
                  {unknown > 0
                    ? "Not every machine has answered yet."
                    : gate.usedBy.length > 0
                      ? `Used in the last ${PLAIN_WINDOW} by ${gate.usedBy.join(", ")}.`
                      : `Used in the last ${PLAIN_WINDOW}.`}
                </p>
              )}
            </>
          ) : (
            <div className="mt-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void setSwitch("on")}
                className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm"
                data-testid="plain-on"
              >
                Turn plain HTTP back on
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-status-error mt-2 text-sm">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** Names a machine is also reached by, kept by the control root. */
function OtherNames({
  machine,
  saved,
  onSaved,
}: {
  machine: string;
  saved: string[];
  onSaved: () => Promise<void>;
}) {
  const [text, setText] = useState(saved.join(", "));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  // Follow the root until the person starts typing.
  useEffect(() => {
    if (!touched) setText(saved.join(", "));
  }, [saved, touched]);

  const parsed = parseNames(text);
  const changed = namesChanged(text, saved);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (parsed.invalid.length > 0) {
      setError(`${parsed.invalid.join(", ")} is not a name.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.put("control", `/v1/nodes/${encodeURIComponent(machine)}/certificate-names`, {
        names: parsed.names,
      });
      setTouched(false);
      await onSaved();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-3" data-testid="other-names">
      <label htmlFor={id} className="font-ui text-sm font-semibold">
        Other names
      </label>
      <div className="mt-1 flex flex-wrap gap-2">
        <input
          id={id}
          value={text}
          onChange={(e) => {
            setTouched(true);
            setText(e.target.value);
          }}
          placeholder="box.local, eugene.lan"
          className="min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !changed}
          className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Save
        </button>
      </div>
      <p className="mt-1 text-sm text-[color:var(--muted)]">{NAMES_HELP}</p>
      {error && (
        <p role="alert" className="text-status-error mt-1 text-sm" data-testid="other-names-error">
          {error}
        </p>
      )}
    </form>
  );
}
