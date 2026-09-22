import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

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

function setup() {
  let profile: ModelProfile = {
    id: "p",
    name: "Tuned",
    engine: "llama_cpp",
    default: true,
    maxTokens: 400,
    temperature: 0.7,
    topP: 0.9,
    flags: { contextSize: 4096 },
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
