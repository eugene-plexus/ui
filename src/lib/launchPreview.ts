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
  /**
   * A `contextSize` at which the agent says this file WOULD fit entirely
   * in the device's memory, when the one asked for (or the model's own,
   * when the profile left it to the engine) does not. Null when it fits
   * as asked, when the weights alone do not fit, or when the agent did
   * not say.
   *
   * Discover scores at the library's 8,192-token guidance context; a
   * profile with no `contextSize` is scored at the model's own, which
   * for a current model is 262,144. Those two screens never disagreed
   * about the model, only about the context, and until 2026-09-15 the
   * refusal said "lower contextSize" without a number to lower it to.
   */
  suggestedContext: number | null;
}

function contextSuggestion(admission: Admission): number | null {
  const max = admission.maxContextLength;
  if (typeof max !== "number" || max <= 0) return null;
  const asked = admission.contextLength;
  if (asked != null && asked <= max) return null;
  return max;
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
      ? ` through the rule ${location.mapping.from} → ${location.mapping.to}`
      : "";
    const same = location.localPath === location.path;
    return {
      tone: "error",
      headline: `Not on ${nodeLabel}`,
      detail: same
        ? `${location.path} does not exist there${via}. If the Library's files are reachable from ${nodeLabel} over a share, say where that folder is mounted: on the folder itself (every node of that kind inherits it), or as an override for ${nodeLabel}.`
        : `${location.path} resolves to ${location.localPath} there${via}, and nothing is at that path. Check the mount, or fix the folder's mount or ${nodeLabel}'s override.`,
      fixTarget: nodeTarget,
      suggestedContext: null,
    };
  }

  if (admission.decision === "refuse") {
    return {
      tone: "error",
      headline: `Will not fit on ${nodeLabel}`,
      detail: admission.reason,
      fixTarget: null,
      suggestedContext: contextSuggestion(admission),
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
  // Memory promised to a launch already under way is subtracted before
  // the verdict, so a panel that printed only `freeBytes` would say
  // "needs 20 GiB, 24 GiB free" and then be refused -- two screens
  // disagreeing about one number, which is the failure this whole
  // surface exists to stop.
  const reserved = gib(admission.reservedBytes);
  if (reserved && admission.reservedBytes) {
    parts.push(`${reserved} of that is reserved for a launch already under way.`);
  }
  if (admission.warning) parts.push(admission.warning);
  // Admitted, but only with partial offload: the number that would
  // make it a clean fit is worth more than the warning.
  const suggested = admission.fit === "fits" ? null : contextSuggestion(admission);
  if (suggested != null) {
    parts.push(`Fits entirely in GPU memory up to ${suggested.toLocaleString()} context.`);
  }

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
    suggestedContext: suggested,
  };
}

/** The Config page's tab for a node's agent, as a link. */
export function configTabHref(target: string): string {
  return `/config?tab=${encodeURIComponent(target)}`;
}
