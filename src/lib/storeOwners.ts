/**
 * Who keeps what in the store (row 53), in words a person reads.
 *
 * The store names an owner `person:<id>`, `key:<id>`, `install` or
 * `component:<sub>`. The console says the person's name, the app key's
 * name, or "You (this console)", and never more than counts and bytes:
 * the install owner does not read people's files.
 */

import type { components } from "@/generated/store";

export type StoreOwner = components["schemas"]["StoreOwner"];
export type StoreOwnerList = components["schemas"]["StoreOwnerList"];
export type StoreStatus = components["schemas"]["StoreStatus"];
export type SweepReport = components["schemas"]["SweepReport"];

export interface OwnerNames {
  people: ReadonlyMap<string, string>;
  keys: ReadonlyMap<string, string>;
}

/** What a person reads for an owner. */
export function ownerLabel(owner: string, names: OwnerNames): string {
  if (owner === "install") return "You (this console)";
  const [kind, ...rest] = owner.split(":");
  const id = rest.join(":");
  if (kind === "person") {
    const name = names.people.get(id);
    return name ?? "A removed or unknown person";
  }
  if (kind === "key") {
    const name = names.keys.get(id);
    return name ? `App key "${name}"` : "An app key that no longer exists";
  }
  if (kind === "component") return `Eugene's ${id}`;
  return owner;
}

/** Bytes in the unit a person expects: B, KiB, MiB, GiB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** One line on the last sweep, leading with what it did. */
export function sweepLine(report: SweepReport | null | undefined): string | null {
  if (!report) return null;
  if (report.error) return `The last sweep failed: ${report.error}`;
  const deleted = report.files + report.uploads;
  const what =
    deleted === 0
      ? "Nothing had ended at the last sweep"
      : `The last sweep deleted ${report.files} file${report.files === 1 ? "" : "s"} and ${report.uploads} upload${report.uploads === 1 ? "" : "s"} (${formatBytes(report.freedBytes)})`;
  const removal = report.removal;
  if (removal?.error) return `${what}. Removed people were not checked: ${removal.error}`;
  const lines = [
    removal && removal.deleted > 0
      ? `${what}, including everything ${removal.deleted} removed ${removal.deleted === 1 ? "person" : "people"} kept.`
      : `${what}.`,
  ];
  if (removal && removal.hidden > 0) {
    lines.push(
      `${removal.hidden} removed ${removal.hidden === 1 ? "person's" : "people's"} files are now hidden.`,
    );
  }
  if (removal && removal.restored > 0) {
    lines.push(
      `${removal.restored} ${removal.restored === 1 ? "person" : "people"} Eugene has again ${removal.restored === 1 ? "has their" : "have their"} files back.`,
    );
  }
  if (removal && removal.lateRestored > 0) {
    lines.push(
      `${removal.lateRestored} ${removal.lateRestored === 1 ? "person" : "people"} Eugene has again came back after ${removal.lateRestored === 1 ? "their" : "the"} delete date, so ${removal.lateRestored === 1 ? "their" : "the"} files were deleted.`,
    );
  }
  return lines.join(" ");
}

/** A day, as the console writes one: "20 Oct 2026". */
export function shortDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** The owners whose files are hidden because Eugene removed them (row 7's rules). */
export function removedOwners(list: StoreOwnerList): StoreOwner[] {
  return list.owners.filter((o) => o.deleteAt != null);
}
