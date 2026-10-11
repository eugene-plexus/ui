import { describe, expect, it } from "vitest";

import { sseEvents } from "./sse";

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    }),
  );
}

async function collect(response: Response) {
  const out = [];
  for await (const e of sseEvents(response)) out.push(e);
  return out;
}

describe("sseEvents", () => {
  it("names events, joins data lines, and waits for the blank line that ends a frame", async () => {
    const events = await collect(
      streamOf([
        "event: image_generation.partial_image\nda",
        'ta: {"a":1}\n\n',
        "data: one\ndata: two\n\n",
      ]),
    );
    expect(events).toEqual([
      { event: "image_generation.partial_image", data: '{"a":1}' },
      { event: null, data: "one\ntwo" },
    ]);
  });

  it("reads CRLF frames and a last frame with no trailing blank line", async () => {
    expect(await collect(streamOf(["data: a\r\n\r\ndata: b"]))).toEqual([
      { event: null, data: "a" },
      { event: null, data: "b" },
    ]);
  });

  it("skips a frame that carries no data", async () => {
    expect(await collect(streamOf([": keepalive\n\ndata: x\n\n"]))).toEqual([
      { event: null, data: "x" },
    ]);
  });
});
