import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

it("refuses invalid generation values before writing", async () => {
  const writes = setup();
  fireEvent.click(await screen.findByRole("button", { name: "edit" }));
  fireEvent.change(screen.getByLabelText("Maximum output tokens"), { target: { value: "1.5" } });
  fireEvent.click(screen.getByRole("button", { name: "save" }));
  expect(await screen.findByText(/must be a whole number/)).toBeInTheDocument();
  expect(writes).toHaveLength(0);
});
