/**
 * The profile editor and the prompt cache settings (row 9, PC7).
 *
 * Eugene passes `--cache-ram`, `--cache-reuse` and `--ctx-checkpoints` on every start, so a
 * profile that leaves one unset still runs with the default. The editor must say that, not
 * "not passed, so the engine decides" (a setting never shows a value other than the one in
 * effect), and a profile that leaves them alone must save nothing for them.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryModel, ModelProfile } from "@/lib/types";

import { ProfileEditor } from "./ProfileEditor";

afterEach(() => vi.unstubAllGlobals());

const MODEL: LibraryModel = {
  id: "chat",
  name: "Qwen3-0.6B-Q4_K_M",
  path: "/models/Qwen3-0.6B-Q4_K_M.gguf",
  format: "gguf",
  status: "present",
  sizeBytes: 400_000_000,
  contextLength: 40960,
  capabilities: { chat: true, embedding: false, rerank: false },
};

const FIELD = {
  category: "memory",
  sensitive: false,
  required: false,
  requiresRestart: true,
  pendingRestart: false,
};

// As the agent's llama.cpp adapter serves them.
const ENGINES = [
  {
    engine: "llama_cpp",
    available: true,
    modelFormats: ["gguf"],
    flagSchema: {
      component: "engine:llama_cpp",
      fields: [
        { ...FIELD, key: "contextSize", label: "Context size", valueType: "integer" },
        {
          ...FIELD,
          key: "cacheRam",
          label: "Prompt cache in system memory",
          valueType: "number",
          minimum: 0,
          default: 8,
          unsetMeans: "Not set: 8 GiB, llama.cpp's own default, which Eugene passes.",
        },
        {
          ...FIELD,
          key: "cacheReuse",
          label: "Reuse moved text",
          valueType: "integer",
          minimum: 0,
          default: 0,
          unsetMeans: "Not set: 0, off, llama.cpp's own default, which Eugene passes.",
        },
      ],
    },
  },
] as unknown as Parameters<typeof ProfileEditor>[0]["engines"];

function serve() {
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST" || method === "PUT") {
        const body = JSON.parse(String(init?.body));
        writes.push(body);
        return Response.json({ ...body, id: "saved" }, { status: method === "POST" ? 201 : 200 });
      }
      return Response.json({ profiles: [] as ModelProfile[] });
    }),
  );
  return writes;
}

function renderEditor() {
  return render(<ProfileEditor model={MODEL} engines={ENGINES} node={null} onChanged={() => {}} />);
}

describe("the prompt cache settings on a profile", () => {
  it("say what an unset value does: the default is passed", async () => {
    serve();
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "new profile" }));
    const ram = await screen.findByRole("spinbutton", { name: "Prompt cache in system memory" });
    expect(ram).toBeInTheDocument();
    expect(
      screen.getByText("Not set: 8 GiB, llama.cpp's own default, which Eugene passes."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Not set: 0, off, llama.cpp's own default, which Eugene passes."),
    ).toBeInTheDocument();
    // Context size says "not passed", as every flag nothing is passed for does: the one match.
    // The two cache settings are passed, so they must not.
    expect(screen.queryAllByText(/Not set: not passed/)).toHaveLength(1);
  });

  it("save nothing when left alone, and the size when set", async () => {
    const writes = serve();
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "new profile" }));
    fireEvent.click(await screen.findByRole("button", { name: "create" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toHaveProperty("flags", {});

    fireEvent.click(await screen.findByRole("button", { name: "new profile" }));
    fireEvent.change(
      await screen.findByRole("spinbutton", { name: "Prompt cache in system memory" }),
      {
        target: { value: "24" },
      },
    );
    fireEvent.click(await screen.findByRole("button", { name: "create" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toHaveProperty("flags", { cacheRam: 24 });
  });
});
