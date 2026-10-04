/**
 * The two collapsible references on Discover, when the library could not
 * answer: they printed `err.message` -- "HTTP 502 Bad Gateway" -- where
 * the library had written a sentence, and the only retry was closing and
 * reopening the panel, after which the red error stayed above whatever
 * then loaded.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelCard } from "./ModelCard";
import { QuantReference } from "./QuantReference";

let failing: boolean;

beforeEach(() => {
  failing = true;
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const route = String(input)
        .replace(/^\/api\/proxy\//, "")
        .split("?")[0];
      if (failing) {
        return new Response(
          JSON.stringify({
            detail: {
              title: "Hub unreachable",
              status: 502,
              detail: "The model hub did not answer. Try again in a minute.",
            },
          }),
          {
            status: 502,
            statusText: "Bad Gateway",
            headers: { "content-type": "application/json" },
          },
        );
      }
      const body =
        route === "library/v1/catalogue/model/card"
          ? { markdown: "A **helpful** model." }
          : {
              tiers: [
                {
                  tier: "Q4_K_M",
                  nominalBitsPerWeight: 4.8,
                  family: "k_quant",
                  summary: "balanced",
                },
              ],
            };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("About this model", () => {
  it("says what the library said, and a retry that works clears it", async () => {
    render(<ModelCard repo="unsloth/Qwen3.8-27B-GGUF" />);
    fireEvent.click(screen.getByRole("button", { name: /About this model/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The model hub did not answer.");
    expect(alert).not.toHaveTextContent("HTTP 502");

    failing = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(await screen.findByText("helpful")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("What do these version names mean?", () => {
  it("says what the library said, and a retry that works clears it", async () => {
    render(<QuantReference />);
    fireEvent.click(screen.getByRole("button", { name: /What do these version names mean/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The model hub did not answer.");

    failing = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(await screen.findByText("Q4_K_M")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
