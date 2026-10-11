import { describe, expect, it } from "vitest";

import { bytesToBase64 } from "./imageAttachments";
import {
  MAX_MEDIA_BYTES,
  base64ToBytes,
  buildMessageParts,
  checkAllAttachments,
  isPdf,
  joinBase64,
  looksLikeAudio,
  looksLikePdf,
  playableAudio,
  readAudioAttachment,
  readPdfAttachment,
  sniffAudio,
  wavFromPcm16,
} from "./mediaAttachments";

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const WAV = ascii("RIFF\u0000\u0000\u0000\u0000WAVEfmt ");
const MP3_ID3 = ascii("ID3\u0004\u0000");
const MP3_SYNC = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
const PDF = ascii("%PDF-1.7\n");

describe("sniffing", () => {
  it("reads a WAV and both kinds of MP3 off their bytes, and nothing else", () => {
    expect(sniffAudio(WAV)).toBe("wav");
    expect(sniffAudio(MP3_ID3)).toBe("mp3");
    expect(sniffAudio(MP3_SYNC)).toBe("mp3");
    expect(sniffAudio(ascii("OggS\u0000\u0002"))).toBeNull();
    expect(sniffAudio(ascii("RIFF\u0000\u0000\u0000\u0000WEBP"))).toBeNull();
  });

  it("knows a PDF by its first five bytes", () => {
    expect(isPdf(PDF)).toBe(true);
    expect(isPdf(ascii("%PS-"))).toBe(false);
  });

  it("routes a picked file by type or by name", () => {
    expect(looksLikeAudio("clip.wav", "")).toBe(true);
    expect(looksLikeAudio("clip", "audio/mpeg")).toBe(true);
    expect(looksLikeAudio("notes.txt", "text/plain")).toBe(false);
    expect(looksLikePdf("paper.PDF", "")).toBe(true);
    expect(looksLikePdf("paper", "application/pdf")).toBe(true);
  });
});

describe("reading an attachment", () => {
  it("names a recording that is neither WAV nor MP3, and one that is too big", () => {
    expect(readAudioAttachment("a.ogg", ascii("OggS"))).toMatch(/not a WAV or MP3/);
    const big = new Uint8Array(MAX_MEDIA_BYTES + 1);
    big.set(WAV);
    expect(readAudioAttachment("big.wav", big)).toMatch(/stops at 10 MB/);
  });

  it("keeps a recording as bare base64 with its sniffed format, whatever its name says", () => {
    const read = readAudioAttachment("really-a-wav.mp3", WAV);
    expect(read).toEqual({
      name: "really-a-wav.mp3",
      format: "wav",
      size: WAV.length,
      base64: bytesToBase64(WAV),
    });
  });

  it("keeps a PDF as a data URL, and refuses what does not begin like one", () => {
    expect(readPdfAttachment("p.pdf", PDF)).toEqual({
      name: "p.pdf",
      size: PDF.length,
      dataUrl: `data:application/pdf;base64,${bytesToBase64(PDF)}`,
    });
    expect(readPdfAttachment("p.pdf", ascii("hello"))).toMatch(/does not begin like a PDF/);
  });

  it("holds every attachment together to 11 MB, images included", () => {
    const mb = 1024 * 1024;
    expect(checkAllAttachments([{ size: 5 * mb }, { size: 6 * mb }])).toBeNull();
    expect(checkAllAttachments([{ size: 5 * mb }, { size: 6 * mb + 1 }])).toMatch(
      /11 MB altogether/,
    );
  });
});

describe("buildMessageParts", () => {
  const image = {
    name: "i.png",
    mime: "image/png" as const,
    size: 1,
    width: 1,
    height: 1,
    dataUrl: "data:image/png;base64,AA",
  };
  const clip = { name: "c.mp3", format: "mp3" as const, size: 1, base64: "QQ==" };
  const pdf = { name: "p.pdf", size: 1, dataUrl: "data:application/pdf;base64,JVBERi0=" };

  it("stays a plain string with nothing attached", () => {
    expect(buildMessageParts("hi", [], [], [])).toBe("hi");
  });

  it("puts the text first, then images, recordings and documents in OpenAI's shapes", () => {
    expect(buildMessageParts("hi", [image], [clip], [pdf])).toEqual([
      { type: "text", text: "hi" },
      { type: "image_url", image_url: { url: image.dataUrl } },
      { type: "input_audio", input_audio: { data: "QQ==", format: "mp3" } },
      { type: "file", file: { filename: "p.pdf", file_data: pdf.dataUrl } },
    ]);
  });

  it("sends no empty text part when only something is attached", () => {
    expect(buildMessageParts("", [], [clip], [])).toEqual([
      { type: "input_audio", input_audio: { data: "QQ==", format: "mp3" } },
    ]);
  });
});

describe("spoken replies", () => {
  it("joins base64 fragments whose edges are not three bytes apart", () => {
    const whole = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const fragments = [
      bytesToBase64(whole.subarray(0, 1)),
      bytesToBase64(whole.subarray(1, 5)),
      bytesToBase64(whole.subarray(5)),
    ];
    // Concatenating the strings would not be the base64 of the whole.
    expect(fragments.join("")).not.toBe(bytesToBase64(whole));
    expect(Array.from(base64ToBytes(joinBase64(fragments)))).toEqual(Array.from(whole));
  });

  it("puts a 24 kHz mono 16-bit WAV header in front of pcm16", () => {
    const pcm = new Uint8Array([1, 0, 2, 0]);
    const wav = wavFromPcm16(pcm);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4);
    expect(Array.from(wav.subarray(44))).toEqual([1, 0, 2, 0]);
  });

  it("plays pcm16 as a WAV, and an MP3 as the MP3 it is", () => {
    const pcm = playableAudio("pcm16", bytesToBase64(new Uint8Array([0, 0])));
    expect(pcm.mime).toBe("audio/wav");
    expect(pcm.bytes.length).toBe(46);
    const mp3 = playableAudio("mp3", bytesToBase64(MP3_ID3));
    expect(mp3.mime).toBe("audio/mpeg");
    expect(Array.from(mp3.bytes)).toEqual(Array.from(MP3_ID3));
  });
});
