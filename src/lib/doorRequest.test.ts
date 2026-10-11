import { describe, expect, it } from "vitest";

import { doorCurl, extensionFor, newDoorReport, routingFromHeaders } from "./doorRequest";

describe("newDoorReport", () => {
  it("dials the proxy and reproduces against the gateway's own address", () => {
    const r = newDoorReport(
      { kind: "proxy" },
      "/v1/completions",
      { kind: "json", body: { a: 1 } },
      "http://gpu:8080/v1",
    );
    expect(r.url).toBe("/api/proxy/gateway/v1/completions");
    expect(r.reproduceUrl).toBe("http://gpu:8080/v1/completions");
    expect(r.body).toBe('{"a":1}');
    expect(r.method).toBe("POST");
  });

  it("has no curl target in proxy mode when the address is unknown, and dials it in direct mode", () => {
    expect(
      newDoorReport({ kind: "proxy" }, "/v1/x", { kind: "get" }, null).reproduceUrl,
    ).toBeNull();
    const direct = newDoorReport(
      { kind: "direct", baseUrl: "http://gpu:8080", key: "k" },
      "/v1/x",
      { kind: "get" },
      null,
    );
    expect(direct.url).toBe("http://gpu:8080/v1/x");
    expect(direct.reproduceUrl).toBe(direct.url);
    expect(direct.method).toBe("GET");
  });
});

describe("routingFromHeaders", () => {
  it("reads the envelope the way /v1/messages carries it, typed", () => {
    const headers = new Headers({
      "x-eugene-plexus-driver": "kokoro-driver",
      "x-eugene-plexus-attempts": "2",
      "x-eugene-plexus-swapped-in": "false",
      "x-eugene-plexus-ignored-settings": "speed",
      "x-request-id": "r1",
    });
    expect(routingFromHeaders(headers)).toEqual({
      driver: "kokoro-driver",
      attempts: 2,
      swapped_in: false,
    });
  });

  it("is null when the answer carries none", () => {
    expect(routingFromHeaders(new Headers({ "content-type": "audio/mpeg" }))).toBeNull();
  });
});

describe("doorCurl", () => {
  it("expands the key placeholder in double quotes, and sends the JSON as ASCII", () => {
    const r = newDoorReport(
      { kind: "proxy" },
      "/v1/completions",
      { kind: "json", body: { prompt: "°" } },
      "http://gpu:8080",
    );
    const line = doorCurl(r, null)!;
    expect(line).toContain('"Authorization: Bearer $EUGENE_PLEXUS_TOKEN"');
    expect(line).toContain("\\u00b0");
    expect(line).not.toContain("°");
    expect(doorCurl(r, "secret")).toContain("'Authorization: Bearer secret'");
  });

  it("sends a form as -F fields, a file by name, and writes a binary answer to a file", () => {
    const r = newDoorReport(
      { kind: "proxy" },
      "/v1/audio/transcriptions",
      {
        kind: "form",
        form: new FormData(),
        fields: [
          { name: "model", value: "whisper" },
          { name: "file", file: "clip.wav" },
        ],
      },
      "http://gpu:8080",
    );
    r.contentType = "audio/mpeg";
    const line = doorCurl(r, null)!;
    expect(line).toContain("-F 'model=whisper'");
    expect(line).toContain("-F 'file=@clip.wav'");
    expect(line).toContain("-o 'answer.mp3'");
    expect(line).not.toContain("Content-Type: application/json");
  });

  it("is null when there is no address to reproduce against", () => {
    expect(
      doorCurl(newDoorReport({ kind: "proxy" }, "/v1/x", { kind: "get" }, null), null),
    ).toBeNull();
  });
});

describe("extensionFor", () => {
  it("names a file after its media type, parameters ignored", () => {
    expect(extensionFor("audio/mpeg")).toBe("mp3");
    expect(extensionFor("image/png; charset=binary")).toBe("png");
    expect(extensionFor("video/mp4")).toBe("mp4");
    expect(extensionFor(null)).toBe("bin");
  });
});
