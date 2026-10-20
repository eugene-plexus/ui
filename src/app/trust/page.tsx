"use client";

/**
 * Trust Eugene on this device (LT2, `docs/design/tls-for-clients.md` §6).
 *
 * Public: a fresh device opens this before it can sign in, so it renders
 * without the shell, calls nothing that needs a session (`/v1/trust/ca` is
 * public), and is listed in `ROUTES_WITHOUT_NAV` beside `/login`.
 */

import { useEffect, useState } from "react";

import { BUNDLE_HREF } from "@/lib/connectTls";
import { pageTitle, useDocumentTitle } from "@/lib/pageTitle";
import { caServed, httpsTarget, httpsTrusted } from "@/lib/tlsProbe";
import { TRUST_GUIDES, detectOs, orderedOs, type TrustOs } from "@/lib/trustSteps";

const link = "underline";

function Steps({ os, open }: { os: TrustOs; open: boolean }) {
  const guide = TRUST_GUIDES[os];
  return (
    <details open={open} className="section-panel" data-testid={`trust-${os}`}>
      <summary className="font-ui cursor-pointer text-base font-semibold">{guide.title}</summary>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {guide.note && <p className="mt-2 text-sm text-[color:var(--muted)]">{guide.note}</p>}
      {guide.firefox && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
          {guide.firefox.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
    </details>
  );
}

export default function TrustPage() {
  useDocumentTitle(pageTitle({ page: "Trust Eugene", node: null, machines: 1 }));
  const [available, setAvailable] = useState<boolean | null>(null);
  const [detected, setDetected] = useState<TrustOs | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let live = true;
    setDetected(detectOs(navigator.userAgent, navigator.platform, navigator.maxTouchPoints));
    void caServed().then((ok) => {
      if (live) setAvailable(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  async function openHttps() {
    setChecking(true);
    setMessage(null);
    const trusted = await httpsTrusted(window.location.host);
    setChecking(false);
    if (trusted) {
      window.location.replace(
        httpsTarget({ ...window.location, pathname: "/", search: "", hash: "" }),
      );
    } else {
      setMessage("Not trusted yet. Restart the browser after installing, then try again.");
    }
  }

  return (
    <main className="relative z-10 mx-auto max-w-2xl px-6 py-10">
      <h1 className="font-ui text-xl font-semibold">Trust Eugene on this device</h1>
      <p className="mt-3 text-sm leading-relaxed text-[color:var(--muted)]">
        Eugene&apos;s certificate authority vouches only for addresses on your own network and
        .local names, so it can&apos;t be used to impersonate other sites.
      </p>

      {available === false && (
        <p className="mt-6 text-sm" data-testid="trust-none">
          This machine has no certificate from the install yet.
        </p>
      )}

      {available === true && (
        <>
          <p className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <a
              className={link}
              href="/v1/trust/ca?format=der"
              download="eugene-plexus-ca.cer"
              data-testid="trust-download-der"
            >
              Download for Windows, iPhone, iPad and Android
            </a>
            <a className={link} href="/v1/trust/ca" download="eugene-plexus-ca.pem">
              Download as PEM
            </a>
          </p>

          <p className="mt-4 text-sm" data-testid="trust-python">
            Python clients: download the{" "}
            <a className={link} href={BUNDLE_HREF} download="eugene-plexus-ca-bundle.pem">
              certificate bundle
            </a>{" "}
            and set SSL_CERT_FILE to it.
          </p>

          <div className="mt-6 space-y-3">
            {orderedOs(detected).map((os) => (
              <Steps key={os} os={os} open={os === (detected ?? "windows")} />
            ))}
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={() => void openHttps()}
              disabled={checking}
              className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm"
            >
              Open over HTTPS
            </button>
            {message && (
              <p role="status" className="mt-2 text-sm" data-testid="trust-message">
                {message}
              </p>
            )}
          </div>
        </>
      )}
    </main>
  );
}
