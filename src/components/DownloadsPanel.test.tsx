/**
 * The downloads panel's two pieces of wiring that pointed nowhere.
 *
 * Both are driven through the panel, which is the component that holds
 * them: the gated-repo sentence's link (which opened an empty Config
 * page, because a bare `/config` selects nothing), and the error an
 * action shows (which printed "HTTP 409" when the library had written a
 * plain-string sentence, since the panel's own helper read only the
 * nested Problem shape).
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TargetNode } from "@/lib/nodeBudget";
import type { Download } from "@/lib/types";

import { DownloadsPanel } from "./DownloadsPanel";

function download(over: Partial<Download> = {}): Download {
  return {
    id: "d1",
    repo: "google/gemma-3-27b-it-GGUF",
    state: "downloading",
    files: [
      {
        path: "gemma-3-27b-it-Q4_K_M.gguf",
        destinationPath: "Y:\\models\\gemma-3-27b-it-Q4_K_M.gguf",
        state: "downloading",
      },
    ],
    bytesTotal: 100,
    bytesDownloaded: 40,
    ...over,
  };
}

let answer: { status: number; body: unknown };

beforeEach(() => {
  answer = { status: 200, body: {} };
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(answer.body), {
          status: answer.status,
          statusText: String(answer.status),
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("a download of a gated model", () => {
  it("links to the Library's own settings, where each hub's token goes", () => {
    render(
      <DownloadsPanel
        downloads={[
          download({
            state: "failed",
            error: "This model needs you to accept its licence first.",
            errorCode: "GatedRepo",
          }),
        ]}
        onChanged={() => {}}
      />,
    );
    // LS4: tokens are per hub, in the sources list.
    expect(screen.getByRole("link", { name: "Where to find models" })).toHaveAttribute(
      "href",
      "/config?sel=library#catalogueSources",
    );
  });
});

describe("an action the library refused", () => {
  it("shows the library's plain-string sentence, not the status line", async () => {
    answer = { status: 409, body: { detail: "This download has already finished." } };
    render(<DownloadsPanel downloads={[download()]} onChanged={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause google/gemma-3-27b-it-GGUF" }));
    });
    const sentence = await screen.findByText("This download has already finished.");
    expect(sentence).toHaveAttribute("role", "alert");
    expect(screen.queryByText(/HTTP 409/)).toBeNull();
  });
});

describe("a row's progress bar", () => {
  it("is named after the download and reports its percentage", () => {
    render(<DownloadsPanel downloads={[download()]} onChanged={() => {}} />);
    const bar = screen.getByRole("progressbar", {
      name: "Downloading google/gemma-3-27b-it-GGUF",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "40");
  });

  it("is indeterminate, not 0%, while the size is not known", () => {
    render(
      <DownloadsPanel
        downloads={[download({ bytesTotal: undefined, bytesDownloaded: 5_000_000 })]}
        onChanged={() => {}}
      />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("aria-valuetext", expect.stringContaining("size not known"));
  });
});

describe("a row's speed and time left", () => {
  it("are shown while bytes are moving, in the tray's units", () => {
    render(
      <DownloadsPanel
        downloads={[download({ bytesPerSecond: 38_120_000, etaSeconds: 240 })]}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByText("38 MB/s")).toBeInTheDocument();
    expect(screen.getByText("4 min left")).toBeInTheDocument();
  });

  it.each(["paused", "failed", "done", "verifying"] as const)(
    "are not shown on a %s row, although the record keeps the last rate",
    (state) => {
      render(
        <DownloadsPanel
          downloads={[download({ state, bytesPerSecond: 97_000_000, etaSeconds: 30 })]}
          onChanged={() => {}}
        />,
      );
      expect(screen.queryByText(/\/s$/)).toBeNull();
      expect(screen.queryByText(/left$/)).toBeNull();
    },
  );
});

describe("a row's buttons", () => {
  it("name their download, in sentence case", () => {
    render(<DownloadsPanel downloads={[download()]} onChanged={() => {}} />);
    const repo = "google/gemma-3-27b-it-GGUF";
    expect(screen.getByRole("button", { name: `Pause ${repo}` })).toHaveTextContent(/^Pause$/);
    expect(screen.getByRole("button", { name: `Cancel ${repo}` })).toHaveTextContent(/^Cancel$/);
  });

  it("name Resume and Keep too, once cancelling is asked", () => {
    render(<DownloadsPanel downloads={[download({ state: "paused" })]} onChanged={() => {}} />);
    const repo = "google/gemma-3-27b-it-GGUF";
    expect(screen.getByRole("button", { name: `Resume ${repo}` })).toHaveTextContent(/^Resume$/);
    fireEvent.click(screen.getByRole("button", { name: `Cancel ${repo}` }));
    expect(screen.getByRole("button", { name: `Keep ${repo}` })).toHaveTextContent(/^Keep$/);
    expect(screen.getByRole("button", { name: `Delete partial of ${repo}` })).toHaveTextContent(
      /^Delete partial$/,
    );
  });
});

describe("a failed download", () => {
  it("announces its error", () => {
    render(
      <DownloadsPanel
        downloads={[download({ state: "failed", error: "The disk is full." })]}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByText("The disk is full.")).toHaveAttribute("role", "alert");
  });
});

describe("a row's destination folder", () => {
  it("has a copy button that names the download", () => {
    render(
      <DownloadsPanel
        downloads={[download({ destinationDirectory: "Y:/models" })]}
        onChanged={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Copy folder of google/gemma-3-27b-it-GGUF" }),
    ).toBeInTheDocument();
  });

  it("has none when the record carries no folder", () => {
    render(<DownloadsPanel downloads={[download()]} onChanged={() => {}} />);
    expect(screen.queryByRole("button", { name: /Copy folder/ })).toBeNull();
  });
});

describe("a finished download's Run (ui#17)", () => {
  const node: TargetNode = {
    name: "n1",
    label: "n1",
    local: true,
    target: "agent",
    reachable: true,
    lastError: null,
    budget: null,
  };
  const finished = download({ state: "done", modelId: "m1" });

  function verdict(engine: string, over: Record<string, unknown>) {
    return {
      engine,
      available: true,
      installable: false,
      experimental: false,
      verdict: "runs",
      reason: "ok",
      ...over,
    };
  }

  function serve(eligibility: { status: number; body: unknown }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const reply = (status: number, body: unknown) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });
        if (url.includes("/v1/engines")) {
          return reply(200, {
            engines: [
              { engine: "llama.cpp", available: true, accepts: [] },
              { engine: "strata", available: true, accepts: [] },
            ],
          });
        }
        if (url.includes("/v1/eligibility")) return reply(eligibility.status, eligibility.body);
        if (url.includes("/v1/models/m1")) {
          return reply(200, { id: "m1", name: "Big", status: "present" });
        }
        return reply(200, {});
      }),
    );
  }

  it("links to the model's page when preparing suits this machine better", async () => {
    serve({
      status: 200,
      body: {
        models: [
          {
            modelId: "m1",
            level: "works_here",
            engines: [
              verdict("llama.cpp", { fit: { estimated: true, verdict: "split", reason: "x" } }),
              verdict("strata", {
                verdict: "after_preparation",
                fit: { estimated: true, verdict: "fits", reason: "y" },
              }),
            ],
          },
        ],
      },
    });
    render(<DownloadsPanel downloads={[finished]} onChanged={() => {}} node={node} />);
    const link = await screen.findByRole("link", { name: /Run from its page/ });
    expect(link).toHaveTextContent(
      "Run from its page: Strata suits this machine better after preparing",
    );
    expect(link).toHaveAttribute("href", "/library?model=m1");
    expect(screen.queryByTestId("run-button")).toBeNull();
  });

  it("keeps Run when the engine as it is fits", async () => {
    serve({
      status: 200,
      body: {
        models: [
          {
            modelId: "m1",
            level: "works_here",
            engines: [
              verdict("llama.cpp", { fit: { estimated: true, verdict: "fits", reason: "x" } }),
            ],
          },
        ],
      },
    });
    render(<DownloadsPanel downloads={[finished]} onChanged={() => {}} node={node} />);
    expect(await screen.findByTestId("run-button")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Run from its page/ })).toBeNull();
  });

  it("keeps Run, saying nothing, when the judge cannot be asked", async () => {
    serve({ status: 500, body: { detail: "down" } });
    render(<DownloadsPanel downloads={[finished]} onChanged={() => {}} node={node} />);
    await waitFor(() => expect(screen.getByTestId("run-button")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /Run from its page/ })).toBeNull();
  });
});
