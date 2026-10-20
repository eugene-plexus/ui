/**
 * Fingerprints of the install CA, shown where a man in the middle of a plain
 * http:// download cannot change them (LT2 review). Computed in the browser
 * from the PEM; `crypto.subtle` exists only in a secure context, so the
 * helper answers null without it.
 */

/** The DER bytes inside the first PEM block, or null when there is none. */
export function pemToDer(pem: string): Uint8Array | null {
  const match = /-----BEGIN [A-Z ]+-----([\s\S]*?)-----END [A-Z ]+-----/.exec(pem);
  if (!match) return null;
  const body = match[1]!.replace(/\s+/g, "");
  if (!body) return null;
  try {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function hex(bytes: Uint8Array): string[] {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase());
}

/** `AA:BB:...` as most tools show a SHA-256 fingerprint. */
export function formatSha256(bytes: Uint8Array): string {
  return hex(bytes).join(":");
}

/** 40 uppercase hex characters, no separators: Windows' "Thumbprint". */
export function formatThumbprint(bytes: Uint8Array): string {
  return hex(bytes).join("");
}

export interface CaFingerprints {
  sha256: string;
  thumbprint: string;
}

export async function fingerprintsOf(
  pem: string,
  subtle: SubtleCrypto | null | undefined = typeof crypto === "undefined" ? null : crypto.subtle,
): Promise<CaFingerprints | null> {
  if (!subtle) return null;
  const der = pemToDer(pem);
  if (!der) return null;
  const data = der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer;
  const [sha256, sha1] = await Promise.all([
    subtle.digest("SHA-256", data),
    subtle.digest("SHA-1", data),
  ]);
  return {
    sha256: formatSha256(new Uint8Array(sha256)),
    thumbprint: formatThumbprint(new Uint8Array(sha1)),
  };
}

/** Fetches the CA from this node and fingerprints it; null when either cannot be done. */
export async function loadCaFingerprints(
  fetchFn: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<CaFingerprints | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  try {
    const response = await fetchFn("/v1/trust/ca", { cache: "no-store" });
    if (response.status !== 200) return null;
    return await fingerprintsOf(await response.text());
  } catch {
    return null;
  }
}

/** Where to read the fingerprint when this page cannot compute it. */
export function localhostTrustUrl(port: string): string {
  return `http://localhost:${port || "80"}/trust`;
}
