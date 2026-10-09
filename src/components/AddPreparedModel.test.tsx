import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import {
  AddPreparedModel,
  folderHolding,
  nameFromEntry,
  preparingEngines,
} from "./AddPreparedModel";
import type { EngineDescriptor } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(async () => ({ folders: [] })), post: vi.fn() },
  describeError: (e: Error) => e.message,
}));
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
