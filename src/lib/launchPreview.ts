/**
 * What Launch will do, said before the button is pressed (M11).
 *
 * The agent's admission dry run answers two questions about a launch on
 * one node: is the model there at all, and will it fit. Until M11 only
 * the second was asked, and the first was asked by nobody -- a model the
 * library described by ITS path was accepted on a node that did not
 * have it, given a companion driver, and crashed at spawn. Now the dry
 * run resolves the path through the node's mappings and reports the
 * result as `location`, and this module turns that into the sentence
 * the launch panel shows.
 *
 * Pure, so the composition is testable against the agent's real answer
 * shapes rather than against a rendered tree.
 */

import type { Admission } from "./types";

export type PreviewTone = "ok" | "warn" | "error";

export interface LaunchPreview {
  tone: PreviewTone;
  /** One line: what will happen. */
  headline: string;
  /** The specifics, or null when the headline is the whole story. */
  detail: string | null;
  /** The config tab that fixes a missing mapping, when that is the problem. */
  fixTarget: string | null;
}

function gib(bytes: number | null | undefined): string | null {
  if (bytes == null) return null;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

/**
 * The launch panel's verdict for `admission`, computed for `nodeLabel`.
 *
 * `nodeTarget` is the proxy target of the node's agent (`agent`, or
 * `node:<name>`), which is also the Config tab that carries its
 * mappings -- so the sentence that says "map it" can link there.
 */
export function describeAdmission(
  admission: Admission,
  nodeLabel: string,
  nodeTarget: string,
): LaunchPreview {
  const location = admission.location ?? null;

  if (location && !location.exists) {
    const via = location.mapping
      ? ` through the mapping ${location.mapping.from} → ${location.mapping.to}`
      : "";
    const same = location.localPath === location.path;
    return {
      tone: "error",
      headline: `Not on ${nodeLabel}`,
      detail: same
        ? `${location.path} does not exist there${via}. If the library's files are reachable from ${nodeLabel} over a share, map the library's directory to where it is mounted there.`
        : `${location.path} resolves to ${location.localPath} there${via}, and nothing is at that path. Check the mount, or fix the mapping.`,
      fixTarget: nodeTarget,
    };
  }

  if (admission.decision === "refuse") {
    return {
      tone: "error",
      headline: `Will not fit on ${nodeLabel}`,
      detail: admission.reason,
      fixTarget: null,
    };
  }

  const parts: string[] = [];
  if (location) {
    parts.push(
      location.mapping
        ? `Opens ${location.localPath} (the library's ${location.path}, through ${location.mapping.from} → ${location.mapping.to}).`
        : `Opens ${location.localPath}.`,
    );
    if (location.sizeMatchesLibrary === false) {
      parts.push(
        `The file there is ${location.sizeBytes ?? "?"} bytes and the library lists ${location.librarySizeBytes ?? "?"} — a different file, or a stale scan.`,
      );
    }
  }
  const need = gib(admission.requiredBytes);
  const free = gib(admission.freeBytes);
  if (need && free) {
    parts.push(
      `Needs about ${need}; ${free} free on ${admission.device?.name ?? "the device"} (${admission.basis === "metadata" ? "from the library's metadata" : "from the file size"}).`,
    );
  }
  if (admission.warning) parts.push(admission.warning);

  const fitWord =
    admission.fit === "fits"
      ? "fits"
      : admission.fit === "unknown"
        ? "admitted on faith"
        : `${admission.fit}, admitted with partial offload`;
  return {
    tone: admission.warning || admission.fit !== "fits" ? "warn" : "ok",
    headline: `Launch on ${nodeLabel}: ${fitWord}`,
    detail: parts.length ? parts.join(" ") : null,
    fixTarget: null,
  };
}

/** The Config page's tab for a node's agent, as a link. */
export function configTabHref(target: string): string {
  return `/config?tab=${encodeURIComponent(target)}`;
}
