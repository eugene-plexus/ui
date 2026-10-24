/**
 * Who keeps what in the store (row 53), in words a person reads.
 *
 * The store names an owner `person:<id>`, `key:<id>`, `install` or
 * `service:<sub>`. The console says the person's name, the app key's
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
  if (kind === "service") return `Eugene's ${id}`;
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
  if (removal && removal.removed > 0) {
    return `${what}, including everything ${removal.removed} removed ${removal.removed === 1 ? "person" : "people"} kept.`;
  }
  return `${what}.`;
}
