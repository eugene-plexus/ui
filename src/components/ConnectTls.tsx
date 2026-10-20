"use client";

import Link from "next/link";

import { BUNDLE_HREF, showTrustSteps, type GatewayUrls, type TlsFacts } from "@/lib/connectTls";

/**
 * Under the address on Connect apps: the plain address while it is allowed,
 * and the one extra step each kind of client needs to trust Eugene's
 * certificate (`docs/design/tls-for-clients.md` §6). Nothing for an owner's
 * own certificate: devices trust it already.
 */
export function ConnectTls({ urls, tls }: { urls: GatewayUrls; tls: TlsFacts }) {
  if (tls?.state !== "issued") return null;
  return (
    <section className="section-panel" data-testid="connect-tls">
      <h2 className="font-ui text-base font-semibold">Encrypted address</h2>
      {urls.plain && (
        <p className="mt-1 text-sm text-[color:var(--muted)]" data-testid="connect-plain-url">
          Plain HTTP, still allowed: <code className="font-mono text-xs">{urls.plain}</code>
        </p>
      )}
      {showTrustSteps(tls) && (
        <ul className="mt-2 flex flex-col gap-1 text-sm" data-testid="connect-trust-steps">
          <li>
            <span className="font-semibold">Claude Code:</span> Nothing more once this device trusts
            Eugene.{" "}
            <Link href="/trust" className="underline">
              Trust Eugene on this device
            </Link>
          </li>
          <li>
            <span className="font-semibold">
              Python, the OpenAI SDK, LangChain and other Python clients:
            </span>{" "}
            Download the certificate bundle and point SSL_CERT_FILE at it.{" "}
            <a href={BUNDLE_HREF} download="eugene-plexus-ca-bundle.pem" className="underline">
              Download the bundle
            </a>
          </li>
          <li>
            <span className="font-semibold">Open WebUI installed from Eugene&apos;s apps:</span>{" "}
            Nothing: Eugene gives it the certificate.
          </li>
        </ul>
      )}
    </section>
  );
}
