import { describe, expect, it } from "vitest";

import {
  EMPTY_VIDEO_DRAFT,
  buildVideoRequest,
  describeJob,
  durationsFor,
  isFinished,
  jobPath,
  mediaUrl,
  sizesFor,
  takesFirstFrame,
} from "./videoDoor";
import type { Model } from "./types";

const draft = { ...EMPTY_VIDEO_DRAFT, prompt: "a boat" };

function model(extra: Record<string, unknown>): Model {
  return { id: "m", object: "model", created: 0, owned_by: "x", x_eugene_plexus: extra } as Model;
}

describe("buildVideoRequest", () => {
  it("is JSON with only what was set, seconds as a string as OpenAI's is", () => {
    expect(buildVideoRequest("veo", draft, null)).toEqual({
      request: { kind: "json", body: { model: "veo", prompt: "a boat" } },
    });
    expect(buildVideoRequest("veo", { ...draft, seconds: "8", size: "1280x720" }, null)).toEqual({
      request: {
        kind: "json",
        body: { model: "veo", prompt: "a boat", seconds: "8", size: "1280x720" },
      },
    });
  });

  it("is the SDK's multipart form with a first frame", () => {
    const frame = new File([new Uint8Array([1])], "start.png", { type: "image/png" });
    const built = buildVideoRequest("veo", { ...draft, seconds: "4" }, frame);
    if ("error" in built || built.request.kind !== "form") throw new Error("expected a form");
    const form = built.request.form;
    expect(form.get("model")).toBe("veo");
    expect(form.get("seconds")).toBe("4");
    expect((form.get("input_reference") as File).name).toBe("start.png");
    expect(built.request.fields.at(-1)).toEqual({ name: "input_reference", file: "start.png" });
  });

  it("names what cannot be sent", () => {
    expect(buildVideoRequest("m", { ...draft, prompt: "" }, null)).toEqual({
      error: "Describe the video.",
    });
    expect(buildVideoRequest("m", { ...draft, seconds: "4.5" }, null)).toMatchObject({
      error: /whole number/,
    });
    expect(buildVideoRequest("m", { ...draft, seconds: "0" }, null)).toMatchObject({
      error: /whole number/,
    });
  });
});

describe("the model's own listing", () => {
  it("offers the listed durations, sizes and a first frame, and nothing it does not list", () => {
    const listed = model({
      video_durations: [4, 8],
      video_sizes: ["1280x720"],
      video_first_frame: true,
    });
    expect(durationsFor(listed)).toEqual([4, 8]);
    expect(sizesFor(listed)).toEqual(["1280x720"]);
    expect(takesFirstFrame(listed)).toBe(true);
    expect(durationsFor(model({}))).toBeNull();
    expect(sizesFor(model({}))).toBeNull();
    expect(takesFirstFrame(model({}))).toBe(false);
  });
});

describe("jobs", () => {
  it("says where a job is, in words", () => {
    expect(describeJob({ id: "v", status: "queued" })).toBe("Waiting to start.");
    expect(describeJob({ id: "v", status: "in_progress", progress: 40 })).toBe(
      "Making it: 40% done.",
    );
    expect(describeJob({ id: "v", status: "completed" })).toBe("Finished.");
    expect(describeJob({ id: "v", status: "failed", error: { message: "no credit" } })).toBe(
      "It failed: no credit.",
    );
    expect(isFinished({ id: "v", status: "failed" })).toBe(true);
    expect(isFinished({ id: "v", status: "in_progress" })).toBe(false);
  });

  it("sends the signed handle back as given, escaped for a path", () => {
    expect(jobPath("vid_a.b/c=")).toBe("/v1/videos/vid_a.b%2Fc%3D");
    expect(jobPath("v1", true)).toBe("/v1/videos/v1/content");
  });

  it("makes a playable URL even where the browser has no object URLs", () => {
    const made = mediaUrl(new Uint8Array([0, 0, 0, 24]), "video/mp4");
    expect(made.url.startsWith("data:video/mp4;base64,") || made.url.startsWith("blob:")).toBe(
      true,
    );
    made.revoke();
  });
});
