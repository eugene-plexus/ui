import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigFieldInput } from "./ConfigField";
import type { ConfigField } from "@/lib/types";

const RUNTIME: ConfigField = {
  key: "runtimeName",
  label: "Runtime",
  category: "backend",
  valueType: "runtime_name",
  default: "",
  unsetMeans: "Uses the backend URL.",
  sensitive: false,
  required: false,
  requiresRestart: false,
  pendingRestart: false,
};

type Handler = () => { status: number; statusText?: string; body?: unknown };
let handlers: Map<string, Handler>;

beforeEach(() => {
  handlers = new Map([
    [
      "GET agent/v1/runtimes",
      () => ({
        status: 200,
        body: {
          runtimes: [
            { name: "gemma-a", engine: "llama_cpp", status: "ready" },
            { name: "gemma-vllm", engine: "vllm", status: "stopped" },
          ],
        },
      }),
    ],
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^\/api\/proxy\//, "");
      const key = `${init?.method ?? "GET"} ${route}`;
      const handler = handlers.get(key);
      const result = handler ? handler() : { status: 418, body: { detail: `unhandled: ${key}` } };
      return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
        status: result.status,
        statusText: result.statusText ?? String(result.status),
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function Editor({ initial, onChange }: { initial: unknown; onChange: (value: unknown) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <ConfigFieldInput
      field={RUNTIME}
      value={value}
      pending={false}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("runtime_name fields", () => {
  it("offers the runtimes returned by GET agent/v1/runtimes and saves the selected name", async () => {
    const onChange = vi.fn();
    render(<Editor initial="gemma-vllm" onChange={onChange} />);

    const select = await screen.findByRole("combobox", { name: "Runtime" });
    expect(within(select).getByRole("option", { name: "gemma-a" })).toHaveValue("gemma-a");
    expect(within(select).getByRole("option", { name: "gemma-vllm" })).toHaveValue("gemma-vllm");
    expect(select).toHaveDisplayValue("gemma-vllm");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: "gemma-a" } });
    expect(onChange).toHaveBeenLastCalledWith("gemma-a");
    expect(select).toHaveDisplayValue("gemma-a");
  });

  it("keeps a stored name visible and marked not found without changing it", async () => {
    const onChange = vi.fn();
    render(<Editor initial="retired-runtime" onChange={onChange} />);

    const select = await screen.findByRole("combobox", { name: "Runtime" });
    expect(select).toHaveDisplayValue("retired-runtime (not found)");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: (select as HTMLSelectElement).value } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: "gemma-vllm" } });
    expect(select).toHaveDisplayValue("gemma-vllm");
    expect(onChange).toHaveBeenLastCalledWith("gemma-vllm");
  });

  it.each(["", null, undefined])("keeps an empty value (%s) possible", async (initial) => {
    const onChange = vi.fn();
    render(<Editor initial={initial} onChange={onChange} />);

    const select = await screen.findByRole("combobox", { name: "Runtime" });
    expect(select).toHaveValue("");
    expect(select).toHaveDisplayValue("Not set");
    expect(screen.getByTestId("unset-runtimeName")).toHaveTextContent("Uses the backend URL.");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: "gemma-a" } });
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(select).toHaveDisplayValue("Not set");
  });

  it.each(["", "retired-runtime"])(
    "keeps %s visible when the agent lists no runtimes",
    async (initial) => {
      handlers.set("GET agent/v1/runtimes", () => ({ status: 200, body: { runtimes: [] } }));
      const onChange = vi.fn();
      render(<Editor initial={initial} onChange={onChange} />);

      const select = await screen.findByRole("combobox", { name: "Runtime" });
      expect(select).toHaveDisplayValue(initial === "" ? "Not set" : `${initial} (not found)`);
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    },
  );

  it.each([123, false, { name: "gemma-a" }])(
    "does not select a runtime for a non-text value: %j",
    async (initial) => {
      const onChange = vi.fn();
      render(<Editor initial={initial} onChange={onChange} />);

      const select = await screen.findByRole("combobox", { name: "Runtime" });
      expect(select).toHaveDisplayValue(`${JSON.stringify(initial)} (not found)`);
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it.each([
    { status: 503, body: undefined, cause: "503 Service Unavailable" },
    { status: 502, body: { detail: "Worker is offline" }, cause: "Worker is offline" },
  ])(
    "falls back to editable text with the observed HTTP $status cause",
    async ({ status, body, cause }) => {
      handlers.set("GET agent/v1/runtimes", () => ({
        status,
        statusText: "Service Unavailable",
        body,
      }));
      const onChange = vi.fn();
      render(<Editor initial="saved-runtime" onChange={onChange} />);

      expect(
        await screen.findByText(`Runtimes unavailable: ${cause}. Type a name.`),
      ).toBeInTheDocument();
      const input = screen.getByRole("textbox", { name: "Runtime" });
      expect(input).toHaveValue("saved-runtime");
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: "manual-runtime" } });
      expect(input).toHaveValue("manual-runtime");
      expect(onChange).toHaveBeenLastCalledWith("manual-runtime");
    },
  );

  it("falls back to text with the observed network error", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    render(<Editor initial="saved-runtime" onChange={vi.fn()} />);

    expect(
      await screen.findByText("Runtimes unavailable: Failed to fetch. Type a name."),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Runtime" })).toHaveValue("saved-runtime");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it.each([{ pending: true }, { pending: false, managedBy: "Managed by Eugene" }])(
    "locks the runtime dropdown when pending or managed: %o",
    async ({ pending, managedBy }) => {
      render(
        <ConfigFieldInput
          field={{ ...RUNTIME, managedBy }}
          value="gemma-a"
          pending={pending}
          onChange={vi.fn()}
        />,
      );
      expect(await screen.findByRole("combobox", { name: "Runtime" })).toBeDisabled();
    },
  );
});
