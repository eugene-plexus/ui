"use client";

import { useRef, useState } from "react";
import { api, describeError } from "@/lib/api";
import type { components } from "@/generated/agent";

type Preview = components["schemas"]["EntryPointPreview"];
type Mode = "proxy" | "automatic" | "local" | "certificate";
const inputClass =
  "mt-1 w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-2";
const networks = (value: string) => value.split(/[\s,]+/).filter(Boolean);

export function AccessSetup() {
  const [mode, setMode] = useState<Mode>("proxy");
  const [domain, setDomain] = useState("");
  const [port, setPort] = useState("443");
  const [privateNetworks, setPrivateNetworks] = useState("");
  const [publicWorkbench, setPublicWorkbench] = useState(false);
  const [inference, setInference] = useState(true);
  const [nodes, setNodes] = useState(true);
  const [proxies, setProxies] = useState("");
  const [proxyTls, setProxyTls] = useState(false);
  const [email, setEmail] = useState("");
  const [terms, setTerms] = useState(false);
  const [staging, setStaging] = useState(false);
  const [certificate, setCertificate] = useState("/data/certificates/fullchain.pem");
  const [key, setKey] = useState("/data/certificates/privkey.pem");
  const [ca, setCa] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  function invalidate() {
    generation.current += 1;
    setPreview(null);
    setError(null);
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
      workbench: service("workbench", publicWorkbench ? ["0.0.0.0/0", "::/0"] : privateAccess),
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

  function download(name: string, body: string, type: string) {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="font-ui text-2xl font-semibold">Container access setup</h1>
      <p className="mt-2 text-[color:var(--muted)]">
        Prepare one entry point for Eugene and Workbench. Your running installation stays available
        while you prepare the change.
      </p>
      <form onSubmit={validate} onChangeCapture={invalidate} className="mt-6 space-y-5">
        <label className="block">
          Who manages HTTPS?
          <select
            className={inputClass}
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as Mode);
              if (e.target.value === "automatic") setPort("443");
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
            Your existing proxy manages public certificates. On the same Docker host, Eugene can use
            a private network with no published ports.
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
            onChange={(e) => setDomain(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <span className="mt-1 block text-sm text-[color:var(--muted)]">
            Creates eugene, workbench, inference and nodes names under this domain. You will point
            the enabled names at your server or proxy.
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
            onChange={(e) => setPort(e.target.value)}
          />
        </label>
        <label className="block">
          Allowed private networks
          <input
            className={inputClass}
            required
            placeholder="192.168.16.0/24, 10.20.0.0/24"
            value={privateNetworks}
            onChange={(e) => setPrivateNetworks(e.target.value)}
          />
          <span className="mt-1 block text-sm text-[color:var(--muted)]">
            Your LAN, VPN or specific client ranges. Console, inference and node connections remain
            restricted to these networks.
          </span>
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={publicWorkbench}
            onChange={(e) => setPublicWorkbench(e.target.checked)}
          />
          Allow Workbench access from any network, with sign-in and assigned permissions
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={inference}
            onChange={(e) => setInference(e.target.checked)}
          />
          Enable the inference hostname
        </label>
        <label className="flex gap-2">
          <input type="checkbox" checked={nodes} onChange={(e) => setNodes(e.target.checked)} />
          Enable the node connection hostname
        </label>
        {mode === "proxy" && (
          <>
            <label className="block">
              Trusted proxy IP addresses
              <input
                className={inputClass}
                required
                placeholder="172.30.0.2"
                value={proxies}
                onChange={(e) => setProxies(e.target.value)}
              />
              <span className="mt-1 block text-sm text-[color:var(--muted)]">
                Fixed addresses as seen by Eugene, separated by commas. Trust only your proxy, not
                an entire LAN.
              </span>
            </label>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={proxyTls}
                onChange={(e) => setProxyTls(e.target.checked)}
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
                onChange={(e) => setEmail(e.target.value)}
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
                onChange={(e) => setCertificate(e.target.value)}
              />
            </label>
            <label className="block">
              Private key path inside Eugene’s container
              <input
                className={inputClass}
                required
                value={key}
                onChange={(e) => setKey(e.target.value)}
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
              onChange={(e) => setCa(e.target.value)}
              placeholder="/data/certificates/organisation-ca.pem"
            />
          </label>
        )}
        <button
          className="rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-2 text-[color:var(--on-accent-left)] disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          {busy ? "Checking configuration…" : "Prepare setup"}
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
          href="https://github.com/eugene-plexus/specs/blob/main/docs/deployment/container.md#one-https-port"
          target="_blank"
          rel="noopener noreferrer"
        >
          Migration, reverse proxy examples and rollback instructions
        </a>
      </p>
    </main>
  );
}
