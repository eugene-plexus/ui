import type { CaFingerprints } from "@/lib/caFingerprint";

/** The install CA's two fingerprints, selectable for comparing by eye. */
export function CaFingerprintLines({ fingerprints }: { fingerprints: CaFingerprints }) {
  return (
    <dl className="text-sm">
      <div>
        <dt className="inline">Certificate authority fingerprint (SHA-256): </dt>
        <dd className="inline font-mono text-xs break-all" data-testid="ca-sha256">
          {fingerprints.sha256}
        </dd>
      </div>
      <div className="mt-1">
        <dt className="inline">Windows thumbprint: </dt>
        <dd className="inline font-mono text-xs break-all" data-testid="ca-thumbprint">
          {fingerprints.thumbprint}
        </dd>
      </div>
    </dl>
  );
}
