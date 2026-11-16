/**
 * Row 40: usage and money allowances, as the console reads and writes them.
 *
 * Money never passes through a float here. The root says dollars as a decimal
 * string with twelve places (`costUsd`), and allowances and prices are whole
 * millionths of a dollar (micro-dollars). Converting between what a person
 * types and micro-dollars is done on the digits.
 */

import type { components as ControlComponents } from "@/generated/control";

export type UsageReport = ControlComponents["schemas"]["UsageReport"];
export type UsageSubject = ControlComponents["schemas"]["UsageSubject"];
export type UsageTotals = ControlComponents["schemas"]["UsageTotals"];
export type UsageAllowance = ControlComponents["schemas"]["UsageAllowance"];
export type ModelPriceList = ControlComponents["schemas"]["ModelPriceList"];
export type OwnerModelPrice = ControlComponents["schemas"]["OwnerModelPrice"];

/** The three allowances a key or a group can set. */
export const ALLOWANCES = ["tokensPerDay", "tokensPerMonth", "costPerMonthMicros"] as const;
export type AllowanceName = (typeof ALLOWANCES)[number];
export type Allowances = Partial<Record<AllowanceName, number | null>>;

const MAX_MICROS = 10 ** 15;

/**
 * What a person typed, in dollars, as whole micro-dollars: "4", "$4.00",
 * "1,250.5" and "0.000001" are understood; more than six places, a minus
 * sign or anything else is null. Empty is undefined (no allowance).
 */
export function dollarsToMicros(text: string): number | null | undefined {
  const plain = text.trim().replace(/^\$/, "").replace(/,/g, "");
  if (plain === "") return undefined;
  const match = /^(\d+)(?:\.(\d{0,6}))?$/.exec(plain);
  if (!match) return null;
  const whole = (match[1] ?? "0").replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").padEnd(6, "0");
  if (whole.length > 10) return null;
  const micros = Number(whole) * 1_000_000 + Number(fraction);
  return Number.isSafeInteger(micros) && micros <= MAX_MICROS ? micros : null;
}

/** Whole micro-dollars as dollars, with at least two places: 4000000 is
 * "4.00", 10500 is "0.0105". */
export function microsToDollars(micros: number): string {
  const digits = String(Math.trunc(micros)).padStart(7, "0");
  const whole = digits.slice(0, -6).replace(/^0+(?=\d)/, "");
  const fraction = digits.slice(-6).replace(/0+$/, "").padEnd(2, "0");
  return `${Number(whole).toLocaleString("en-US")}.${fraction}`;
}

/** The root's exact dollar string ("0.010500000000") as a person reads it:
 * "$0.0105", "$4.00". Done on the digits, never through a float. */
export function usd(exact: string): string {
  const match = /^(\d+)\.(\d+)$/.exec(exact.trim());
  if (!match) return `$${exact}`;
  const fraction = (match[2] ?? "").replace(/0+$/, "").padEnd(2, "0");
  return `$${Number(match[1] ?? "0").toLocaleString("en-US")}.${fraction}`;
}

export function tokens(n: number | string): string {
  return `${Number(n).toLocaleString("en-US")}`;
}

/** An allowance's line: "1,050 of 1,000 tokens today, spent. Resets at 00:00 UTC 17 Nov." */
export function allowanceLine(a: UsageAllowance): string {
  const money = a.kind === "costPerMonth";
  const amount = money
    ? `${usd(a.used)} of ${usd(a.limit)}`
    : `${tokens(a.used)} of ${tokens(a.limit)} tokens`;
  const span = a.kind === "tokensPerDay" ? "today" : "this month";
  const left = money ? usd(a.left) : `${tokens(a.left)} tokens`;
  const reset = new Date(a.resetsAt);
  const when = reset.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return a.spent
    ? `${amount} ${span}. Spent: refused until ${when} UTC.`
    : `${amount} ${span}. ${left} left. Resets ${when} UTC.`;
}

/** The allowances to send: only those that are set, so a root a release
 * behind, which refuses a field it does not know, sees none when none is set. */
export function allowancesBody(value: Allowances): Allowances {
  const out: Allowances = {};
  for (const name of ALLOWANCES) {
    const v = value[name];
    if (v != null) out[name] = v;
  }
  return out;
}

/** "1,000 tokens a day · $4.00 a month", or "" with none set. */
export function describeAllowances(value: Allowances | null | undefined): string {
  if (!value) return "";
  const parts: string[] = [];
  if (value.tokensPerDay != null) parts.push(`${tokens(value.tokensPerDay)} tokens a day`);
  if (value.tokensPerMonth != null) parts.push(`${tokens(value.tokensPerMonth)} tokens a month`);
  if (value.costPerMonthMicros != null)
    parts.push(`$${microsToDollars(value.costPerMonthMicros)} a month`);
  return parts.join(" · ");
}

/** Whether a root answers groups with row 40's allowances (null when unset). */
export function rootKnowsAllowances(
  groups: { policies?: Record<string, unknown> | null }[] | null,
): boolean {
  return (groups ?? []).some((g) => g.policies != null && "tokensPerDay" in g.policies);
}

/** A rate per million tokens in micro-dollars, said as "$3.00 / $15.00". */
export function rateLine(input: number, output: number): string {
  return `$${microsToDollars(input)} in · $${microsToDollars(output)} out, per million tokens`;
}
