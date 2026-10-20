"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { httpsTarget, runProbe } from "@/lib/tlsProbe";

/**
 * A console page opened over http:// moves itself to https:// when this
 * device trusts the install CA, and otherwise says so in one line with the
 * way to fix it (`specs/docs/design/tls-for-clients.md` §6). Runs once per
 * mount. Loopback and https pages do nothing; a node with no CA says nothing.
 *
 * `floating` pins the line to the top of a page that has no banner row (the
 * sign-in page, which centres its card).
 */
export function TlsProbe({ floating = false }: { floating?: boolean }) {
  const [offer, setOffer] = useState(false);

  useEffect(() => {
    let live = true;
    void runProbe(window.location).then((action) => {
      if (!live) return;
      if (action === "move") window.location.replace(httpsTarget(window.location));
      else setOffer(action === "offer-trust");
    });
    return () => {
      live = false;
    };
  }, []);

  if (!offer) return null;
  return (
    <div
      role="status"
      data-testid="tls-banner"
      className={`status-warn border-b px-4 py-2 text-sm ${
        floating ? "fixed inset-x-0 top-0 z-20" : ""
      }`}
    >
      This connection isn&apos;t encrypted.{" "}
      <Link href="/trust" className="underline">
        Trust Eugene on this device
      </Link>
    </div>
  );
}
