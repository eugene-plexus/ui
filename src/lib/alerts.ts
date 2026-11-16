/**
 * Alerts and SLOs (row 38), the pure half.
 *
 * The active control root evaluates the rules once a minute and keeps what
 * fired (`GET /v1/alerts`); the owner sets the rules, the SLO targets and the
 * webhook (`GET`/`PUT /v1/alerting`). Nothing here evaluates a rule: the
 * console shows what the root decided, so two browsers never disagree about
 * what is firing.
 */

import type { components as ControlComponents } from "@/generated/control";

export type AlertsView = ControlComponents["schemas"]["AlertsView"];
export type Alert = ControlComponents["schemas"]["Alert"];
export type AlertRule = ControlComponents["schemas"]["AlertRule"];
export type AlertRuleKind = ControlComponents["schemas"]["AlertRuleKind"];
export type AlertingSettings = ControlComponents["schemas"]["AlertingSettings"];
export type AlertingUpdate = ControlComponents["schemas"]["AlertingUpdate"];
export type SloTarget = ControlComponents["schemas"]["SloTarget"];
export type SloStatus = ControlComponents["schemas"]["SloStatus"];
export type AlertWebhookStatus = ControlComponents["schemas"]["AlertWebhookStatus"];

/** What each kind watches, and what its threshold is in, in the console's words. */
export const RULE_KINDS: Record<
  AlertRuleKind,
  { label: string; threshold: string | null; unit: string; fix: string }
> = {
  "machine-down": {
    label: "A machine does not answer",
    threshold: null,
    unit: "",
    fix: "Check that the machine is on and its agent runs.",
  },
  "disk-full": {
    label: "A disk is nearly full",
    threshold: "Percent used",
    unit: "%",
    fix: "Free space on it, or move models to another folder.",
  },
  "gpu-hot": {
    label: "A GPU runs hot",
    threshold: "Temperature, °C",
    unit: " °C",
    fix: "Check its cooling and its power limit.",
  },
  "failure-rate": {
    label: "Requests fail",
    threshold: "Percent of requests",
    unit: "%",
    fix: "See which backend fails on the Metrics page.",
  },
  "slo-burn": {
    label: "An SLO's error budget burns fast",
    threshold: "Times faster than the window allows",
    unit: "×",
    fix: "See the SLO on Dashboards, and the failures on Metrics.",
  },
};

/** One line about a rule, state first: "GPU over 85 °C for 5 minutes". */
export function ruleLine(rule: AlertRule): string {
  const minutes = rule.forMinutes ?? 5;
  const span = `for ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const where = rule.machine ? ` on ${rule.machine}` : "";
  const t = rule.threshold ?? 0;
  switch (rule.kind) {
    case "machine-down":
      return `A machine${where ? ` (${rule.machine})` : ""} does not answer ${span}`;
    case "disk-full":
      return `A disk${where} over ${t}% full ${span}`;
    case "gpu-hot":
      return `A GPU${where} over ${t} °C ${span}`;
    case "failure-rate":
      return `Over ${t}% of requests to ${rule.model ?? "all models"} fail over ${minutes} minutes`;
    case "slo-burn":
      return `${rule.sloId ? `SLO ${rule.sloId}` : "An SLO"} burns its budget ${t} times too fast ${span}`;
  }
}

/** How an SLO stands, in one line, state first. */
export function sloLine(slo: SloStatus): string {
  const name = slo.name ?? slo.id;
  switch (slo.state) {
    case "no-data":
      return `${name}: no requests in the last ${slo.windowDays} days`;
    case "missed":
      return `${name}: missed, the error budget is spent`;
    case "at-risk":
      return slo.firstToken && slo.firstToken.met === false
        ? `${name}: at risk, first tokens are slower than the target`
        : `${name}: at risk, ${Math.max(0, slo.budgetLeftPercent ?? 0).toFixed(0)}% of the error budget left`;
    default:
      return `${name}: met, ${(slo.budgetLeftPercent ?? 100).toFixed(0)}% of the error budget left`;
  }
}

/** A blank rule of a kind, with the built-in defaults. */
export function newRule(kind: AlertRuleKind, taken: string[]): AlertRule {
  const base: Record<AlertRuleKind, { threshold: number; forMinutes: number }> = {
    "machine-down": { threshold: 0, forMinutes: 5 },
    "disk-full": { threshold: 90, forMinutes: 10 },
    "gpu-hot": { threshold: 85, forMinutes: 5 },
    "failure-rate": { threshold: 5, forMinutes: 10 },
    "slo-burn": { threshold: 14.4, forMinutes: 5 },
  };
  let id: string = kind;
  for (let n = 2; taken.includes(id); n++) id = `${kind}-${n}`;
  return { id, kind, enabled: true, ...base[kind], machine: null, model: null, sloId: null };
}

/** A blank SLO target. */
export function newSlo(taken: string[]): SloTarget {
  let id = "slo";
  for (let n = 2; taken.includes(id); n++) id = `slo-${n}`;
  return {
    id,
    name: null,
    model: null,
    clientKeyId: null,
    windowDays: 30,
    successPercent: 99,
    firstTokenSeconds: null,
    firstTokenPercentile: null,
  };
}
