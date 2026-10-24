import { expect, it } from "vitest";

import { sameAnswerLine } from "./sameAnswer";
import { ACTS_WHEN_UNSET } from "./speculation";

it("shows the running launch's setting and the one-slot cost", () => {
  expect(
    sameAnswerLine({ engine: "llama_cpp", status: "ready", flags: { sameAnswerEveryTime: true } }),
  ).toBe("Same answer every time: on; one request at a time; others wait.");
  expect(
    sameAnswerLine({ engine: "vllm", status: "loading", flags: { sameAnswerEveryTime: true } }),
  ).toBe("Same answer every time: batch-invariant mode on.");
  expect(
    sameAnswerLine({ engine: "vllm", status: "ready", flags: { sameAnswerEveryTime: false } }),
  ).toBe("Same answer every time: off.");
});

it("does not claim an unlaunched, stopped, or unknown setting is in effect", () => {
  for (const status of ["stopped", "crashed", "exited", "copying"] as const) {
    expect(
      sameAnswerLine({ engine: "llama_cpp", status, flags: { sameAnswerEveryTime: true } }),
    ).toBeNull();
  }
  expect(sameAnswerLine(undefined)).toBeNull();
  expect(sameAnswerLine(null)).toBeNull();
  expect(sameAnswerLine({ engine: "vllm", status: "ready", flags: {} })).toBeNull();
  expect(ACTS_WHEN_UNSET.has("sameAnswerEveryTime")).toBe(true);
});
