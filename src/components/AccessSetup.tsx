"use client";

import { useEffect, useRef, useState } from "react";
import { api, describeError } from "@/lib/api";
import type { components } from "@/generated/agent";

type Preview = components["schemas"]["EntryPointPreview"];
type Status = components["schemas"]["EntryPointStatus"];
type Mode = "proxy" | "automatic" | "local" | "certificate";
const inputClass =
  "mt-1 w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-2";
const hintClass = "mt-1 block text-sm text-[color:var(--muted)]";
const networks = (value: string) => value.split(/[\s,]+/).filter(Boolean);
const PUBLIC = ["0.0.0.0/0", "::/0"];

/** The form's fields, read back from the configuration in effect. */
interface Fields {
  mode: Mode;
  domain: string;
  port: string;
  privateNetworks: string;
  publicWorkbench: boolean;
  inference: boolean;
  nodes: boolean;
  proxies: string;
  proxyTls: boolean;
  email: string;
  certificate: string;
  key: string;
  ca: string;
}

const EMPTY: Fields = {
  mode: "proxy",
  domain: "",
  port: "443",
  privateNetworks: "",
  publicWorkbench: false,
  // Two names by default (2026-10-05): the console and Workbench. Inference
  // and node names are for setups that need them, each a DNS entry, a proxy
  // host and a certificate more.
  inference: false,
  nodes: false,
  proxies: "",
  proxyTls: false,
  email: "",
  certificate: "/data/certificates/fullchain.pem",
  key: "/data/certificates/privkey.pem",
  ca: "",
};

type Service = { origin?: string; networks?: string[] };

/** The fields that produce `configuration`, or null when it is not one this page makes. */
export function fieldsFrom(configuration: Record<string, unknown> | undefined): Fields | null {
  const console_ = configuration?.console as Service | undefined;
  if (!console_?.origin) return null;
  let url: URL;
  try {
    url = new URL(console_.origin);
  } catch {
    return null;
  }
  const [first, ...rest] = url.hostname.split(".");
  if (first !== "eugene" || rest.length === 0) return null;
  const proxy = configuration?.proxy as { addresses?: string[]; transport?: string } | undefined;
  const acme = configuration?.acme as { email?: string } | undefined;
  const workbench = configuration?.workbench as Service | undefined;
  const mode: Mode = proxy
    ? "proxy"
    : acme
      ? "automatic"
      : configuration?.internal_ca
        ? "local"
        : "certificate";
  return {
    ...EMPTY,
    mode,
    domain: rest.join("."),
    port: url.port || "443",
    privateNetworks: (console_.networks ?? []).join(", "),
    publicWorkbench: PUBLIC.every((n) => workbench?.networks?.includes(n)),
    inference: Boolean(configuration?.inference),
    nodes: Boolean(configuration?.nodes),
    proxies: (proxy?.addresses ?? []).join(", "),
    proxyTls: proxy?.transport === "https",
    email: acme?.email ?? "",
    certificate: String(configuration?.certificate ?? EMPTY.certificate),
    key: String(configuration?.private_key ?? EMPTY.key),
    ca: String(configuration?.trusted_ca ?? ""),
  };
}

function when(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function StatusCard({ status }: { status: Status }) {
  if (status.active) {
    return (
      <section
        className="status-success mt-4 rounded-[var(--radius)] px-4 py-3"
        aria-label="In effect"
      >
        <p>
          One HTTPS port is on. The console is at{" "}
          <a className="underline" href={status.publicUrls?.consoleUrl}>
            {status.publicUrls?.consoleUrl}
          </a>
          .
        </p>
        {status.confirmBy && (
          <p className="mt-1">
            Waiting for you to sign in through it. If nobody does by {when(status.confirmBy)},
            Eugene goes back to how it was before.
          </p>
        )}
      </section>
    );
  }
  const reason = status.reverted ?? status.fallback;
  return (
    <section
      className={`${reason ? "status-warn" : "status-success"} mt-4 rounded-[var(--radius)] px-4 py-3`}
      aria-label="In effect"
    >
      <p>Eugene is answering on its direct ports.</p>
      {status.reverted ? (
        <p className="mt-1">The last setup went back: {status.reverted}</p>
      ) : status.fallback ? (
        <p className="mt-1">{status.fallback}</p>
      ) : null}
      {!status.available && status.unavailableReason && (
        <p className="mt-1">{status.unavailableReason}</p>
      )}
    </section>
  );
}

export function AccessSetup() {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [status, setStatus] = useState<Status | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"apply" | "off" | null>(null);
  const [restarting, setRestarting] = useState<Status | null>(null);
  const [terms, setTerms] = useState(false);
  const [staging, setStaging] = useState(false);
  const generation = useRef(0);
  const {
    mode,
    domain,
    port,
    privateNetworks,
    publicWorkbench,
    inference,
    nodes,
    proxies,
    proxyTls,
    email,
    certificate,
    key,
    ca,
  } = fields;

  useEffect(() => {
    let live = true;
    api
      .get<Status>("agent", "/v1/entrypoint")
      .then((found) => {
        if (!live) return;
        setStatus(found);
        const from = fieldsFrom(found.configuration as Record<string, unknown> | undefined);
        if (from) setFields(from);
      })
      .catch(() => {
        // An older agent has no status: the page still prepares a file.
      });
    return () => {
      live = false;
    };
  }, []);

  function set<K extends keyof Fields>(name: K, value: Fields[K]) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  function invalidate() {
    generation.current += 1;
    setPreview(null);
    setError(null);
    setConfirming(null);
  }

  async function validate(event: React.FormEvent) {
    event.preventDefault();
    const current = ++generation.current;
    setBusy(true);
    setError(null);
    setPreview(null);
    const base = domain.trim().toLowerCase();
    const suffix = Number(port) === 443 ? "" : `:${port}`;
    const service = (name: string, access: string[]) => ({
      origin: `https://${name}.${base}${suffix}`,
      networks: access,
    });
    const privateAccess = networks(privateNetworks);
    const configuration = {
      listen_port: mode === "proxy" && !proxyTls ? 8088 : 8443,
      console: service("eugene", privateAccess),
      workbench: service("workbench", publicWorkbench ? PUBLIC : privateAccess),
      ...(inference ? { inference: service("inference", privateAccess) } : {}),
      ...(nodes ? { nodes: service("nodes", privateAccess) } : {}),
      ...(mode === "local" ? { internal_ca: true } : {}),
      ...(mode === "automatic" ? { acme: { email, accept_terms: terms, staging } } : {}),
      ...(mode === "proxy"
        ? { proxy: { addresses: networks(proxies), transport: proxyTls ? "https" : "http" } }
        : {}),
      ...(mode === "certificate" || (mode === "proxy" && proxyTls)
        ? { certificate, private_key: key }
        : {}),
      ...((mode === "certificate" || mode === "proxy") && ca.trim()
        ? { trusted_ca: ca.trim() }
        : {}),
    };
    try {
      const result = await api.post<Preview>("agent", "/v1/entrypoint/preview", { configuration });
      if (current === generation.current) setPreview(result);
    } catch (err) {
      if (current === generation.current) setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await api.post<Status>("agent", "/v1/entrypoint/apply", {
        configuration: preview.configuration,
      });
      setRestarting(answer);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      setRestarting(await api.delete<Status>("agent", "/v1/entrypoint"));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  function download(name: string, body: string, type: string) {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (restarting) {
    const next = restarting.active ? restarting.publicUrls?.consoleUrl : null;
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <h1 className="font-ui text-2xl font-semibold">Container access setup</h1>
        <section className="section-panel mt-6" aria-label="Restarting">
          <h2 className="font-ui text-lg font-semibold">Eugene is restarting</h2>
          {next ? (
            <>
              <p className="mt-2">
                This page stops answering here. In a few seconds, open{" "}
                <a className="underline" href={next}>
                  {next}
                </a>{" "}
                and sign in.
              </p>
              {restarting.confirmBy && (
                <p className="mt-2">
                  If nobody signs in there by {when(restarting.confirmBy)}, Eugene goes back to how
                  it was, and this address works again.
                </p>
              )}
            </>
          ) : (
            <p className="mt-2">
              Eugene is going back to its direct ports. Open it at the address and port you used
              before one HTTPS port, once those ports are published again.
            </p>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="font-ui text-2xl font-semibold">Container access setup</h1>
      <p className="mt-2 text-[color:var(--muted)]">
        Serve the console and Workbench on one HTTPS port. Nothing changes until you apply it.
      </p>
      {status && <StatusCard status={status} />}
      {status?.active && (
        <div className="mt-3">
          {confirming === "off" ? (
            <div className="section-panel" role="group" aria-label="Turn off one HTTPS port">
              <p>
                Eugene restarts on its direct ports, and this address stops answering. Its
                configuration is kept, so you can apply it again later.
              </p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  className="rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-2 text-[color:var(--on-accent-left)] disabled:opacity-50"
                  disabled={busy}
                  onClick={turnOff}
                >
                  Go back to direct ports
                </button>
                <button type="button" className="underline" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="underline" onClick={() => setConfirming("off")}>
              Turn off one HTTPS port…
            </button>
          )}
        </div>
      )}
      <form onSubmit={validate} onChangeCapture={invalidate} className="mt-6 space-y-5">
        <label className="block">
          Who manages HTTPS?
          <select
            className={inputClass}
            value={mode}
            onChange={(e) => {
              set("mode", e.target.value as Mode);
              if (e.target.value === "automatic") set("port", "443");
            }}
          >
            <option value="proxy">My reverse proxy — Nginx Proxy Manager, Caddy or Traefik</option>
            <option value="automatic">Eugene — automatic Let’s Encrypt certificates</option>
            <option value="local">Eugene — local certificates for a private network</option>
            <option value="certificate">
              My organisation or certificate manager — supplied certificate files
            </option>
          </select>
        </label>
        {mode === "proxy" && (
          <p>
            Your existing proxy manages public certificates and forwards to Eugene. On the same
            Docker host, the two can share a Docker network and Eugene needs no published ports.
          </p>
        )}
        {mode === "automatic" && (
          <p>
            Use a domain you control and forward public TCP port 443 directly to Eugene. Port 80 is
            not needed. Behind CGNAT or without inbound access, use a reverse proxy or a certificate
            manager with DNS verification.
          </p>
        )}
        {mode === "local" && (
          <p>
            No public domain or Internet access is needed. Configure local DNS and trust Eugene’s
            public CA certificate on each browser and node.
          </p>
        )}
        {mode === "certificate" && (
          <p>
            Use certificates from your organisation or a manager that supports DNS verification.
            This also works on LANs and VPNs without public inbound ports. Renewed certificate files
            reload automatically.
          </p>
        )}
        <label className="block">
          Base domain
          <input
            className={inputClass}
            required
            placeholder={mode === "local" ? "home.arpa" : "example.com"}
            value={domain}
            onChange={(e) => set("domain", e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <span className={hintClass}>
            Eugene answers at eugene.{domain || "your-domain"} (the console) and workbench.
            {domain || "your-domain"}. Point both names at your proxy, or at Eugene.
          </span>
        </label>
        <label className="block">
          Public HTTPS port
          <input
            className={inputClass}
            type="number"
            min="1"
            max="65535"
            required
            value={port}
            disabled={mode === "automatic"}
            onChange={(e) => set("port", e.target.value)}
          />
          <span className={hintClass}>The port browsers use: 443 unless you chose another.</span>
        </label>
        <label className="block">
          Allowed private networks
          <input
            className={inputClass}
            required
            placeholder="192.168.16.0/24, 10.20.0.0/24"
            value={privateNetworks}
            onChange={(e) => set("privateNetworks", e.target.value)}
          />
          <span className={hintClass}>
            Where the people and machines that use the console are: your home or office network, or
            your VPN. Not your proxy’s Docker network. Through Cloudflare, every visitor looks like
            Cloudflare, so to reach the console from home, point its name at your proxy in your
            local DNS.
          </span>
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={publicWorkbench}
            onChange={(e) => set("publicWorkbench", e.target.checked)}
          />
          Allow Workbench access from any network, with sign-in and assigned permissions
        </label>
        <label className="flex items-start gap-2">
          <input
            className="mt-1.5"
            type="checkbox"
            checked={inference}
            onChange={(e) => set("inference", e.target.checked)}
          />
          <span>
            Also an inference name (inference.{domain || "your-domain"})
            <span className={hintClass}>
              For apps on other machines, such as Claude Code or Open WebUI, to use Eugene’s models
              through this port. Apps on this machine need nothing.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            className="mt-1.5"
            type="checkbox"
            checked={nodes}
            onChange={(e) => set("nodes", e.target.checked)}
          />
          <span>
            Also a name for other machines (nodes.{domain || "your-domain"})
            <span className={hintClass}>
              Off: machines you have connected keep reaching this one at its control port, with
              nothing to change on them. On: they use this name instead, and each one’s saved
              address must be changed to it.
            </span>
          </span>
        </label>
        {mode === "proxy" && (
          <>
            <label className="block">
              Trusted proxy IP addresses
              <input
                className={inputClass}
                required
                placeholder="172.18.0.4"
                value={proxies}
                onChange={(e) => set("proxies", e.target.value)}
              />
              <span className={hintClass}>
                Your proxy’s own address, as Eugene sees it, one address per proxy, not a network.
                When the proxy and Eugene share a Docker network, that is the proxy’s address on
                that network, not its LAN address. To list them:{" "}
                <code>
                  {
                    "docker network inspect <network> -f '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{\"\\n\"}}{{end}}'"
                  }
                </code>
                . Give the proxy a fixed address there, so it does not change.
              </span>
            </label>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={proxyTls}
                onChange={(e) => set("proxyTls", e.target.checked)}
              />
              Use HTTPS between my proxy and Eugene (for separate machines)
            </label>
          </>
        )}
        {mode === "automatic" && (
          <>
            <label className="block">
              Certificate contact email
              <input
                className={inputClass}
                required
                type="email"
                value={email}
                onChange={(e) => set("email", e.target.value)}
              />
            </label>
            <label className="flex gap-2">
              <input
                type="checkbox"
                required
                checked={terms}
                onChange={(e) => setTerms(e.target.checked)}
              />
              <span>
                I accept the{" "}
                <a
                  className="underline"
                  href="https://letsencrypt.org/repository/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Let’s Encrypt subscriber agreement
                </a>
                .
              </span>
            </label>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={staging}
                onChange={(e) => setStaging(e.target.checked)}
              />
              Test issuance with staging certificates (browsers will not trust them)
            </label>
          </>
        )}
        {(mode === "certificate" || (mode === "proxy" && proxyTls)) && (
          <>
            <label className="block">
              Certificate chain path inside Eugene’s container
              <input
                className={inputClass}
                required
                value={certificate}
                onChange={(e) => set("certificate", e.target.value)}
              />
            </label>
            <label className="block">
              Private key path inside Eugene’s container
              <input
                className={inputClass}
                required
                value={key}
                onChange={(e) => set("key", e.target.value)}
              />
            </label>
          </>
        )}
        {(mode === "certificate" || mode === "proxy") && (
          <label className="block">
            Private CA certificate path (optional)
            <input
              className={inputClass}
              value={ca}
              onChange={(e) => set("ca", e.target.value)}
              placeholder="/data/certificates/organisation-ca.pem"
            />
          </label>
        )}
        <button
          className="rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-2 text-[color:var(--on-accent-left)] disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          {busy && !preview ? "Checking configuration…" : "Prepare setup"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-4 text-[color:var(--status-error-fg)]">
          {error}
        </p>
      )}
      {preview && (
        <section className="section-panel mt-6" aria-label="Prepared setup">
          <h2 className="font-ui text-lg font-semibold">Your prepared setup</h2>
          <p className="mt-2">
            Eugene console: {preview.publicUrls.consoleUrl}
            <br />
            Workbench: {preview.publicUrls.workbenchUrl}
          </p>
          <ol className="mt-4 list-decimal space-y-3 pl-5">
            {preview.instructions.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {status?.available &&
            (confirming === "apply" ? (
              <div className="mt-5" role="group" aria-label="Apply this setup">
                <p>
                  Eugene saves this and restarts. This page stops answering here. Open{" "}
                  {preview.publicUrls.consoleUrl} and sign in within 15 minutes, or Eugene goes back
                  to how it was.
                </p>
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    className="rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-2 text-[color:var(--on-accent-left)] disabled:opacity-50"
                    disabled={busy}
                    onClick={apply}
                  >
                    {busy ? "Applying…" : "Apply and restart"}
                  </button>
                  <button type="button" className="underline" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="mt-5 rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-2 text-[color:var(--on-accent-left)]"
                onClick={() => setConfirming("apply")}
              >
                Apply…
              </button>
            ))}
          <div className="mt-5 flex flex-wrap gap-4">
            <button
              type="button"
              className="underline"
              onClick={() =>
                download(
                  "entrypoint.json",
                  JSON.stringify(preview.configuration, null, 2) + "\n",
                  "application/json",
                )
              }
            >
              Download configuration
            </button>
            <button
              type="button"
              className="underline"
              onClick={() =>
                download(
                  "eugene-access-setup.txt",
                  preview.instructions.map((step, i) => `${i + 1}. ${step}`).join("\n\n") + "\n",
                  "text/plain",
                )
              }
            >
              Download instructions
            </button>
          </div>
        </section>
      )}
      <p className="mt-6 text-sm">
        <a
          className="underline"
          href="https://github.com/eugene-plexus/specs/blob/main/docs/deployment/container-access.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          Reverse proxy examples, and going back by hand
        </a>
      </p>
    </main>
  );
}
