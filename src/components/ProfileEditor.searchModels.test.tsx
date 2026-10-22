/**
 * The profile editor, for a file that is not a chat model (MR3).
 *
 * "Runs as: search model (found in the file)": the Library read the header, the
 * agent reads it again when it starts the model, and a profile can override both.
 * What is tested is what a person sees and what the form writes: the sentence, the
 * four choices, what Auto saves (nothing), and that no other save quietly drops
 * the choice, because a profile is replaced whole.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryModel, ModelProfile } from "@/lib/types";

import { ProfileEditor } from "./ProfileEditor";

afterEach(() => vi.unstubAllGlobals());

const SEARCH_FILE: LibraryModel = {
  id: "embed",
  name: "Qwen3-Embedding-0.6B-Q8_0",
  path: "/models/Qwen3-Embedding-0.6B-Q8_0.gguf",
  format: "gguf",
  status: "present",
  sizeBytes: 639_150_592,
  contextLength: 32768,
  capabilities: { chat: false, embedding: true, rerank: false },
};
const CHAT_FILE: LibraryModel = {
  ...SEARCH_FILE,
  id: "chat",
  name: "Qwen3-0.6B-Q4_K_M",
  contextLength: 40960,
  capabilities: { chat: true, embedding: false, rerank: false },
};

const ENGINES = [
  {
    engine: "llama_cpp",
    available: true,
    modelFormats: ["gguf"],
    flagSchema: {
      component: "llama_cpp",
      fields: [
        {
          key: "contextSize",
          label: "Context size",
          category: "engine",
          valueType: "integer",
          sensitive: false,
          required: false,
          requiresRestart: false,
          pendingRestart: false,
        },
      ],
    },
  },
  { engine: "vllm", available: true, modelFormats: ["safetensors"] },
] as unknown as Parameters<typeof ProfileEditor>[0]["engines"];

const NODE = {
  name: "laptop",
  label: "laptop",
  local: true,
  target: "agent",
  reachable: true,
  lastError: null,
  budget: null,
};

/** A library that keeps profiles and records every write. */
function serve(profiles: ModelProfile[] = [], admission?: Record<string, unknown>) {
  const writes: { method: string; url: string; body: Record<string, unknown> }[] = [];
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      asked.push(`${method} ${url}`);
      if (url.endsWith("/agent/v1/runtimes/admission")) {
        return Response.json(admission ?? { decision: "admit", fit: "fits" });
      }
      if (method === "POST" || method === "PUT") {
        const body = JSON.parse(String(init?.body));
        writes.push({ method, url, body });
        return Response.json({ ...body, id: "saved" }, { status: method === "POST" ? 201 : 200 });
      }
      return Response.json({ profiles });
    }),
  );
  return { writes, asked };
}

function profile(over: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "p",
    name: "default",
    engine: "llama_cpp",
    default: true,
    flags: {},
    authorSampling: true,
    ...over,
  };
}

function renderEditor(model: LibraryModel, node: typeof NODE | null = null) {
  return render(<ProfileEditor model={model} engines={ENGINES} node={node} onChanged={() => {}} />);
}

describe("a new profile for a search model", () => {
  it("says what the file will run as, with Auto chosen", async () => {
    serve();
    renderEditor(SEARCH_FILE);
    fireEvent.click(await screen.findByRole("button", { name: "new profile" }));
    const control = await screen.findByTestId("profile-runs-as-control");
    expect(within(control).getByTestId("runs-as-line")).toHaveTextContent(
      "Runs as: search model (found in the file)",
    );
    expect(within(control).getByRole("combobox", { name: "Runs as" })).toHaveValue("auto");
  });

  it("says a chat file runs as chat, too, so the override is there for it", async () => {
    serve();
    renderEditor(CHAT_FILE);
    fireEvent.click(await screen.findByRole("button", { name: "new profile" }));
    expect(await screen.findByTestId("runs-as-line")).toHaveTextContent(
      "Runs as: chat model (found in the file)",
    );
  });

  it("saves nothing for Auto: absent already means Auto", async () => {
    const { writes } = serve();
    renderEditor(SEARCH_FILE);
    fireEvent.click(await screen.findByRole("button", { name: "new profile" }));
    fireEvent.click(await screen.findByRole("button", { name: "create" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.method).toBe("POST");
    expect(writes[0]!.body).not.toHaveProperty("mode");
  });

  it("saves the person's choice, in the contract's word", async () => {
    const { writes } = serve();
    renderEditor(SEARCH_FILE);
    fireEvent.click(await screen.findByRole("button", { name: "new profile" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Runs as" }), {
      target: { value: "reranking" },
    });
    expect(screen.getByTestId("runs-as-line")).toHaveTextContent(
      "Runs as: result sorter (you chose this)",
    );
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.body).toMatchObject({ mode: "reranking", engine: "llama_cpp" });
  });

  it("lets a person say Chat for a file whose header says search", async () => {
    const { writes } = serve();
    renderEditor(SEARCH_FILE);
    fireEvent.click(await screen.findByRole("button", { name: "new profile" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Runs as" }), {
      target: { value: "chat" },
    });
    expect(screen.getByTestId("runs-as-line")).toHaveTextContent(
      "Runs as: chat model (you chose this)",
    );
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.body).toMatchObject({ mode: "chat" });
  });

  it("does not size a search model to the card: it starts with its own window", async () => {
    const { asked } = serve([], { decision: "admit", fit: "fits", maxContextLength: 12000 });
    renderEditor(SEARCH_FILE, NODE);
    fireEvent.click(await screen.findByRole("button", { name: "new profile" }));
    await screen.findByRole("combobox", { name: "Runs as" });
    // The probe that asks the node what context fits is not made, and nothing is prefilled.
    expect(screen.queryByTestId("context-probe")).toBeNull();
    expect(screen.queryByTestId("context-prefill-note")).toBeNull();
    expect(screen.getByRole("spinbutton", { name: "Context size" })).toHaveValue(null);
    expect(asked.filter((a) => a.includes("/runtimes/admission"))).toEqual([]);
  });

  it("still sizes a chat model to the card, as before", async () => {
    const { asked } = serve([], { decision: "admit", fit: "fits", maxContextLength: 12000 });
    renderEditor(CHAT_FILE, NODE);
    fireEvent.click(await screen.findByRole("button", { name: "new profile" }));
    await screen.findByRole("combobox", { name: "Runs as" });
    await waitFor(() =>
      expect(asked.filter((a) => a.includes("/runtimes/admission")).length).toBeGreaterThan(0),
    );
  });

  it("says what a search model starts with, and that its own settings win", async () => {
    serve();
    renderEditor(SEARCH_FILE);
    fireEvent.click(await screen.findByRole("button", { name: "new profile" }));
    const starts = await screen.findByTestId("runs-as-starts");
    expect(starts).toHaveTextContent("4 requests of 1,024 tokens");
    expect(starts).toHaveTextContent("unless you set");
  });

  it("offers no override for an engine that cannot start a search model", async () => {
    const { writes } = serve([profile({ engine: "vllm", mode: "embedding" })]);
    renderEditor(SEARCH_FILE);
    fireEvent.click(await screen.findByRole("button", { name: "edit" }));
    expect(screen.getByDisplayValue("vllm")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-runs-as-control")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    // Not saved for vLLM, which would refuse it: the agent refuses `embedding` there.
    expect(writes[0]!.body).not.toHaveProperty("mode");
  });
});

describe("a saved profile with a mode", () => {
  it("says on its row what it runs as when a person chose, and nothing when Auto", async () => {
    serve([
      profile({ id: "a", name: "sorter", mode: "reranking", default: true }),
      profile({ id: "b", name: "plain", default: false }),
      profile({ id: "c", name: "said auto", mode: "auto", default: false }),
    ]);
    renderEditor(SEARCH_FILE);
    const lines = await screen.findAllByTestId("profile-runs-as");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent("Runs as: result sorter (you chose this)");
  });

  it("shows the choice in the form, and a save without changing it keeps it", async () => {
    const { writes } = serve([profile({ mode: "reranking" })]);
    renderEditor(SEARCH_FILE);
    fireEvent.click(await screen.findByRole("button", { name: "edit" }));
    expect(screen.getByRole("combobox", { name: "Runs as" })).toHaveValue("reranking");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.method).toBe("PUT");
    expect(writes[0]!.body).toMatchObject({ mode: "reranking" });
  });

  it("clears it when Auto is chosen: a replace that omits a field removes it", async () => {
    const { writes } = serve([profile({ mode: "chat" })]);
    renderEditor(SEARCH_FILE);
    fireEvent.click(await screen.findByRole("button", { name: "edit" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Runs as" }), {
      target: { value: "auto" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.body).not.toHaveProperty("mode");
  });

  it("is kept when the launch preview's Set contextSize rewrites the profile", async () => {
    // The button replaces the whole profile with one copy field by field, and a field
    // it did not carry would be lost: the person's choice, said once, gone.
    const { writes } = serve([profile({ mode: "chat", flags: { contextSize: 8192 } })], {
      decision: "refuse",
      fit: "no",
      reason: "does not fit",
      contextLength: 8192,
      maxContextLength: 2048,
    });
    renderEditor(CHAT_FILE, NODE);
    fireEvent.click(await screen.findByTestId("set-context"));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.body).toMatchObject({ mode: "chat", flags: { contextSize: 2048 } });
  });
});

describe("the tools for chat models", () => {
  it("are not offered for a search model, which does not write", async () => {
    serve([profile({ id: "a", name: "default" })]);
    renderEditor(SEARCH_FILE);
    await screen.findByRole("button", { name: "edit" });
    expect(screen.queryByTestId("profile-builder")).toBeNull();
    expect(screen.queryByRole("button", { name: /Build settings/i })).toBeNull();
  });

  it("are still there for a chat model", async () => {
    serve([profile({ id: "a", name: "default" })]);
    renderEditor(CHAT_FILE, NODE);
    await screen.findByRole("button", { name: "edit" });
    expect(screen.getByRole("button", { name: /Build settings/i })).toBeInTheDocument();
  });
});
