import { describe, expect, it } from "vitest";

import {
  EMPTY_IMAGE_DRAFT,
  answerFromImages,
  buildEditForm,
  buildGenerateBody,
  mimeForImage,
  readImageStream,
} from "./imageDoor";

const draft = { ...EMPTY_IMAGE_DRAFT, prompt: "a fox" };
const png = (name: string) => new File([new Uint8Array([0x89, 0x50])], name, { type: "image/png" });

function entries(form: FormData): Array<[string, string]> {
  return [...form.entries()].map(([k, v]) => [
    k,
    typeof v === "string" ? v : `@${(v as File).name}`,
  ]);
}

describe("buildGenerateBody", () => {
  it("sends only what was set", () => {
    expect(buildGenerateBody("flux", draft)).toEqual({ body: { model: "flux", prompt: "a fox" } });
    expect(
      buildGenerateBody("flux", {
        ...draft,
        n: "2",
        size: "512x512",
        quality: "high",
        outputFormat: "webp",
      }),
    ).toEqual({
      body: {
        model: "flux",
        prompt: "a fox",
        n: 2,
        size: "512x512",
        quality: "high",
        output_format: "webp",
      },
    });
  });

  it("asks for partial pictures only on a stream", () => {
    expect(buildGenerateBody("m", { ...draft, partialImages: "2" })).toEqual({
      body: { model: "m", prompt: "a fox" },
    });
    expect(buildGenerateBody("m", { ...draft, stream: true, partialImages: "2" })).toEqual({
      body: { model: "m", prompt: "a fox", stream: true, partial_images: 2 },
    });
  });

  it("names what cannot be sent", () => {
    expect(buildGenerateBody("m", { ...draft, prompt: " " })).toEqual({
      error: "Describe the picture.",
    });
    expect(buildGenerateBody("m", { ...draft, n: "11" })).toMatchObject({ error: /1 to 10/ });
    expect(buildGenerateBody("m", { ...draft, stream: true, partialImages: "4" })).toMatchObject({
      error: /0 to 3/,
    });
  });
});

describe("buildEditForm", () => {
  it("sends one picture as image, several as image[] once each, and the mask", () => {
    const one = buildEditForm("gpt-image", draft, [png("a.png")], null);
    if ("error" in one) throw new Error(one.error);
    expect(entries(one.form)).toEqual([
      ["model", "gpt-image"],
      ["prompt", "a fox"],
      ["image", "@a.png"],
    ]);
    const two = buildEditForm(
      "gpt-image",
      { ...draft, n: "1" },
      [png("a.png"), png("b.png")],
      png("m.png"),
    );
    if ("error" in two) throw new Error(two.error);
    expect(entries(two.form)).toEqual([
      ["model", "gpt-image"],
      ["prompt", "a fox"],
      ["image[]", "@a.png"],
      ["image[]", "@b.png"],
      ["mask", "@m.png"],
      ["n", "1"],
    ]);
    expect(two.fields.filter((f) => "file" in f).map((f) => f.name)).toEqual([
      "image[]",
      "image[]",
      "mask",
    ]);
  });

  it("needs a picture to change", () => {
    expect(buildEditForm("m", draft, [], null)).toEqual({ error: "Choose a picture to edit." });
  });
});

describe("reading pictures", () => {
  it("names a picture by its format, or by its first bytes", () => {
    expect(mimeForImage("webp", "AAAA")).toBe("image/webp");
    expect(mimeForImage("svg", "PHN2")).toBe("image/svg+xml");
    expect(mimeForImage(undefined, "/9j/4AAQ")).toBe("image/jpeg");
    expect(mimeForImage(undefined, "iVBORw0K")).toBe("image/png");
  });

  it("reads OpenAI's answer as pictures to show", () => {
    expect(
      answerFromImages({
        data: [{ b64_json: "iVBOR", revised_prompt: "a small fox" }],
        output_format: "png",
        usage: { total_tokens: 9 },
        x_eugene_plexus: { driver: "flux-a" },
      }),
    ).toEqual({
      pictures: [{ src: "data:image/png;base64,iVBOR", revisedPrompt: "a small fox" }],
      usage: { total_tokens: 9 },
      routing: { driver: "flux-a" },
      truncatedBy: null,
    });
  });
});

function streamOf(events: Array<{ event: string; data: unknown }>): Response {
  const body = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

describe("readImageStream", () => {
  it("hands over each partial picture, then keeps the finished ones with routing", async () => {
    const partials: Array<[string, number]> = [];
    const answer = await readImageStream(
      streamOf([
        {
          event: "image_generation.partial_image",
          data: {
            type: "image_generation.partial_image",
            b64_json: "iVBORp",
            partial_image_index: 0,
          },
        },
        {
          event: "image_generation.completed",
          data: {
            type: "image_generation.completed",
            b64_json: "iVBORf",
            output_format: "png",
            usage: { total_tokens: 5 },
            x_eugene_plexus: { driver: "gpt-image-a" },
          },
        },
      ]),
      (src, index) => partials.push([src, index]),
    );
    expect(partials).toEqual([["data:image/png;base64,iVBORp", 0]]);
    expect(answer.pictures).toEqual([{ src: "data:image/png;base64,iVBORf", revisedPrompt: null }]);
    expect(answer.routing).toEqual({ driver: "gpt-image-a" });
    expect(answer.usage).toEqual({ total_tokens: 5 });
    expect(answer.truncatedBy).toBeNull();
  });

  it("is cut short by an error event, or by a stream with nothing finished", async () => {
    const failed = await readImageStream(
      streamOf([
        { event: "error", data: { type: "error", error: { message: "the backend went away" } } },
      ]),
      () => {},
    );
    expect(failed.truncatedBy).toBe("the backend went away");
    const unfinished = await readImageStream(
      streamOf([
        {
          event: "image_generation.partial_image",
          data: {
            type: "image_generation.partial_image",
            b64_json: "iVBOR",
            partial_image_index: 0,
          },
        },
      ]),
      () => {},
    );
    expect(unfinished.truncatedBy).toMatch(/before a picture was finished/);
  });
});
