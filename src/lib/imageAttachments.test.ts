import { describe, expect, it } from "vitest";

import {
  MAX_IMAGE_BYTES,
  bytesToBase64,
  buildMessageContent,
  checkImageAttachment,
  checkImageSet,
  jpegDimensions,
  pngDimensions,
  toDataUrl,
  type ImageAttachment,
} from "./imageAttachments";

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

/** The smallest byte string the PNG dimension reader accepts: the
 * signature, then an IHDR chunk with the given size. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  writeU32(bytes, 8, 13); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  writeU32(bytes, 16, width);
  writeU32(bytes, 20, height);
  return bytes;
}

/** SOI, an APP0 the walker must skip, one SOF marker, EOI. */
function jpeg(width: number, height: number, sof = 0xc0): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x04,
    0x4a,
    0x46, // APP0, length 4 (2 payload bytes)
    0xff,
    sof,
    0x00,
    0x0b,
    0x08, // SOF, length 11, precision 8
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00, // component stub
    0xff,
    0xd9, // EOI
  ]);
}

function attachment(name: string, size: number): ImageAttachment {
  return {
    name,
    mime: "image/png",
    size,
    width: 10,
    height: 10,
    dataUrl: "data:image/png;base64,x",
  };
}

describe("dimension readers", () => {
  it("PNG: width and height come off the IHDR chunk", () => {
    expect(pngDimensions(png(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it("PNG: a wrong signature or a first chunk that is not IHDR is not a PNG", () => {
    const bad = png(640, 480);
    bad[0] = 0x00;
    expect(pngDimensions(bad)).toBeNull();
    const notIhdr = png(640, 480);
    notIhdr[12] = 0x4a;
    expect(pngDimensions(notIhdr)).toBeNull();
  });

  it("JPEG: the walker skips APP segments and reads the first SOF", () => {
    expect(jpegDimensions(jpeg(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it("JPEG: a progressive SOF2 frame reads the same way", () => {
    expect(jpegDimensions(jpeg(320, 200, 0xc2))).toEqual({ width: 320, height: 200 });
  });

  it("JPEG: a DHT (C4) segment is not a frame and must be walked past", () => {
    // SOI, DHT (would be inside the SOF range but carries no frame),
    // then a real SOF0.
    const withDht = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xc4,
      0x00,
      0x04,
      0x00,
      0x00, // DHT, length 4
      ...jpeg(100, 50).slice(2),
    ]);
    expect(jpegDimensions(withDht)).toEqual({ width: 100, height: 50 });
  });

  it("garbage is null, not a guess", () => {
    expect(jpegDimensions(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(pngDimensions(new Uint8Array(4))).toBeNull();
  });
});

describe("checkImageAttachment", () => {
  it("a valid small PNG passes", () => {
    expect(checkImageAttachment("shot.png", "image/png", png(640, 480))).toBeNull();
  });

  it("only PNG and JPEG are images here", () => {
    expect(checkImageAttachment("a.gif", "image/gif", png(1, 1))).toContain("only PNG and JPEG");
  });

  it("the per-image byte limit is the file's own size", () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(png(10, 10));
    expect(checkImageAttachment("big.png", "image/png", big)).toContain("5 MB");
  });

  it("a side over 8192 is refused even under the pixel budget", () => {
    // 9000 x 100 is 0.9 megapixels and still not sendable.
    expect(checkImageAttachment("wide.png", "image/png", png(9000, 100))).toContain("8192");
  });

  it("the pixel budget is refused even when both sides fit", () => {
    // 4100 x 4100 = 16.8 MP with both sides under 8192.
    expect(checkImageAttachment("dense.png", "image/png", png(4100, 4100))).toContain("megapixels");
  });

  it("bytes that do not parse as the claimed format are refused, not sent blind", () => {
    expect(checkImageAttachment("fake.png", "image/png", new Uint8Array(64))).toContain(
      "does not read as a valid PNG",
    );
  });
});

describe("checkImageSet", () => {
  it("four small images are the contract's ceiling and pass", () => {
    expect(checkImageSet([1, 2, 3, 4].map((i) => attachment(`${i}.png`, 1000)))).toBeNull();
  });

  it("a fifth image is refused by count", () => {
    expect(checkImageSet([1, 2, 3, 4, 5].map((i) => attachment(`${i}.png`, 1000)))).toContain(
      "at most 4",
    );
  });

  it("the total is refused past 10 MB even at a legal count", () => {
    const three = [1, 2, 3].map((i) => attachment(`${i}.png`, 4 * 1024 * 1024));
    expect(checkImageSet(three)).toContain("10 MB");
  });
});

describe("encoding", () => {
  it("matches btoa on small input and survives input past the call-stack limit", () => {
    const small = new TextEncoder().encode("hello");
    expect(bytesToBase64(small)).toBe(btoa("hello"));
    const large = new Uint8Array(300_000).fill(65);
    expect(bytesToBase64(large)).toBe(btoa("A".repeat(300_000)));
  });

  it("the data URL names the MIME the gateway will check", () => {
    expect(toDataUrl("image/jpeg", new TextEncoder().encode("x"))).toBe(
      "data:image/jpeg;base64,eA==",
    );
  });
});

describe("buildMessageContent", () => {
  it("no images means a plain string — the request is unchanged", () => {
    expect(buildMessageContent("hello", [])).toBe("hello");
  });

  it("with images the text leads and the images follow in order", () => {
    const a = attachment("a.png", 10);
    const b = attachment("b.png", 10);
    expect(buildMessageContent("look", [a, b])).toEqual([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: a.dataUrl } },
      { type: "image_url", image_url: { url: b.dataUrl } },
    ]);
  });

  it("an image with no text sends no empty text part", () => {
    const a = attachment("a.png", 10);
    expect(buildMessageContent("", [a])).toEqual([
      { type: "image_url", image_url: { url: a.dataUrl } },
    ]);
  });
});
