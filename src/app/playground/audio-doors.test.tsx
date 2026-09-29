/**
 * The Speech and Transcription doors, driven as a page (U4 of
 * playground-doors.md): the form reaches the request, the audio or the
 * text lands on screen, and what served it is read off the headers.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlaygroundPage from "./page";

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/playground",
  useSearchParams: () => nav.params,
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
  body: unknown;
  headers: Headers;
}

let calls: Call[];
let handlers: Map<string, (init?: RequestInit) => Response>;

const model = (id: string, extra: Record<string, unknown>) => ({
  id,
  object: "model",
  created: 0,
  owned_by: "x",
  x_eugene_plexus: extra,
});

const MODELS = {
  object: "list",
  data: [
    model("chat", { surfaces: ["chat"] }),
    model("kokoro", {
      surfaces: ["speech"],
      voices: ["af_heart", "af_bella"],
      speech_formats: ["mp3", "pcm"],
    }),
    model("scribe", { surfaces: ["transcription"] }),
    model("whisper", { surfaces: ["transcription", "translation"] }),
  ],
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  calls = [];
  nav.params = new URLSearchParams();
  handlers = new Map([
    ["GET agent/v1/auth/status", () => json(200, { initialized: true })],
    ["GET agent/v1/config", () => json(200, { firstRunComplete: true })],
    ["GET agent/v1/components", () => json(200, { components: [] })],
    ["GET gateway/v1/models", () => json(200, MODELS)],
  ]);
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body;
      const call: Call = {
        method: init?.method ?? "GET",
        route: String(input).replace(/^\/api\/proxy\//, ""),
        body: typeof body === "string" ? JSON.parse(body) : body,
        headers: new Headers(init?.headers),
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

function post(route: string): Call | undefined {
  return calls.find((c) => c.method === "POST" && c.route === route);
}

async function open(door: string) {
  nav.params = new URLSearchParams(`door=${door}`);
  render(<PlaygroundPage />);
  await waitFor(() => expect(screen.getByTestId(`${door}-door`)).toBeInTheDocument());
}

describe("the speech door", () => {
  it("offers the model's own voices, speaks, plays the clip and names what served it", async () => {
    handlers.set(
      "POST gateway/v1/audio/speech",
      () =>
        new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), {
          status: 200,
          headers: {
            "content-type": "audio/mpeg",
            "x-eugene-plexus-driver": "kokoro-a",
            "x-eugene-plexus-attempts": "1",
          },
        }),
    );
    await open("speech");
    const voices = [...screen.getByTestId("speech-voice").querySelectorAll("option")].map(
      (o) => o.value,
    );
    expect(voices).toEqual(["af_heart", "af_bella"]);
    const formats = [...screen.getByTestId("speech-format").querySelectorAll("option")].map(
      (o) => o.value,
    );
    expect(formats).toEqual(["mp3", "pcm"]);

    fireEvent.change(screen.getByTestId("speech-input"), { target: { value: "Good morning." } });
    fireEvent.change(screen.getByTestId("speech-voice"), { target: { value: "af_bella" } });
    fireEvent.click(screen.getByTestId("speech-send"));

    await waitFor(() => expect(screen.getByTestId("speech-audio")).toBeInTheDocument());
    expect(post("gateway/v1/audio/speech")!.body).toEqual({
      model: "kokoro",
      input: "Good morning.",
      voice: "af_bella",
      response_format: "mp3",
    });
    expect(screen.getByTestId("speech-audio").getAttribute("src")).toBe(
      "data:audio/mpeg;base64,SUQzBA==",
    );
    expect(screen.getByTestId("speech-download").getAttribute("download")).toBe("speech.mp3");
    expect(screen.getByTestId("door-report-summary").dataset.driver).toBe("kokoro-a");
  });

  it("plays pcm as a WAV but saves the bytes that came", async () => {
    handlers.set(
      "POST gateway/v1/audio/speech",
      () =>
        new Response(new Uint8Array([1, 0, 2, 0]), {
          status: 200,
          headers: { "content-type": "audio/pcm" },
        }),
    );
    await open("speech");
    fireEvent.change(screen.getByTestId("speech-format"), { target: { value: "pcm" } });
    fireEvent.click(screen.getByTestId("speech-send"));
    await waitFor(() => expect(screen.getByTestId("speech-audio")).toBeInTheDocument());
    expect(screen.getByTestId("speech-audio").getAttribute("src")).toMatch(
      /^data:audio\/wav;base64,UklGR/,
    );
    expect(screen.getByTestId("speech-download").getAttribute("href")).toBe(
      "data:audio/pcm;base64,AQACAA==",
    );
    expect(screen.getByTestId("speech-download").getAttribute("download")).toBe("speech.pcm");
  });

  it("shows a refusal in the gateway's words", async () => {
    handlers.set("POST gateway/v1/audio/speech", () =>
      json(400, {
        error: {
          message: "The backend rejected the request: no voice alloy.",
          type: "invalid_request_error",
        },
      }),
    );
    await open("speech");
    fireEvent.click(screen.getByTestId("speech-send"));
    await waitFor(() =>
      expect(screen.getByTestId("speech-error").textContent).toContain("no voice alloy"),
    );
    expect(screen.getByTestId("door-report-summary").dataset.status).toBe("400");
  });
});

describe("the transcription door", () => {
  function choose(name = "fox.mp3") {
    const file = new File([new Uint8Array([1, 2, 3])], name, { type: "audio/mpeg" });
    fireEvent.change(screen.getByTestId("transcription-file"), { target: { files: [file] } });
  }

  it("uploads the recording as the SDK's form and shows the words", async () => {
    handlers.set("POST gateway/v1/audio/transcriptions", () =>
      json(200, { text: "The quick brown fox." }, { "x-eugene-plexus-driver": "scribe-a" }),
    );
    await open("transcription");
    choose();
    fireEvent.change(screen.getByTestId("transcription-language"), { target: { value: "en" } });
    fireEvent.click(screen.getByTestId("transcription-send"));

    await waitFor(() =>
      expect(screen.getByTestId("transcription-text").textContent).toBe("The quick brown fox."),
    );
    const call = post("gateway/v1/audio/transcriptions")!;
    expect(call.body).toBeInstanceOf(FormData);
    const form = call.body as FormData;
    expect((form.get("file") as File).name).toBe("fox.mp3");
    expect(form.get("model")).toBe("scribe");
    expect(form.get("language")).toBe("en");
    expect(form.get("response_format")).toBe("json");
    // The browser sets the multipart boundary; a JSON type here would break it.
    expect(call.headers.get("content-type")).toBeNull();
    expect(screen.getByTestId("door-report-summary").dataset.driver).toBe("scribe-a");
  });

  it("translates through its own door, only with a model that translates, and sends no language", async () => {
    handlers.set("POST gateway/v1/audio/translations", () => json(200, { text: "Hello." }));
    await open("transcription");
    fireEvent.click(screen.getByTestId("task-translate"));
    const options = [...screen.getByTestId("door-model").querySelectorAll("option")].map(
      (o) => o.value,
    );
    expect(options).toEqual(["whisper"]);
    expect(screen.queryByTestId("transcription-language")).toBeNull();
    choose();
    fireEvent.click(screen.getByTestId("transcription-send"));
    await waitFor(() =>
      expect(screen.getByTestId("transcription-text").textContent).toBe("Hello."),
    );
    const form = post("gateway/v1/audio/translations")!.body as FormData;
    expect(form.get("model")).toBe("whisper");
    expect(form.get("language")).toBeNull();
  });

  it("reads text as the words themselves", async () => {
    handlers.set(
      "POST gateway/v1/audio/transcriptions",
      () => new Response("plain words", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    await open("transcription");
    choose();
    fireEvent.change(screen.getByTestId("transcription-format"), { target: { value: "text" } });
    fireEvent.click(screen.getByTestId("transcription-send"));
    await waitFor(() =>
      expect(screen.getByTestId("transcription-text").textContent).toBe("plain words"),
    );
  });
});
