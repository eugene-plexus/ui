/**
 * What a settings widget can truthfully show for the value a component sent.
 *
 * **Settings never lie** (Troy, 2026-09-29: fundamental). No widget may show a
 * value other than the one in effect. Found on Troy's worker: an unset
 * `updateChannel` rendered as **Edge**, because a `<select>` whose value
 * matches no option shows its first one. The same shape was waiting in every
 * widget here -- a checkbox that shows off for a null whose default is on, a
 * number box that goes blank for a string, a list parser that drops the
 * entries it cannot read and saves the rest.
 *
 * So before a widget draws a value, this says which of three things it is:
 *
 * - `value`: something the widget can show as itself, perhaps with a
 *   `warning` (outside the range the field allows, entries it cannot show);
 * - `unset`: nothing saved -- the widget says what that means, from the
 *   field's `unsetMeans`, its `default`, or plainly "Not set";
 * - `unrepresentable`: something the widget cannot show at all (a string in
 *   a number box, a value that is not one of the choices). The widget says
 *   so, with the raw value, rather than coercing it into a choice.
 *
 * Pure, so each case is tested against the values components really send.
 */

import type { ConfigField } from "./types";

export type ValueReading =
  | { kind: "value"; warning?: string }
  | { kind: "unset" }
  | { kind: "unrepresentable"; raw: string; reason: string };

/** The text a component sends for a secret it holds. */
export const REDACTED = "<redacted>";

const TEXT_TYPES = new Set(["string", "url", "file_path", "runtime_name", "node_name", "secret"]);
const NUMBER_TYPES = new Set(["integer", "number", "duration"]);
const STRING_LIST_TYPES = new Set(["path_list", "url_list", "string_list"]);

/** A value as a person could type it back: short, and never `[object Object]`. */
export function rawText(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return String(value);
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  } catch {
    return String(value);
  }
}

function isUnset(value: unknown): boolean {
  return value === null || value === undefined;
}

export function readValue(field: ConfigField, value: unknown): ValueReading {
  const vt = field.valueType;

  if (vt === "boolean") {
    if (isUnset(value)) return { kind: "unset" };
    if (typeof value === "boolean") return { kind: "value" };
    return {
      kind: "unrepresentable",
      raw: rawText(value),
      reason: "it is not on or off",
    };
  }

  if (vt === "enum") {
    const choices = field.enumValues ?? [];
    if (isUnset(value)) return { kind: "unset" };
    if (typeof value === "string" && choices.includes(value)) return { kind: "value" };
    if (value === "") return { kind: "unset" };
    return {
      kind: "unrepresentable",
      raw: rawText(value),
      reason: "it is not one of the choices",
    };
  }

  if (NUMBER_TYPES.has(vt)) {
    if (isUnset(value) || value === "") return { kind: "unset" };
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { kind: "unrepresentable", raw: rawText(value), reason: "it is not a number" };
    }
    if (vt === "integer" && !Number.isInteger(value)) {
      return { kind: "value", warning: `${value} is not a whole number` };
    }
    const min = field.minimum ?? null;
    const max = field.maximum ?? null;
    if ((min !== null && value < min) || (max !== null && value > max)) {
      const range =
        min !== null && max !== null
          ? `${min} to ${max}`
          : min !== null
            ? `${min} or more`
            : `${max} or less`;
      return { kind: "value", warning: `${value} is outside what this field allows (${range})` };
    }
    return { kind: "value" };
  }

  if (TEXT_TYPES.has(vt)) {
    if (isUnset(value)) return { kind: "unset" };
    if (typeof value === "string") {
      // An empty string is unset wherever the component says what unset
      // means: `controlUrl`'s "(off)" saves "", and "" is "worked out".
      if (value === "" && field.unsetMeans) return { kind: "unset" };
      return { kind: "value" };
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return { kind: "value", warning: `this is a ${typeof value}, ${String(value)}, not text` };
    }
    return { kind: "unrepresentable", raw: rawText(value), reason: "it is not text" };
  }

  if (STRING_LIST_TYPES.has(vt)) {
    if (isUnset(value)) return { kind: "unset" };
    if (!Array.isArray(value)) {
      return { kind: "unrepresentable", raw: rawText(value), reason: "it is not a list" };
    }
    const bad = value.filter((v) => typeof v !== "string").length;
    return bad > 0 ? { kind: "value", warning: droppedWarning(bad) } : { kind: "value" };
  }

  if (vt === "library_folders" || vt === "path_mappings" || vt === "share_credentials") {
    if (isUnset(value)) return { kind: "unset" };
    if (!Array.isArray(value)) {
      return { kind: "unrepresentable", raw: rawText(value), reason: "it is not a list" };
    }
    const bad = value.filter((v) => !entryReadable(vt, v)).length;
    return bad > 0 ? { kind: "value", warning: droppedWarning(bad) } : { kind: "value" };
  }

  return isUnset(value) ? { kind: "unset" } : { kind: "value" };
}

function droppedWarning(count: number): string {
  const entries = count === 1 ? "1 entry" : `${count} entries`;
  return (
    `${entries} here could not be read and ${count === 1 ? "is" : "are"} not shown. ` +
    "Saving this field replaces the whole list with what you see."
  );
}

/** Whether one entry of a structured list is one its editor can show. */
function entryReadable(vt: string, item: unknown): boolean {
  if (vt === "library_folders") {
    if (typeof item === "string") return item.trim().length > 0;
    if (typeof item !== "object" || item === null) return false;
    const record = item as Record<string, unknown>;
    return typeof record.path === "string" && record.path.trim().length > 0;
  }
  if (typeof item !== "object" || item === null) return false;
  const record = item as Record<string, unknown>;
  if (vt === "path_mappings")
    return typeof record.from === "string" && typeof record.to === "string";
  return typeof record.host === "string";
}

/** A field's default in the words its editor uses. */
export function formatValue(field: ConfigField, value: unknown): string {
  if (value === null || value === undefined) return "not set";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (field.valueType === "enum" && typeof value === "string") {
    const i = field.enumValues?.indexOf(value) ?? -1;
    const label = i >= 0 ? field.enumLabels?.[i] : undefined;
    return label ?? (value === "" ? "(use adapter default)" : value);
  }
  if (Array.isArray(value)) {
    // "empty", never "none": for `corsAllowedOrigins` empty means ANY
    // origin, and the field's own `unsetMeans` says so beside this.
    if (value.length === 0) return "empty";
    return value
      .map((x) =>
        typeof x === "string"
          ? x
          : typeof x === "object" &&
              x !== null &&
              typeof (x as { path?: unknown }).path === "string"
            ? String((x as { path: string }).path)
            : JSON.stringify(x),
      )
      .join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (value === "") return "empty";
  return String(value);
}

/**
 * What an unset field does, in one sentence: the component's own words
 * when it sent them, else its default, else plainly that nothing is set.
 */
export function unsetSentence(field: ConfigField): string {
  if (field.unsetMeans) return field.unsetMeans;
  if (field.default !== undefined && field.default !== null && !field.sensitive) {
    return `Not set: uses the default, ${formatValue(field, field.default)}.`;
  }
  return "Not set.";
}

/**
 * The effective value of `key` for a `showWhen` test: what the document
 * holds, else that field's default. A document that leaves a field out
 * does not make its dependents vanish while the default applies.
 */
export function effectiveValue(
  key: string,
  values: Record<string, unknown>,
  fields: readonly ConfigField[] | undefined,
): unknown {
  const held = values[key];
  if (held !== undefined && held !== null) return held;
  const field = fields?.find((f) => f.key === key);
  return field?.default ?? held;
}
