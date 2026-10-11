import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import {
  AddPreparedModel,
  describeDraft,
  folderHolding,
  nameFromEntry,
  preparingEngines,
  samePath,
} from "./AddPreparedModel";
import { api, ApiError } from "@/lib/api";
import type { EngineDescriptor } from "@/lib/types";

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly statusText: string,
      public readonly body: unknown,
    ) {
      super(String(body));
    }
  }
  return {
    ApiError,
    api: { get: vi.fn(async () => ({ folders: [{ path: "D:\\Models" }] })), post: vi.fn() },
    describeError: (e: Error) => e.message,
  };
});
afterEach(cleanup);

const LLAMA = { engine: "llama_cpp", accepts: [{ format: "gguf" }] } as EngineDescriptor;
const STRATA = {
  engine: "strata",
  accepts: [{ format: "prepared", preparedFor: "strata" }],
} as EngineDescriptor;

it("offers only the engines that load prepared models", () => {
  expect(preparingEngines([LLAMA, STRATA]).map((e) => e.engine)).toEqual(["strata"]);
  expect(preparingEngines(null)).toEqual([]);
});

it("names a model for its configuration file", () => {
  expect(nameFromEntry("D:\\Strata\\strata-qwen.json")).toBe("strata-qwen");
  expect(nameFromEntry("/srv/strata/My Model.JSON")).toBe("My-Model");
});

it("finds the Library folder an entry lies in, as Windows compares paths", () => {
  expect(folderHolding("d:\\models\\strata\\x.json", ["D:\\Models"])).toBe("D:\\Models");
  expect(folderHolding("D:\\Models2\\x.json", ["D:\\Models"])).toBeNull();
  expect(folderHolding("/srv/Models/x.json", ["/srv/models"])).toBeNull();
});

it("says so when no engine on the node loads prepared models", () => {
  render(
    <AddPreparedModel
      engines={[LLAMA]}
      target="agent"
      models={[]}
      eligibility={null}
      where="Amish_Station"
      onAdded={() => {}}
      onClose={() => {}}
    />,
  );
  expect(screen.getByTestId("add-prepared")).toHaveTextContent(
    "No engine on Amish_Station loads prepared models",
  );
});

it("compares two spellings of one path as Windows does", () => {
  expect(samePath("D:\\Models\\x.gguf", "d:/models/x.gguf/")).toBe(true);
  expect(samePath("/srv/Models/x", "/srv/models/x")).toBe(false);
});

it("says in one line what the engine read", () => {
  expect(
    describeDraft({
      engine: "strata",
      entry: "x.json",
      title: "Qwen IQ2",
      contextLength: 131072,
      mode: "every expert in RAM",
      files: [
        { path: "a", sizeBytes: 2_000_000_000, shared: false },
        { path: "b", sizeBytes: 1_000_000_000, shared: true },
      ],
    }),
  ).toBe("Qwen IQ2 · 131,072 tokens of context · every expert in RAM · 2 files, 3.0 GB");
  expect(describeDraft({ engine: "strata", entry: "x.json" })).toBe("");
});

it("refuses a file the engine says it cannot use, naming why", async () => {
  vi.mocked(api.post).mockRejectedValueOnce(
    new ApiError(422, "Unprocessable", "not one of Strata's configurations: it has no `args` list"),
  );
  render(
    <AddPreparedModel
      engines={[STRATA]}
      target="agent"
      models={[]}
      eligibility={null}
      where="Amish_Station"
      onAdded={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByText(/Beside the configuration file|D:\\Models/);
  fireEvent.change(screen.getByLabelText(/configuration file/), {
    target: { value: "D:\\Models\\notes.json" },
  });
  const refused = await screen.findByTestId("prepared-unread", {}, { timeout: 2000 });
  expect(refused).toHaveTextContent("Strata cannot use this file: not one of Strata");
  expect(vi.mocked(api.post)).toHaveBeenCalledWith("agent", "/v1/engines/strata/prepared/inspect", {
    entry: "D:\\Models\\notes.json",
  });
  expect(screen.getByRole("button", { name: "Add model" })).toBeDisabled();
});
