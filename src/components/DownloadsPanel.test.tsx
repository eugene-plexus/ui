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

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  it("links to the Library's own settings, where the catalogue token goes", () => {
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
    expect(screen.getByRole("link", { name: "Config" })).toHaveAttribute(
      "href",
      "/config?sel=library",
    );
  });
});

describe("an action the library refused", () => {
  it("shows the library's plain-string sentence, not the status line", async () => {
    answer = { status: 409, body: { detail: "This download has already finished." } };
    render(<DownloadsPanel downloads={[download()]} onChanged={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "pause" }));
    });
    const sentence = await screen.findByText("This download has already finished.");
    expect(sentence).toHaveAttribute("role", "alert");
    expect(screen.queryByText(/HTTP 409/)).toBeNull();
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
