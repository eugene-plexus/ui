/**
 * Recordings, PDFs and spoken replies in the playground's chat, driven
 * as a page (U2 of playground-doors.md). The libs have their own tests;
 * this is the WIRING: a picked file reaches the request as the right
 * part, the listing's warnings show, a spoken reply is asked for and
 * played, and its sound never rides back on the next turn.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bytesToBase64 } from "@/lib/imageAttachments";

import PlaygroundPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/playground",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, controls }: { children: ReactNode; controls?: ReactNode }) => (
    <div data-testid="shell">
      {controls}
      {children}
    </div>
  ),
}));

vi.mock("@/lib/useAutoScroll", () => ({
  useAutoScroll: () => ({
    scrollRef: { current: null },
    isAtBottom: true,
    scrollToBottom: () => {},
  }),
}));

interface Call {
  method: string;
  route: string;
  body: Record<string, unknown> | undefined;
}

let calls: Call[];
let handlers: Map<string, (init?: RequestInit) => Response>;
let modelFlags: Record<string, unknown>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sse(deltas: Array<Record<string, unknown>>): Response {
  const frames = [
    ...deltas.map((delta) => JSON.stringify({ choices: [{ index: 0, delta }] })),
    JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
    "[DONE]",
  ];
  return new Response(frames.map((f) => `data: ${f}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const ascii = (s: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const WAV = ascii("RIFF\u0000\u0000\u0000\u0000WAVEfmt ");
const PDF = ascii("%PDF-1.7\n");

beforeEach(() => {
  calls = [];
  modelFlags = { surfaces: ["chat"] };
  handlers = new Map([
    ["GET agent/v1/auth/status", () => json(200, { initialized: true })],
    ["GET agent/v1/config", () => json(200, { firstRunComplete: true })],
    ["GET agent/v1/components", () => json(200, { components: [] })],
    [
      "GET gateway/v1/models",
      () =>
        json(200, {
          object: "list",
          data: [
            { id: "omni", object: "model", created: 0, owned_by: "x", x_eugene_plexus: modelFlags },
          ],
        }),
    ],
  ]);
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        route: String(input).replace(/^\/api\/proxy\//, ""),
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined,
      };
      calls.push(call);
      const handler = handlers.get(`${call.method} ${call.route}`);
      if (!handler)
        return json(418, { detail: { title: `unhandled ${call.method} ${call.route}` } });
      return handler(init);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function chatCalls(): Call[] {
  return calls.filter((c) => c.method === "POST" && c.route === "gateway/v1/chat/completions");
}

async function renderReady() {
  render(<PlaygroundPage />);
  await waitFor(() => expect(screen.getByTestId("composer")).not.toBeDisabled());
}

function attach(name: string, type: string, bytes: Uint8Array<ArrayBuffer>) {
  const file = new File([bytes], name, { type });
  fireEvent.change(screen.getByTestId("attach-input"), { target: { files: [file] } });
}

describe("attachments", () => {
  it("sends a recording as input_audio and a PDF as a file part, after the text", async () => {
    handlers.set("POST gateway/v1/chat/completions", () => sse([{ content: "Heard and read." }]));
    await renderReady();
    attach("note.wav", "audio/wav", WAV);
    await waitFor(() => expect(screen.getByTestId("audio-chip")).toBeInTheDocument());
    attach("paper.pdf", "application/pdf", PDF);
    await waitFor(() => expect(screen.getByTestId("pdf-chip")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("composer"), { target: { value: "summarise both" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(chatCalls()).toHaveLength(1));
    const messages = chatCalls()[0]!.body!.messages as Array<{ content: unknown }>;
    expect(messages.at(-1)!.content).toEqual([
      { type: "text", text: "summarise both" },
      { type: "input_audio", input_audio: { data: bytesToBase64(WAV), format: "wav" } },
      {
        type: "file",
        file: {
          filename: "paper.pdf",
          file_data: `data:application/pdf;base64,${bytesToBase64(PDF)}`,
        },
      },
    ]);
    // Shown in the transcript as what they are.
    await waitFor(() => expect(screen.getByTestId("message-audio")).toBeInTheDocument());
    expect(screen.getByTestId("message-file").textContent).toContain("paper.pdf");
  });

  it("refuses a file that only claims to be a recording, naming it", async () => {
    await renderReady();
    attach("fake.mp3", "audio/mpeg", ascii("not audio"));
    await waitFor(() =>
      expect(screen.getByText(/fake\.mp3 is not a WAV or MP3/)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("audio-chip")).toBeNull();
  });

  it("warns when the listing says the model cannot hear or read, and sends anyway", async () => {
    modelFlags = { surfaces: ["chat"], audio_input: false, file_input: false };
    handlers.set("POST gateway/v1/chat/completions", () =>
      json(400, {
        error: { message: "No backend serving omni hears audio.", type: "invalid_request_error" },
      }),
    );
    await renderReady();
    attach("note.wav", "audio/wav", WAV);
    attach("paper.pdf", "application/pdf", PDF);
    await waitFor(() =>
      expect(screen.getByTestId("audio-model-note").textContent).toMatch(/cannot hear recordings/),
    );
    expect(screen.getByTestId("file-model-note").textContent).toMatch(/cannot read PDFs/);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(chatCalls()).toHaveLength(1));
  });
});

describe("spoken replies", () => {
  it("asks for audio with the voice, plays the reply, and sends only its words back next turn", async () => {
    localStorage.setItem(
      "eugene-playground-spoken",
      JSON.stringify({ enabled: true, voice: "coral" }),
    );
    modelFlags = { surfaces: ["chat"], audio_output: true };
    const pcm = new Uint8Array([0, 1, 0, 2]);
    handlers.set("POST gateway/v1/chat/completions", () =>
      sse([
        { audio: { format: "pcm16", transcript: "Hello" } },
        { audio: { data: bytesToBase64(pcm), transcript: " you" } },
      ]),
    );
    await renderReady();
    expect(screen.getByTestId("toggle-diagnostic").textContent).toContain("spoken");

    fireEvent.change(screen.getByTestId("composer"), { target: { value: "say hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(chatCalls()).toHaveLength(1));
    expect(chatCalls()[0]!.body).toMatchObject({
      modalities: ["text", "audio"],
      audio: { voice: "coral", format: "pcm16" },
    });
    await waitFor(() => expect(screen.getByTestId("spoken-reply")).toBeInTheDocument());
    expect(screen.getByTestId("spoken-reply").getAttribute("src")).toMatch(
      /^data:audio\/wav;base64,UklGR/,
    );
    expect(screen.getByText("Hello you")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("composer"), { target: { value: "again" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(chatCalls()).toHaveLength(2));
    const replayed = (chatCalls()[1]!.body!.messages as Array<Record<string, unknown>>)[1]!;
    expect(replayed).toEqual({ role: "assistant", content: "Hello you" });
  });

  it("warns in the panel when the model cannot answer out loud", async () => {
    localStorage.setItem(
      "eugene-playground-spoken",
      JSON.stringify({ enabled: true, voice: "alloy" }),
    );
    modelFlags = { surfaces: ["chat"], audio_output: false };
    await renderReady();
    fireEvent.click(screen.getByTestId("toggle-diagnostic"));
    expect(screen.getByTestId("spoken-model-note")).toBeInTheDocument();
  });
});
