/**
 * LS9: the dot says beside itself when preparing suits this machine better,
 * on Discover's rows and wherever else it stands.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { EligibilityDot } from "./EligibilityDot";
import type { ModelEligibility } from "@/lib/eligibility";

afterEach(cleanup);

function answer(llamaFit: string): ModelEligibility {
  return {
    modelId: "m",
    level: "works_here",
    engines: [
      {
        engine: "llama_cpp",
        verdict: "runs",
        available: true,
        reason: "runs GGUF",
        fit: { estimated: true, verdict: llamaFit, reason: "llama.cpp's arithmetic" },
      },
      {
        engine: "strata",
        verdict: "after_preparation",
        available: true,
        reason: "on its list",
        fit: { estimated: true, verdict: "fits", reason: "setup's table" },
      },
    ],
  } as ModelEligibility;
}

it("says Strata is faster here after preparing, beside the dot", () => {
  render(<EligibilityDot answer={answer("split")} where="Amish_Station" short />);
  expect(screen.getByTestId("better-route")).toHaveTextContent(
    "Faster here with Strata after preparing",
  );
});

it("says nothing more when llama.cpp fits it on the card", () => {
  render(<EligibilityDot answer={answer("fits")} where="Amish_Station" />);
  expect(screen.queryByTestId("better-route")).toBeNull();
});
