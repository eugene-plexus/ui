import { describe, expect, it } from "vitest";

import {
  EMPTY_TRANSCRIPTION_DRAFT,
  MAX_UPLOAD_BYTES,
  buildTranscriptionForm,
  modelsForTask,
  pathFor,
  readTranscriptionAnswer,
} from "./transcriptionDoor";
import type { Model } from "./types";

const clip = new File([new Uint8Array([1, 2, 3])], "fox.mp3", { type: "audio/mpeg" });

function entries(form: FormData): Array<[string, string]> {
  return [...form.entries()].map(([k, v]) => [
    k,
    typeof v === "string" ? v : `@${(v as File).name}`,
  ]);
}

describe("buildTranscriptionForm", () => {
  it("sends the SDK's fields, and a language only when transcribing", () => {
    const draft = {
      ...EMPTY_TRANSCRIPTION_DRAFT,
      language: "en",
      prompt: "Foxes.",
      temperature: "0",
    };
    const built = buildTranscriptionForm("scribe", draft, clip);
    if ("error" in built) throw new Error(built.error);
    expect(entries(built.form)).toEqual([
      ["file", "@fox.mp3"],
      ["model", "scribe"],
      ["language", "en"],
      ["prompt", "Foxes."],
      ["response_format", "json"],
      ["temperature", "0"],
    ]);
    expect(built.fields[0]).toEqual({ name: "file", file: "fox.mp3" });

    const translated = buildTranscriptionForm("whisper", { ...draft, task: "translate" }, clip);
    if ("error" in translated) throw new Error(translated.error);
    expect(entries(translated.form).map(([k]) => k)).not.toContain("language");
  });

  it("names what cannot be sent", () => {
    expect(buildTranscriptionForm("m", EMPTY_TRANSCRIPTION_DRAFT, null)).toEqual({
      error: "Choose a recording.",
    });
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "big.wav");
    expect(buildTranscriptionForm("m", EMPTY_TRANSCRIPTION_DRAFT, big)).toMatchObject({
      error: /stops at 25 MB/,
    });
    expect(
      buildTranscriptionForm("m", { ...EMPTY_TRANSCRIPTION_DRAFT, temperature: "2" }, clip),
    ).toMatchObject({ error: /Temperature/ });
  });
});

describe("tasks", () => {
  it("sends a translation to its own door, and only to models that translate", () => {
    expect(pathFor("transcribe")).toBe("/v1/audio/transcriptions");
    expect(pathFor("translate")).toBe("/v1/audio/translations");
    const m = (id: string, surfaces: string[]) =>
      ({ id, object: "model", created: 0, owned_by: "x", x_eugene_plexus: { surfaces } }) as Model;
    const both = m("whisper", ["transcription", "translation"]);
    const one = m("scribe", ["transcription"]);
    expect(modelsForTask([both, one], "transcribe")).toEqual([both, one]);
    expect(modelsForTask([both, one], "translate")).toEqual([both]);
  });
});

describe("readTranscriptionAnswer", () => {
  it("reads text as the words, and JSON for what a verbose answer says besides", () => {
    expect(readTranscriptionAnswer("text", "the quick fox").text).toBe("the quick fox");
    expect(readTranscriptionAnswer("json", '{"text":"hi"}')).toMatchObject({
      text: "hi",
      language: null,
    });
    expect(
      readTranscriptionAnswer(
        "verbose_json",
        '{"text":"hi","language":"english","duration":3.5,"segments":[{},{}]}',
      ),
    ).toMatchObject({ text: "hi", language: "english", duration: 3.5, segments: 2 });
  });
});
