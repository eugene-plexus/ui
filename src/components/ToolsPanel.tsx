"use client";

import { EXAMPLE_TOOLS } from "@/lib/diagnostic";
import type { ToolChoice } from "@/lib/types";

export type ResponseFormatChoice = "text" | "json_object";

export const EXAMPLE_TOOLS_TEXT = JSON.stringify(EXAMPLE_TOOLS, null, 2);

/**
 * What a harness sends that the playground could not: tool definitions,
 * how the model may use them, and whether the answer must be JSON.
 *
 * The definitions are a JSON editor and not a form, on purpose. A form
 * would be our idea of a tool schema; what a harness sends is whatever
 * JSON it sends, and the diagnostic's job is to send the same thing.
 * The example preloaded is the `get_weather` definition the tool-calling
 * acceptance run uses, so the default request is one already proven to
 * make a real model call a tool.
 */
export function ToolsPanel({
  enabled,
  onEnabled,
  definitions,
  onDefinitions,
  error,
  toolNames,
  toolChoice,
  onToolChoice,
  responseFormat,
  onResponseFormat,
  modelToolCalling,
}: {
  enabled: boolean;
  onEnabled: (value: boolean) => void;
  definitions: string;
  onDefinitions: (value: string) => void;
  /** Why the definitions cannot be sent, or null. */
  error: string | null;
  /** Function names parsed out of the definitions, for `tool_choice`. */
  toolNames: string[];
  toolChoice: ToolChoice;
  onToolChoice: (value: ToolChoice) => void;
  responseFormat: ResponseFormatChoice;
  onResponseFormat: (value: ResponseFormatChoice) => void;
  /** `x_eugene_plexus.tool_calling` for the selected model: false means
   * the gateway will refuse a request carrying tools, by design, and the
   * panel says so before Send rather than after the 400. */
  modelToolCalling: boolean | null | undefined;
}) {
  const choiceValue =
    typeof toolChoice === "string" ? toolChoice : `fn:${toolChoice.function.name}`;

  return (
    <section
      className="flex min-w-0 flex-1 flex-col gap-2 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-3"
      aria-label="Tools"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <label className="font-ui flex items-center gap-2 text-sm font-semibold">
          <input
            data-testid="tools-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabled(e.target.checked)}
          />
          Send tool definitions
        </label>
        <div className="font-ui flex flex-wrap items-center gap-2 text-[0.6875rem] text-[color:var(--muted)]">
          <label className="flex items-center gap-1">
            tool_choice
            <select
              data-testid="tool-choice"
              value={choiceValue}
              disabled={!enabled}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("fn:")) {
                  onToolChoice({ type: "function", function: { name: v.slice(3) } });
                } else {
                  onToolChoice(v as "auto" | "none" | "required");
                }
              }}
              className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-1 py-0.5 text-[0.6875rem] text-[color:var(--foreground)] disabled:opacity-50"
            >
              <option value="auto">auto</option>
              <option value="none">none</option>
              <option value="required">required</option>
              {toolNames.map((name) => (
                <option key={name} value={`fn:${name}`}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            response_format
            <select
              data-testid="response-format"
              value={responseFormat}
              onChange={(e) => onResponseFormat(e.target.value as ResponseFormatChoice)}
              className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-1 py-0.5 text-[0.6875rem] text-[color:var(--foreground)]"
            >
              <option value="text">text</option>
              <option value="json_object">json_object</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => onDefinitions(EXAMPLE_TOOLS_TEXT)}
            disabled={definitions === EXAMPLE_TOOLS_TEXT}
            className="rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 hover:bg-[color:var(--panel-hover)] disabled:opacity-40"
            title="The get_weather definition the tool-calling acceptance run uses"
          >
            Reset to example
          </button>
        </div>
      </header>

      <textarea
        data-testid="tools-json"
        aria-label="Tool definitions (JSON)"
        value={definitions}
        onChange={(e) => onDefinitions(e.target.value)}
        disabled={!enabled}
        rows={enabled ? 6 : 2}
        spellCheck={false}
        className="w-full resize-y rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 font-mono text-[0.6875rem] leading-snug text-[color:var(--foreground)] outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:opacity-50"
      />
      {enabled && error && (
        <p className="status-error rounded-[var(--radius)] px-2 py-1 text-[0.6875rem]">{error}</p>
      )}
      {enabled && modelToolCalling === false && (
        <p className="status-warn rounded-[var(--radius)] px-2 py-1 text-[0.6875rem]">
          The selected model reports <code className="font-mono">tool_calling: false</code>: one of
          the backends serving it cannot carry tool definitions. The gateway will refuse this
          request with a 400 rather than strip the tools, by design — a plain answer would be
          indistinguishable from the model choosing not to call anything.
        </p>
      )}
      <p className="font-ui text-[0.6875rem] text-[color:var(--muted)]">
        The playground executes nothing. When the model calls a tool, the call is shown and you type
        the result — the loop a harness runs, with a person as the tool runtime.
      </p>
    </section>
  );
}
