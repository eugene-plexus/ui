import { createHash, webcrypto } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  fingerprintsOf,
  formatSha256,
  formatThumbprint,
  loadCaFingerprints,
  localhostTrustUrl,
  pemToDer,
} from "./caFingerprint";

const BYTES = Uint8Array.from([1, 2, 3, 250, 255, 0, 16]);
const PEM = `-----BEGIN CERTIFICATE-----\n${Buffer.from(BYTES).toString("base64")}\n-----END CERTIFICATE-----\n`;

describe("pemToDer", () => {
  it("decodes the body between the lines", () => {
    expect(Array.from(pemToDer(PEM)!)).toEqual(Array.from(BYTES));
  });
  it("ignores wrapping whitespace and returns null for junk", () => {
    const body = Buffer.from(BYTES)
      .toString("base64")
      .replace(/(.{4})/g, "$1\n");
    const wrapped = `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
    expect(pemToDer("nothing here")).toBeNull();
    expect(pemToDer("-----BEGIN CERTIFICATE-----\n!!!\n-----END CERTIFICATE-----")).toBeNull();
    expect(pemToDer(wrapped)).not.toBeNull();
  });
});

describe("formats", () => {
  it("separates SHA-256 pairs with colons, uppercase", () => {
    expect(formatSha256(Uint8Array.from([0, 171, 255]))).toBe("00:AB:FF");
  });
  it("runs the thumbprint together", () => {
    expect(formatThumbprint(Uint8Array.from([0, 171, 255]))).toBe("00ABFF");
  });
});

describe("fingerprintsOf", () => {
  it("matches an independent digest", async () => {
    const result = await fingerprintsOf(PEM, webcrypto.subtle as SubtleCrypto);
    const sha256 = createHash("sha256").update(BYTES).digest();
    const sha1 = createHash("sha1").update(BYTES).digest("hex").toUpperCase();
    expect(result).toEqual({ sha256: formatSha256(sha256), thumbprint: sha1 });
    expect(result!.thumbprint).toHaveLength(40);
  });
  it("is null without crypto.subtle or with a bad PEM", async () => {
    expect(await fingerprintsOf(PEM, null)).toBeNull();
    expect(await fingerprintsOf("junk", webcrypto.subtle as SubtleCrypto)).toBeNull();
  });
});

describe("loadCaFingerprints", () => {
  it("is null when the node has no CA", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 404, text: async () => "" });
    expect(await loadCaFingerprints(fetchFn)).toBeNull();
  });
  it("fingerprints a served CA", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 200, text: async () => PEM });
    expect((await loadCaFingerprints(fetchFn))?.thumbprint).toHaveLength(40);
  });
});

describe("localhostTrustUrl", () => {
  it("uses the page's own port", () => {
    expect(localhostTrustUrl("8079")).toBe("http://localhost:8079/trust");
    expect(localhostTrustUrl("")).toBe("http://localhost:80/trust");
  });
});
