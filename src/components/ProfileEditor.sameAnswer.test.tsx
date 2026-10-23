import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { EngineDescriptor, LibraryModel } from "@/lib/types";

import { ProfileEditor } from "./ProfileEditor";

afterEach(() => vi.unstubAllGlobals());

it.each(["llama_cpp", "vllm"] as const)(
  "saves the %s adapter's launch switch and shows its own default help",
  async (engine) => {
    const writes: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body));
          writes.push(body);
          return Response.json({ ...body, id: "p" });
        }
        return Response.json({ profiles: [{ id: "p", name: "Repeatable", engine, flags: {} }] });
      }),
    );
    const descriptor = {
      engine,
      available: true,
      modelFormats: [engine === "llama_cpp" ? "gguf" : "safetensors"],
      flagSchema: {
        component: `engine:${engine}`,
        fields: [
          {
            key: "sameAnswerEveryTime",
            label: "Same answer every time (slower)",
            valueType: "boolean",
            default: false,
            requiresRestart: true,
            unsetMeans:
              "Off by default. Expert launch overrides still apply; the running model shows what is in effect.",
          },
        ],
      },
    } as EngineDescriptor;
    const model: LibraryModel = {
      id: "test",
      name: "Test",
      path: "/models/test",
      status: "present",
      format: engine === "llama_cpp" ? "gguf" : "safetensors",
    };
    render(<ProfileEditor model={model} engines={[descriptor]} node={null} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "edit" }));
    const field = screen.getByRole("checkbox", { name: "Same answer every time (slower)" });
    expect(field).not.toBeChecked();
    expect(screen.getByText(/Off by default\. Expert launch overrides/)).toBeInTheDocument();
    fireEvent.click(field);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ flags: { sameAnswerEveryTime: true } });
  },
);
