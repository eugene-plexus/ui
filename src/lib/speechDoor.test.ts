import { describe, expect, it } from "vitest";

import {
  EMPTY_SPEECH_DRAFT,
  SPEECH_FORMATS,
  buildSpeechBody,
  formatsFor,
  speechPlayable,
  voiceLabel,
  voicesFor,
} from "./speechDoor";
import type { Model } from "./types";

const draft = { ...EMPTY_SPEECH_DRAFT, input: "Hi.", voice: "coral", format: "mp3" };

function model(extra: Record<string, unknown>): Model {
  return { id: "m", object: "model", created: 0, owned_by: "x", x_eugene_plexus: extra } as Model;
}

describe("buildSpeechBody", () => {
  it("always sends the format, and the optional fields only when typed", () => {
    expect(buildSpeechBody("tts", draft)).toEqual({
      body: { model: "tts", input: "Hi.", voice: "coral", response_format: "mp3" },
    });
    expect(buildSpeechBody("tts", { ...draft, speed: "1.25", instructions: " calm " })).toEqual({
      body: {
        model: "tts",
        input: "Hi.",
        voice: "coral",
        response_format: "mp3",
        speed: 1.25,
        instructions: "calm",
      },
    });
  });

  it("names what cannot be sent", () => {
    expect(buildSpeechBody("tts", { ...draft, input: " " })).toEqual({
      error: "Type something to say.",
    });
    expect(buildSpeechBody("tts", { ...draft, voice: "" })).toEqual({
      error: "Pick or type a voice.",
    });
    expect(buildSpeechBody("tts", { ...draft, speed: "5" })).toMatchObject({ error: /Speed/ });
    expect(buildSpeechBody("tts", { ...draft, speed: "0.2" })).toMatchObject({ error: /Speed/ });
    expect(buildSpeechBody("tts", { ...draft, input: "x".repeat(4097) })).toMatchObject({
      error: /stops at 4096/,
    });
  });
});

describe("the model's own listing", () => {
  it("offers the listed voices and formats, and every format when none is listed", () => {
    const listed = model({ voices: ["af_heart"], speech_formats: ["mp3", "wav"] });
    expect(voicesFor(listed)).toEqual(["af_heart"]);
    expect(formatsFor(listed)).toEqual(["mp3", "wav"]);
    expect(voicesFor(model({}))).toBeNull();
    expect(formatsFor(model({}))).toEqual([...SPEECH_FORMATS]);
  });

  it("shows a voice by its name, with the id only where two share a name", () => {
    const eleven = model({
      voices: ["21m00Tcm4TlvDq8ikWAM", "EXAVITQu4vr4xnSDxMaL", "pNInz6obpgDQGcFmaJgB", "cl0n3d"],
      voice_names: {
        "21m00Tcm4TlvDq8ikWAM": "Rachel",
        EXAVITQu4vr4xnSDxMaL: "Sarah",
        cl0n3d: "Rachel",
      },
    });
    expect(voiceLabel(eleven, "EXAVITQu4vr4xnSDxMaL")).toBe("Sarah");
    expect(voiceLabel(eleven, "21m00Tcm4TlvDq8ikWAM")).toBe("Rachel (21m00Tcm4TlvDq8ikWAM)");
    expect(voiceLabel(eleven, "pNInz6obpgDQGcFmaJgB")).toBe("pNInz6obpgDQGcFmaJgB");
    expect(voiceLabel(model({ voices: ["af_heart"] }), "af_heart")).toBe("af_heart");
  });
});

describe("speechPlayable", () => {
  it("puts a WAV header in front of pcm, and plays the rest as they are", () => {
    const pcm = speechPlayable("pcm", new Uint8Array([1, 0]));
    expect(pcm.mime).toBe("audio/wav");
    expect(pcm.bytes.length).toBe(46);
    const mp3 = speechPlayable("mp3", new Uint8Array([0x49, 0x44, 0x33]));
    expect(mp3).toEqual({ bytes: new Uint8Array([0x49, 0x44, 0x33]), mime: "audio/mpeg" });
    expect(speechPlayable("opus", new Uint8Array()).mime).toBe("audio/ogg");
  });
});
