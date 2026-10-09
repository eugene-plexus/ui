import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryModel, ModelProfile } from "@/lib/types";

import { ProfileEditor } from "./ProfileEditor";

afterEach(() => vi.unstubAllGlobals());

const model: LibraryModel = {
  id: "model",
  name: "Example",
  path: "/models/example.gguf",
  format: "gguf",
  status: "present",
  sizeBytes: 100,
  files: [],
};

function setup(flags: Record<string, unknown> = { contextSize: 4096 }) {
  let profile: ModelProfile = {
    id: "p",
    name: "Tuned",
    engine: "llama_cpp",
    default: true,
    maxTokens: 400,
    temperature: 0.7,
    topP: 0.9,
    flags,
  };
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        writes.push(body);
        profile = { ...body, id: "p" };
        return Response.json(profile);
      }
      return Response.json({ profiles: [profile] });
    }),
  );
  render(<ProfileEditor model={model} engines={[]} node={null} onChanged={() => {}} />);
  return writes;
}

it("saves explicit zeroes, clears omitted defaults and preserves launch settings", async () => {
  const writes = setup();
  fireEvent.click(await screen.findByRole("button", { name: "edit" }));
  expect(screen.getByLabelText("Maximum output tokens")).toHaveValue(400);
  fireEvent.change(screen.getByLabelText("Maximum output tokens"), { target: { value: "123" } });
  fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("Top-p"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "save" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({
    maxTokens: 123,
    temperature: 0,
    topP: 0,
    flags: { contextSize: 4096 },
    default: true,
  });
  fireEvent.click(await screen.findByRole("button", { name: "edit" }));
  fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Top-p"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "save" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).not.toHaveProperty("temperature");
  expect(writes[1]).not.toHaveProperty("topP");
  expect(writes[1]).toHaveProperty("maxTokens", 123);
});

it("saves an old checkbox's Flash attention as what it always did (agent#6)", async () => {
  // True sent on; false sent nothing, which was llama.cpp's own choice.
  const writes = setup({ contextSize: 4096, flashAttention: false, threads: 8 });
  fireEvent.click(await screen.findByRole("button", { name: "edit" }));
  fireEvent.click(screen.getByRole("button", { name: "save" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ flags: { contextSize: 4096, threads: 8 } });
  expect((writes[0]?.flags as Record<string, unknown>).flashAttention).toBeUndefined();
});

it("saves an old checkbox's ticked Flash attention as on", async () => {
  const writes = setup({ contextSize: 4096, flashAttention: true });
  fireEvent.click(await screen.findByRole("button", { name: "edit" }));
  fireEvent.click(screen.getByRole("button", { name: "save" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ flags: { contextSize: 4096, flashAttention: "on" } });
});

/**
 * A profile row whose delete is recorded rather than served, so the test
 * can say whether one click reached the library.
 */
function setupDelete() {
  const profile: ModelProfile = {
    id: "p",
    name: "Tuned",
    engine: "llama_cpp",
    default: false,
    flags: { contextSize: 4096 },
  };
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") calls.push(`${method} ${url}`);
      if (method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ profiles: [profile] });
    }),
  );
  render(<ProfileEditor model={model} engines={[]} node={null} onChanged={() => {}} />);
  return calls;
}

it("asks before deleting a profile, and one click deletes nothing", async () => {
  const calls = setupDelete();
  fireEvent.click(await screen.findByRole("button", { name: "delete" }));
  await new Promise((r) => setTimeout(r, 30));
  expect(calls.filter((c) => c.startsWith("DELETE"))).toEqual([]);
  // What is lost, in the prompt: the settings are not on disk anywhere else.
  expect(screen.getByRole("group", { name: "Confirm" })).toHaveTextContent("Tuned");
});

it("deletes on the second click", async () => {
  const calls = setupDelete();
  fireEvent.click(await screen.findByRole("button", { name: "delete" }));
  fireEvent.click(
    within(screen.getByRole("group", { name: "Confirm" })).getByRole("button", {
      name: "delete",
    }),
  );
  await waitFor(() =>
    expect(calls).toContain("DELETE /api/proxy/library/v1/models/model/profiles/p"),
  );
});

it("shows a Problem's title when that is all the library wrote", async () => {
  // RFC 7807 makes `detail` optional; a bare `{title}` is a whole sentence
  // the old helper dropped for the status line.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ title: "This model is no longer in the library.", status: 404 }),
          {
            status: 404,
            statusText: "404",
            headers: { "content-type": "application/json" },
          },
        ),
    ),
  );
  render(<ProfileEditor model={model} engines={[]} node={null} onChanged={() => {}} />);
  const sentence = await screen.findByText("This model is no longer in the library.");
  expect(sentence).toHaveAttribute("role", "alert");
  expect(screen.queryByText(/HTTP 404/)).toBeNull();
});

it("refuses invalid generation values before writing", async () => {
  const writes = setup();
  fireEvent.click(await screen.findByRole("button", { name: "edit" }));
  fireEvent.change(screen.getByLabelText("Maximum output tokens"), { target: { value: "1.5" } });
  fireEvent.click(screen.getByRole("button", { name: "save" }));
  expect(await screen.findByText(/must be a whole number/)).toBeInTheDocument();
  expect(writes).toHaveLength(0);
});

it("launches once, however fast the button is pressed twice", async () => {
  const profile: ModelProfile = {
    id: "p",
    name: "Tuned",
    engine: "llama_cpp",
    default: true,
    flags: { contextSize: 4096 },
  };
  let finish!: () => void;
  const posted: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/agent/v1/runtimes")) {
        posted.push(url);
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return Response.json({ name: "model-tuned", status: "starting" }, { status: 201 });
      }
      return Response.json({ profiles: [profile] });
    }),
  );
  render(
    <ProfileEditor
      model={model}
      engines={[{ engine: "llama_cpp", available: true, modelFormats: ["gguf"] }] as never}
      node={null}
      onChanged={() => {}}
    />,
  );
  const button = await screen.findByRole("button", { name: "launch" });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(posted).toHaveLength(1));
  // The same derived name twice: one green "Starting", one red 409.
  expect(screen.getByRole("button", { name: "launching…" })).toBeDisabled();
  finish();
  await screen.findByText(/Starting/);
  expect(posted).toHaveLength(1);
});

// LS3: a second prepared Strata model is declared stopped, to switch to,
// rather than loaded beside the first.
it("adds a runtime stopped, without starting it", async () => {
  const profile: ModelProfile = { id: "p", name: "default", engine: "strata", default: true };
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST" && url.endsWith("/agent/v1/runtimes")) {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({ name: "qwen-flash", status: "stopped" }, { status: 201 });
      }
      return Response.json({ profiles: [profile] });
    }),
  );
  render(
    <ProfileEditor
      model={model}
      engines={[{ engine: "strata", available: true, modelFormats: ["prepared"] }] as never}
      node={null}
      onChanged={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "add stopped" }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ engine: "strata", autoStart: false });
  expect(await screen.findByText(/stopped\. Start it, or switch to it/)).toBeInTheDocument();
});

// Settings never lie (2026-09-30): an unset flag is not its schema default,
// and a profile's engine is shown even when this machine does not offer it.
it("shows an unset flag as unset, and a profile's own engine as itself", async () => {
  let profile: ModelProfile = {
    id: "p",
    name: "Tuned",
    engine: "vllm",
    default: false,
    flags: {},
    maxTokens: 64,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ profiles: [profile] })),
  );
  const engines = [
    {
      engine: "llama_cpp",
      flagSchema: {
        component: "llama_cpp",
        fields: [
          {
            key: "parallelSlots",
            label: "Parallel slots",
            category: "engine",
            valueType: "integer",
            default: 1,
            sensitive: false,
            required: false,
            requiresRestart: false,
            pendingRestart: false,
          },
        ],
      },
    },
  ] as unknown as Parameters<typeof ProfileEditor>[0]["engines"];
  render(<ProfileEditor model={model} engines={engines} node={null} onChanged={() => {}} />);
  // Stored generation values on a profile that is not the default are not in use.
  expect(await screen.findByTestId("profile-generation")).toHaveTextContent("not in use");
  fireEvent.click(await screen.findByRole("button", { name: "edit" }));
  const engine = screen.getByDisplayValue("vllm (not offered by this machine)");
  expect(engine).toBeInTheDocument();
  fireEvent.change(engine, { target: { value: "llama_cpp" } });
  expect(screen.getByRole("spinbutton", { name: "Parallel slots" })).toHaveValue(null);
  expect(screen.getByTestId("unset-parallelSlots")).toHaveTextContent("lists its default as 1");
  profile = { ...profile };
});

/**
 * A3c: a new profile for a mixture-of-experts model on a card smaller than
 * its file. Admission has no whole-card number (0), so the form starts at
 * the library's experts-in-RAM context -- and the note under it must say
 * that is what it is, not "the largest context at which this file fits
 * entirely", which would be a setting that lies.
 */
describe("a new profile for a model that runs with its experts in system memory", () => {
  const GIB = 1024 ** 3;
  const engines = [
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
  ] as unknown as Parameters<typeof ProfileEditor>[0]["engines"];
  const node = {
    name: "laptop",
    label: "laptop",
    local: true,
    target: "agent",
    reachable: true,
    lastError: null,
    budget: null,
  };

  function serve(fitOffload: string) {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        asked.push(`${method} ${url}`);
        if (url.endsWith("/agent/v1/runtimes/admission")) {
          return Response.json({ decision: "admit", fit: "split", maxContextLength: 0 });
        }
        if (url.endsWith("/agent/v1/node")) {
          return Response.json({
            devices: [
              { kind: "cuda", memoryTotalBytes: 8 * GIB, memoryFreeBytes: 7 * GIB },
              { kind: "cpu", memoryTotalBytes: 32 * GIB, memoryFreeBytes: 24 * GIB },
            ],
          });
        }
        if (url.includes("/library/v1/models/model/fit")) {
          return Response.json({
            fit: { verdict: "split", offload: fitOffload, contextLength: 8192 },
            maxContextExpertsInRam: 24576,
          });
        }
        return Response.json({ profiles: [] });
      }),
    );
    render(
      <ProfileEditor
        model={{ ...model, contextLength: 262144 }}
        engines={engines}
        node={node}
        onChanged={() => {}}
      />,
    );
    return asked;
  }

  it("starts at the experts-in-RAM context and says which way it was worked out", async () => {
    const asked = serve("experts");
    fireEvent.click(await screen.findByRole("button", { name: "new profile" }));
    const note = await screen.findByTestId("context-prefill-note");
    expect(note).toHaveTextContent("contextSize starts at 24,576");
    expect(note).toHaveTextContent("the experts in system memory");
    expect(note).not.toHaveTextContent("fits entirely");
    expect(screen.getByRole("spinbutton", { name: "Context size" })).toHaveValue(24576);
    // Scored against the node's own devices, not the library's host.
    expect(asked.some((a) => a.includes("vramBytes=" + 7 * GIB))).toBe(true);
  });

  it("starts empty for a dense spill, as before", async () => {
    serve("layers");
    fireEvent.click(await screen.findByRole("button", { name: "new profile" }));
    await waitFor(() => expect(screen.queryByTestId("context-probe")).toBeNull());
    expect(screen.queryByTestId("context-prefill-note")).toBeNull();
  });
});

/**
 * PB2: a field the settings builder set says so in the edit form, says so
 * again once it is changed, and the save does not drop the builder's
 * record -- it leaves `builtBy` out, which the library reads as "keep".
 */
it("labels the builder's fields while editing, and keeps its record on save", async () => {
  const built: ModelProfile = {
    id: "p",
    name: "Built for laptop",
    engine: "llama_cpp",
    default: true,
    flags: { contextSize: 65536, cacheType: "q8_0" },
    builtBy: {
      buildId: "b",
      node: "laptop",
      accuracy: "high",
      builtAt: "2026-09-30T16:33:13Z",
      flags: { contextSize: 65536, cacheType: "q8_0" },
    },
  };
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        writes.push(JSON.parse(String(init.body)));
        return Response.json(built);
      }
      return Response.json({ profiles: [built] });
    }),
  );
  const engines = [
    {
      engine: "llama_cpp",
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
  ] as unknown as Parameters<typeof ProfileEditor>[0]["engines"];
  render(<ProfileEditor model={model} engines={engines} node={null} onChanged={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "edit" }));
  expect(screen.getByTestId("built-contextSize")).toHaveTextContent(
    /^Set by the settings builder on .+\.$/,
  );
  fireEvent.change(screen.getByRole("spinbutton", { name: "Context size" }), {
    target: { value: "16384" },
  });
  expect(screen.getByTestId("built-contextSize")).toHaveTextContent("and edited since");
  fireEvent.click(screen.getByRole("button", { name: "save" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).not.toHaveProperty("builtBy");
  expect(writes[0]).toMatchObject({ flags: { contextSize: 16384, cacheType: "q8_0" } });
});
