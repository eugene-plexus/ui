/**
 * Pause and Resume on the machine card (row 35): what the card says, as in
 * effect on that machine, and that each goes to that machine's agent.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api";
import {
  pauseLine,
  pausePrompt,
  pauseSentence,
  resumeSentence,
  trayChannelLine,
} from "@/lib/modelPause";

import { ModelPause } from "./ModelPause";

afterEach(() => vi.restoreAllMocks());

const SINCE = "2026-10-27T20:14:00";

describe("the words", () => {
  it("says where the pause came from and since when", () => {
    const now = new Date("2026-10-27T21:00:00");
    const tray = pauseLine({ paused: true, by: "tray", since: SINCE, runtimes: [] }, now);
    expect(tray).toMatch(/^Models paused from the tray icon since /);
    expect(tray).toContain(
      new Date(SINCE).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    );
    expect(pauseLine({ paused: true, by: "console", since: SINCE }, now)).toMatch(
      /^Models paused from the console since /,
    );
    expect(pauseLine({ paused: false })).toBeNull();
    expect(pauseLine(undefined)).toBeNull();
  });

  it("asks before a pause, naming the machine", () => {
    expect(pausePrompt("Amish_Station")).toBe(
      "Pause the models on Amish_Station? Answers in progress there stop. Eugene keeps serving everything else.",
    );
  });

  it("names each model Resume could not start", () => {
    expect(
      resumeSentence([
        { name: "small", state: "started" },
        { name: "coder", state: "started" },
        {
          name: "qwen3-30b",
          state: "refused",
          detail: "not enough GPU memory (21.4 GB needed, 9.8 GB free).",
        },
      ]),
    ).toBe(
      "Resumed 2 of 3 models. qwen3-30b: not enough GPU memory (21.4 GB needed, 9.8 GB free).",
    );
    expect(resumeSentence([])).toBe("Resumed. No models were stopped by the pause.");
  });

  it("counts what Pause stopped and names what it could not", () => {
    expect(pauseSentence([])).toBe("Models paused. None was running.");
    expect(pauseSentence([{ name: "a", state: "stopped" }])).toBe(
      "Models paused. 1 model stopped.",
    );
    expect(pauseSentence([{ name: "a", state: "failed", detail: "Could not stop it: busy" }])).toBe(
      "a: Could not stop it: busy.",
    );
  });

  it("warns only when another program holds the tray's channel", () => {
    expect(trayChannelLine({ paused: false, trayChannel: "taken" })).toMatch(/another program/);
    expect(trayChannelLine({ paused: false, trayChannel: "serving" })).toBeNull();
    expect(trayChannelLine({ paused: false })).toBeNull();
  });
});

describe("ModelPause", () => {
  it("offers nothing on an agent that cannot pause", () => {
    const { container } = render(
      <ModelPause name="old" target="node:old" pause={undefined} onChanged={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("asks, then pauses through that machine's agent", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({
      pause: { paused: true, by: "console", since: SINCE, runtimes: ["qwen"] },
      results: [{ name: "qwen", state: "stopped" }],
    });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <ModelPause
        name="gamer"
        target="node:gamer"
        pause={{ paused: false, trayChannel: "serving" }}
        onChanged={onChanged}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Pause models on gamer" }));
    expect(screen.getByTestId("model-pause-prompt")).toHaveTextContent(
      "Pause the models on gamer? Answers in progress there stop.",
    );
    expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("model-pause-confirm"));
    expect(post).toHaveBeenCalledWith("node:gamer", "/v1/node/pause", {});
    expect(await screen.findByTestId("model-pause-said")).toHaveTextContent(
      "Models paused. 1 model stopped.",
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows the pause as in effect, and resumes with one click", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({
      pause: { paused: false },
      results: [
        { name: "small", state: "started" },
        { name: "big", state: "refused", detail: "not enough GPU memory" },
      ],
    });
    const user = userEvent.setup();
    render(
      <ModelPause
        name="gamer"
        target="node:gamer"
        pause={{ paused: true, by: "tray", since: SINCE, runtimes: ["small", "big"] }}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByTestId("model-pause-line")).toHaveTextContent(
      /^Models paused from the tray icon since/,
    );
    expect(screen.queryByRole("button", { name: /Pause models/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Resume models on gamer" }));
    expect(post).toHaveBeenCalledWith("node:gamer", "/v1/node/resume", {});
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Resumed 1 of 2 models. big: not enough GPU memory.",
    );
  });

  it("shows the agent's refusal in its own words", async () => {
    vi.spyOn(api, "post").mockRejectedValue(
      new ApiError(403, "Forbidden", {
        detail: { title: "Forbidden", status: 403, detail: "An operator session is required." },
      }),
    );
    const user = userEvent.setup();
    render(
      <ModelPause
        name="gamer"
        target="node:gamer"
        pause={{ paused: true, by: "console", since: SINCE, runtimes: [] }}
        onChanged={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Resume models on gamer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("An operator session is required.");
  });
});
