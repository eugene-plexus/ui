/**
 * A3c — the starter set's rows and card, driven.
 *
 * A MoE entry's own `maxContextLength` is the whole file on the card,
 * which on a small card is nothing at all; `maxContextExpertsInRam` is the
 * number it runs at. The row offers it, and the recommended card's badge
 * says how it runs rather than calling it a spill.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { StarterSetPanel } from "./StarterSetPanel";

const GIB = 1024 ** 3;

function entry(over: Record<string, unknown>) {
  return {
    baseModel: "Vendor/Model",
    repo: "pub/Model-GGUF",
    file: "m.gguf",
    label: "Q4_K_M",
    why: "most downloaded",
    ...over,
  };
}

const SET = {
  reviewed: "2026-09-30",
  reviewedDaysAgo: 0,
  source: "shipped",
  models: [
    entry({
      sizeClass: "30B MoE",
      baseModel: "Qwen/Qwen3.6-35B-A3B",
      repo: "unsloth/Qwen3.6-35B-A3B-GGUF",
      file: "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
      label: "UD-Q4_K_M",
      sizeBytes: 22.1e9,
      maxContextLength: null,
      maxContextExpertsInRam: 61440,
      fit: {
        verdict: "split",
        offload: "experts",
        requiredBytes: 23 * GIB,
        weightsBytes: 20.6 * GIB,
        kvCacheBytes: 1.4 * GIB,
        overheadBytes: GIB,
        expertBytes: 18.3 * GIB,
        contextLength: 16384,
        basis: "metadata",
      },
    }),
    entry({
      sizeClass: "8B",
      baseModel: "Qwen/Qwen3.5-8B",
      repo: "unsloth/Qwen3.5-8B-GGUF",
      file: "Qwen3.5-8B-Q4_K_M.gguf",
      sizeBytes: 5.0e9,
      maxContextLength: 32768,
      // A dense entry never carries one; a stray value must not be shown.
      maxContextExpertsInRam: 99999,
      fit: {
        verdict: "fits",
        offload: null,
        requiredBytes: 6 * GIB,
        weightsBytes: 4.6 * GIB,
        kvCacheBytes: 0.4 * GIB,
        overheadBytes: GIB,
        expertBytes: 0,
        contextLength: 16384,
        basis: "metadata",
      },
    }),
  ],
  recommended: {
    sizeClass: "30B MoE",
    reason: "Qwen/Qwen3.6-35B-A3B runs here with its experts in system memory.",
  },
};

beforeEach(() => {
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(SET)),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderPanel() {
  render(
    <StarterSetPanel
      budget={null}
      contextLength={16384}
      busy={null}
      onDownload={() => {}}
      onOpenRepo={() => {}}
    />,
  );
}

it("offers a MoE entry the context it runs at with its experts in RAM", async () => {
  renderPanel();
  await waitFor(() => expect(screen.getAllByTestId("starter-row")).toHaveLength(2));
  const moe = screen
    .getAllByTestId("starter-row")
    .find((row) => row.getAttribute("data-size-class") === "30B MoE")!;
  expect(moe).toHaveTextContent("up to 61,440 tokens with experts in RAM");
  expect(within(moe).getByTestId("fit-badge")).toHaveTextContent("experts in RAM at 16k");
});

it("offers a dense entry only its own number", async () => {
  renderPanel();
  await waitFor(() => expect(screen.getAllByTestId("starter-row")).toHaveLength(2));
  const dense = screen
    .getAllByTestId("starter-row")
    .find((row) => row.getAttribute("data-size-class") === "8B")!;
  expect(dense).toHaveTextContent("fits up to 32,768 tokens here");
  expect(dense).not.toHaveTextContent("experts");
});

it("lets the recommended MoE pick's reason say how it runs, and adds no spill word", async () => {
  // The card carries the library's reason, which names what goes where;
  // the row below it carries the badge.
  renderPanel();
  const card = await screen.findByTestId("starter-recommended");
  expect(card).toHaveTextContent("runs here with its experts in system memory");
  expect(card).not.toHaveTextContent("partial offload");
});

it("gives every entry Troy's dot, judged by the Library from what the review recorded", async () => {
  const facts = (id: string) => ({ id, format: "gguf", architecture: "qwen3moe" });
  const withFacts = {
    ...SET,
    models: SET.models.map((m, i) => ({ ...m, facts: facts(`starter:${i}`) })),
  };
  const asked: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/v1/eligibility")) {
        asked.push(JSON.parse(String(init?.body)));
        return Response.json({
          models: [
            { modelId: "starter:0", level: "works_here", engines: [] },
            { modelId: "starter:1", level: "other_engine", engines: [] },
          ],
        });
      }
      return Response.json(withFacts);
    }),
  );
  render(
    <StarterSetPanel
      budget={null}
      engines={[{ engine: "llama_cpp", available: true, accepts: [{ format: "gguf" }] } as never]}
      where="Amish_Station"
      contextLength={16384}
      busy={null}
      onDownload={() => {}}
      onOpenRepo={() => {}}
    />,
  );
  const rows = await screen.findAllByTestId("starter-row");
  await waitFor(() =>
    expect(within(rows[0]!).getByTestId("eligibility-dot")).toHaveTextContent("works here"),
  );
  expect(within(rows[1]!).getByTestId("eligibility-dot")).toHaveTextContent("other engine");
  // The suggestion's card says it in Troy's whole phrase.
  expect(
    within(screen.getByTestId("starter-recommended")).getByTestId("eligibility-dot"),
  ).toHaveTextContent("Will work on this machine now");
  expect((asked[0] as { candidates: { id: string }[] }).candidates.map((c) => c.id)).toEqual([
    "starter:0",
    "starter:1",
  ]);
});

it("says Loading suggestions… in sentence case, then Starting… on the busy pick", async () => {
  const { rerender } = render(
    <StarterSetPanel
      budget={null}
      contextLength={16384}
      busy={null}
      onDownload={() => {}}
      onOpenRepo={() => {}}
    />,
  );
  expect(screen.getByText("Loading suggestions…")).toBeInTheDocument();
  await screen.findByTestId("starter-recommended");
  rerender(
    <StarterSetPanel
      budget={null}
      contextLength={16384}
      busy="unsloth/Qwen3.6-35B-A3B-GGUF"
      onDownload={() => {}}
      onOpenRepo={() => {}}
    />,
  );
  expect(screen.getByTestId("starter-download")).toHaveTextContent("Starting…");
});

it("announces a failed load, with its cause", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ detail: { title: "Library is down" } }, { status: 502 })),
  );
  renderPanel();
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("could not be loaded");
});
