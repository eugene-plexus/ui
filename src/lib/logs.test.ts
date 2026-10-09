/**
 * Every machine's log from one console: the query, the SSE framing, the
 * timeline, and what Download writes (2026-09-27).
 */

import { describe, expect, it } from "vitest";

import {
  downloadName,
  downloadText,
  engineLogsHref,
  keepNewest,
  logsQuery,
  looksLikeTrouble,
  type MachineLine,
  mergeByTime,
  parseSse,
  timeOf,
} from "./logs";

function line(machine: string, time: string | null, text: string, source = "agent"): MachineLine {
  return { machine, time, source, text };
}

describe("logsQuery", () => {
  it("repeats source, and leaves out what is empty", () => {
    expect(logsQuery({ sources: ["engine: q", "gateway"], contains: " err ", tail: 500 })).toBe(
      "?source=engine%3A+q&source=gateway&contains=err&tail=500",
    );
    expect(logsQuery({ sources: [], contains: "", tail: 500 }, false)).toBe("");
  });
});

describe("parseSse", () => {
  it("reads named events, skips comments, and keeps an unfinished tail", () => {
    const { events, rest } = parseSse(
      ': following\n\nevent: line\ndata: {"a":1}\n\n: keepalive\n\nevent: dropped\ndata: {"dropped":3}\n\nevent: li',
    );
    expect(events).toEqual([
      { event: "line", data: '{"a":1}' },
      { event: "dropped", data: '{"dropped":3}' },
    ]);
    expect(rest).toBe("event: li");
  });

  it("reads CRLF framing the same", () => {
    expect(parseSse('event: line\r\ndata: {"a":1}\r\n\r\n').events).toEqual([
      { event: "line", data: '{"a":1}' },
    ]);
  });
});

describe("mergeByTime", () => {
  it("puts two machines on one timeline", () => {
    const nas = [
      line("NAS", "2026-09-27T19:00:01.000Z", "n1"),
      line("NAS", "2026-09-27T19:00:03.000Z", "n2"),
    ];
    const amish = [line("Amish", "2026-09-27T19:00:02.000Z", "a1")];
    expect(mergeByTime([nas, amish]).map((l) => l.text)).toEqual(["n1", "a1", "n2"]);
  });

  it("keeps a line with no time right after the line before it on its machine", () => {
    const nas = [line("NAS", "2026-09-27T19:00:05.000Z", "n1"), line("NAS", null, "n1-continued")];
    const amish = [
      line("Amish", "2026-09-27T19:00:04.000Z", "a1"),
      line("Amish", "2026-09-27T19:00:06.000Z", "a2"),
    ];
    expect(mergeByTime([nas, amish]).map((l) => l.text)).toEqual([
      "a1",
      "n1",
      "n1-continued",
      "a2",
    ]);
  });
});

describe("the rest", () => {
  it("keeps the newest, oldest first", () => {
    expect(keepNewest([1, 2, 3, 4], 2)).toEqual([3, 4]);
  });

  it("reads a stamp on this browser's clock, and nothing for none", () => {
    expect(timeOf("2026-09-27T19:51:54.123Z")).toMatch(/^\d\d:\d\d:54\.123$/);
    expect(timeOf(null)).toBe("");
  });

  it("marks the lines that read as trouble", () => {
    expect(looksLikeTrouble("llama_model_load: error loading model")).toBe(true);
    expect(looksLikeTrouble("Traceback (most recent call last):")).toBe(true);
    expect(looksLikeTrouble("model loaded")).toBe(false);
  });

  it("writes a download with the full stamp first, and the machine when there are several", () => {
    const lines = [
      line("NAS", "2026-09-27T19:00:01.000Z", "hello", "gateway"),
      line("NAS", null, "more"),
    ];
    expect(downloadText(lines, true)).toBe(
      "2026-09-27T19:00:01.000Z NAS [gateway] hello\n- NAS [agent] more\n",
    );
    expect(downloadText(lines, false)).toBe(
      "2026-09-27T19:00:01.000Z [gateway] hello\n- [agent] more\n",
    );
    expect(downloadName("Amish Station", new Date("2026-09-27T19:51:54Z"))).toBe(
      "eugene-logs-Amish_Station-2026-09-27T19-51-54.txt",
    );
  });

  it("links a model to its engine's lines on its own machine", () => {
    expect(engineLogsHref("Amish_Station", "qwen")).toBe(
      "/logs?sel=agent%3AAmish_Station&source=engine%3A%20qwen",
    );
    expect(engineLogsHref(null, "qwen")).toBe("/logs?sel=agent&source=engine%3A%20qwen");
  });
});
