/**
 * The gateway's priority lists (`modelSlots`), as the Routing page edits
 * them.
 *
 * A slot is `{model, targets[]}`: a request for `model` is served by the
 * drivers serving `model` itself (tier 1), then by the drivers serving
 * each target in order (tiers 2..N), cascading on failure. Targets are
 * model ids, never driver names — an id names a replica set.
 *
 * **Pure on purpose.** No React, no fetching. The page owns the state;
 * this module owns what the state means, so a vitest run can assert the
 * reorder arithmetic and the server's own validation rules without a
 * browser.
 *
 * Two kinds of finding, deliberately separate:
 *
 * - `slotProblems` mirrors what `gateway/config.py::_validate_model_slots`
 *   REJECTS — an empty name, a name listed twice, a list with no targets.
 *   The page blocks Save on these with the same sentence the server would
 *   send back, because a Save that is known to bounce is a worse
 *   experience than a disabled button that says why.
 * - `slotWarnings` names what the server ACCEPTS but is almost certainly
 *   a mistake — a list naming itself as a fallback (it is already
 *   tier 1), the same target twice. Warned, never blocked: the operator
 *   may know something we do not.
 *
 * Resolution reads the gateway's own routing table (`GET
 * /v1/admin/routing`) rather than re-deriving it: the table already
 * answers "which drivers serve id X right now", and a second derivation
 * is a second chance to disagree with the thing that actually routes.
 * The real error source here was never malformed JSON — it was a
 * misspelled target, which resolves to an empty tier and fails silently
 * at request time. `resolveTarget` is what turns that into a warning on
 * the row where the typo was made.
 */

import type { RoutingTableView } from "./types";

export interface ModelSlot {
  model: string;
  targets: string[];
}

type RoutingSlot = RoutingTableView["slots"][number];
type RoutingBackend = RoutingSlot["tiers"][number]["backends"][number];

/**
 * Read the `modelSlots` config value tolerantly.
 *
 * The server validates on every PATCH, so a malformed value means the
 * file was edited by hand. In that case the structured editor would have
 * to guess which entries to keep — and silently dropping an operator's
 * entry is worse than an error — so the answer is an error plus no
 * slots, and the page falls back to the JSON view with the raw value in
 * it.
 */
export function parseModelSlots(value: unknown): { slots: ModelSlot[]; error: string | null } {
  if (value === null || value === undefined) return { slots: [], error: null };
  if (!Array.isArray(value)) {
    return { slots: [], error: `expected a list of {model, targets} entries, got ${typeof value}` };
  }
  const slots: ModelSlot[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item: unknown = value[index];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { slots: [], error: `entry ${index}: expected an object with model and targets` };
    }
    const record = item as Record<string, unknown>;
    const model = record.model;
    const targets = record.targets;
    if (typeof model !== "string") {
      return { slots: [], error: `entry ${index}: model must be a string` };
    }
    if (!Array.isArray(targets) || targets.some((t) => typeof t !== "string")) {
      return { slots: [], error: `entry ${index} (${model}): targets must be a list of model ids` };
    }
    slots.push({ model, targets: [...(targets as string[])] });
  }
  return { slots, error: null };
}

/** The wire shape: names trimmed, empty target rows dropped. A slot with
 * no targets is kept — `slotProblems` names it and Save is blocked, so
 * serialization never has to decide whether to discard it. */
export function serializeModelSlots(slots: ModelSlot[]): { model: string; targets: string[] }[] {
  return slots.map((slot) => ({
    model: slot.model.trim(),
    targets: slot.targets.map((t) => t.trim()).filter((t) => t.length > 0),
  }));
}

/** Whether two drafts would PATCH the same value. */
export function slotsEqual(a: ModelSlot[], b: ModelSlot[]): boolean {
  return JSON.stringify(serializeModelSlots(a)) === JSON.stringify(serializeModelSlots(b));
}

/* ─────────────────────────── editing ops ────────────────────────────── */
/* All pure: every op returns a fresh array and leaves its input alone,
 * so React state updates and the tests can compare before/after. */

export function addSlot(slots: ModelSlot[], model: string): ModelSlot[] {
  return [...slots, { model: model.trim(), targets: [] }];
}

export function removeSlot(slots: ModelSlot[], index: number): ModelSlot[] {
  return slots.filter((_, i) => i !== index);
}

export function renameSlot(slots: ModelSlot[], index: number, model: string): ModelSlot[] {
  return slots.map((slot, i) => (i === index ? { ...slot, model } : slot));
}

export function addTarget(slots: ModelSlot[], index: number, id: string): ModelSlot[] {
  const trimmed = id.trim();
  if (!trimmed) return slots;
  return slots.map((slot, i) =>
    i === index ? { ...slot, targets: [...slot.targets, trimmed] } : slot,
  );
}

export function setTarget(
  slots: ModelSlot[],
  index: number,
  targetIndex: number,
  id: string,
): ModelSlot[] {
  return slots.map((slot, i) =>
    i === index
      ? { ...slot, targets: slot.targets.map((t, j) => (j === targetIndex ? id : t)) }
      : slot,
  );
}

export function removeTarget(slots: ModelSlot[], index: number, targetIndex: number): ModelSlot[] {
  return slots.map((slot, i) =>
    i === index ? { ...slot, targets: slot.targets.filter((_, j) => j !== targetIndex) } : slot,
  );
}

/**
 * Move a target one step up (`delta: -1`) or down (`+1`). Out of range is
 * a no-op rather than a clamp-to-edge: the buttons that call this are
 * disabled at the edges, and a keyboard repeat past the end should not
 * silently reorder anything else.
 */
export function moveTarget(
  slots: ModelSlot[],
  index: number,
  targetIndex: number,
  delta: -1 | 1,
): ModelSlot[] {
  const slot = slots[index];
  if (!slot) return slots;
  const to = targetIndex + delta;
  if (
    targetIndex < 0 ||
    targetIndex >= slot.targets.length ||
    to < 0 ||
    to >= slot.targets.length
  ) {
    return slots;
  }
  const targets = [...slot.targets];
  const [moved] = targets.splice(targetIndex, 1);
  targets.splice(to, 0, moved!);
  return slots.map((s, i) => (i === index ? { ...s, targets } : s));
}

/* ─────────────────────────── validation ─────────────────────────────── */

/**
 * What the server would reject, named per list. Mirrors
 * `_validate_model_slots` in the gateway — the point is that Save is
 * blocked by the same rule that would bounce it, with the row named.
 */
export function slotProblems(slots: ModelSlot[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  slots.forEach((slot, index) => {
    const name = slot.model.trim();
    const label = name ? `"${name}"` : `list ${index + 1}`;
    if (!name) {
      problems.push(`List ${index + 1} has no name — every list is named after a model.`);
    } else if (seen.has(name)) {
      problems.push(`Two lists are named ${label} — the gateway refuses a name listed twice.`);
    } else {
      seen.add(name);
    }
    const targets = slot.targets.map((t) => t.trim()).filter((t) => t.length > 0);
    if (targets.length === 0) {
      problems.push(
        `${label} has no fallbacks — a list needs at least one target, or remove the list.`,
      );
    }
  });
  return problems;
}

/** What the server accepts but is almost certainly a mistake. */
export function slotWarnings(slots: ModelSlot[]): string[] {
  const warnings: string[] = [];
  for (const slot of slots) {
    const name = slot.model.trim();
    if (!name) continue;
    const targets = slot.targets.map((t) => t.trim()).filter((t) => t.length > 0);
    if (targets.includes(name)) {
      warnings.push(
        `"${name}" lists itself as a fallback — its own drivers are already tried first.`,
      );
    }
    const seen = new Set<string>();
    for (const target of targets) {
      if (seen.has(target)) {
        warnings.push(`"${name}" lists ${target} twice — the second entry adds nothing.`);
        break;
      }
      seen.add(target);
    }
  }
  return warnings;
}

/* ─────────────────────────── resolution ─────────────────────────────── */

export interface TargetResolution {
  /** Drivers currently serving this id, each as `driver` or `driver @ node`. */
  servedBy: string[];
  /** How many of them could take a request right now. */
  eligibleCount: number;
}

function describeBackend(backend: RoutingBackend): string {
  return backend.node ? `${backend.driver} @ ${backend.node}` : backend.driver;
}

/**
 * Which drivers serve `id`, off the routing table's own snapshot.
 *
 * The table lists every served model id as a slot and every configured
 * target as a tier, so an id can appear in several places; the replica
 * set is the same wherever it appears, and the first tier found for it
 * answers. `null` means the table itself is missing (unreachable or safe
 * mode) — "unknown", which must not be rendered as "nothing serves this".
 */
export function resolveTarget(
  routing: RoutingTableView | null,
  id: string,
): TargetResolution | null {
  if (!routing) return null;
  const wanted = id.trim();
  if (!wanted) return { servedBy: [], eligibleCount: 0 };
  for (const slot of routing.slots ?? []) {
    for (const tier of slot.tiers ?? []) {
      if (tier.target === wanted && tier.backends.length > 0) {
        return {
          servedBy: tier.backends.map(describeBackend),
          eligibleCount: tier.backends.filter((b) => b.eligible).length,
        };
      }
    }
  }
  return { servedBy: [], eligibleCount: 0 };
}

export interface SelfTier {
  /** Whether anything in the install declares a runtime under this name.
   * False for a purely virtual alias — the routing table omits the
   * implicit self tier for those, deliberately (R3.3), so the first
   * configured target is what gets tried first. */
  declared: boolean;
  servedBy: string[];
  eligibleCount: number;
}

/**
 * The slot's own implicit tier, off the routing table. A primary that is
 * down is still a primary — its tier is present with ineligible backends —
 * while a name nothing declares has no self tier at all. `null` means the
 * table is missing, which is "unknown", not "alias".
 */
export function selfTier(routing: RoutingTableView | null, model: string): SelfTier | null {
  if (!routing) return null;
  const wanted = model.trim();
  const slot = (routing.slots ?? []).find((s) => s.model === wanted);
  const tier = slot?.tiers?.find((t) => t.target === wanted);
  // The tier's presence is the fact, not its backends: a declared runtime
  // whose driver has not joined yet still has its tier, with nothing in it.
  if (!tier) return { declared: false, servedBy: [], eligibleCount: 0 };
  return {
    declared: true,
    servedBy: tier.backends.map(describeBackend),
    eligibleCount: tier.backends.filter((b) => b.eligible).length,
  };
}

/** Every model id the routing table knows — slot names and tier targets —
 * sorted, for the pickers. Free text stays allowed on top of this: a
 * target may name a model that is not launched yet, deliberately. */
export function knownModelIds(routing: RoutingTableView | null): string[] {
  if (!routing) return [];
  const ids = new Set<string>();
  for (const slot of routing.slots ?? []) {
    if (slot.model) ids.add(slot.model);
    for (const tier of slot.tiers ?? []) {
      if (tier.target) ids.add(tier.target);
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/**
 * Served models that have no priority list yet and are not in the draft:
 * the "add fallbacks to this one" offers. Only models something actually
 * serves — an empty implicit slot is a diagnosis for the Inference
 * screen, not a thing to configure fallbacks for here.
 */
export function unconfiguredServedModels(
  routing: RoutingTableView | null,
  draft: ModelSlot[],
): string[] {
  if (!routing) return [];
  const taken = new Set(draft.map((s) => s.model.trim()).filter((m) => m.length > 0));
  const out: string[] = [];
  for (const slot of routing.slots ?? []) {
    if (slot.configured) continue;
    if (!slot.model || taken.has(slot.model)) continue;
    const served = (slot.tiers ?? []).some((tier) => tier.backends.length > 0);
    if (served) out.push(slot.model);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
