/**
 * The Video door, driven as a page (U6 of playground-doors.md): nothing
 * is made until the spending is confirmed, the job is watched until it
 * finishes, and the finished video is fetched and shown.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlaygroundPage from "./page";

// A real job takes minutes; the page asks every POLL_MS.
vi.mock("@/lib/videoDoor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/videoDoor")>()),
  POLL_MS: 5,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/playground",
  useSearchParams: () => new URLSearchParams("door=video"),
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
}

let calls: Call[];
let handlers: Map<string, (init?: RequestInit) => Response>;
let flags: Record<string, unknown>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const job = (status: string, extra: Record<string, unknown> = {}) => ({
  id: "vid.signed/handle",
  object: "video",
  model: "veo",
  status,
  progress: 0,
  created_at: 0,
  completed_at: null,
  expires_at: null,
  prompt: "a boat",
  size: "1280x720",
  seconds: "4",
  remixed_from_video_id: null,
  error: null,
  ...extra,
});

const POLL = "GET gateway/v1/videos/vid.signed%2Fhandle";
const CONTENT = "GET gateway/v1/videos/vid.signed%2Fhandle/content";

beforeEach(() => {
  calls = [];
  flags = {
    surfaces: ["video"],
    video_durations: [4, 8],
    video_sizes: ["1280x720"],
    video_first_frame: false,
  };
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
            {
              id: "chat",
              object: "model",
              created: 0,
              owned_by: "x",
              x_eugene_plexus: { surfaces: ["chat"] },
            },
            { id: "veo", object: "model", created: 0, owned_by: "x", x_eugene_plexus: flags },
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
      const body = init?.body;
      const call: Call = {
        method: init?.method ?? "GET",
        route: String(input).replace(/^\/api\/proxy\//, ""),
        body: typeof body === "string" ? JSON.parse(body) : body,
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

function count(key: string): number {
  return calls.filter((c) => `${c.method} ${c.route}` === key).length;
}

async function open() {
  render(<PlaygroundPage />);
  await waitFor(() => expect(screen.getByTestId("video-door")).toBeInTheDocument());
}

function confirmSend() {
  fireEvent.click(screen.getByTestId("video-send"));
  fireEvent.click(screen.getByTestId("video-send-confirm"));
}

describe("the video door", () => {
  it("asks before spending, then watches the job and shows the finished video", async () => {
    handlers.set("POST gateway/v1/videos", () =>
      json(200, job("queued", { x_eugene_plexus: { driver: "veo-a" } })),
    );
    const answers = [job("in_progress", { progress: 40 }), job("completed", { progress: 100 })];
    handlers.set(POLL, () => json(200, answers.shift() ?? job("completed", { progress: 100 })));
    handlers.set(
      CONTENT,
      () =>
        new Response(new Uint8Array([0, 0, 0, 24]), {
          status: 200,
          headers: { "content-type": "video/mp4" },
        }),
    );
    await open();
    const lengths = [...screen.getByTestId("video-seconds").querySelectorAll("option")].map(
      (o) => o.value,
    );
    expect(lengths).toEqual(["", "4", "8"]);
    fireEvent.change(screen.getByTestId("video-seconds"), { target: { value: "8" } });

    fireEvent.click(screen.getByTestId("video-send"));
    expect(screen.getByText(/bills the account/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("video-send-cancel"));
    expect(count("POST gateway/v1/videos")).toBe(0);

    confirmSend();
    await waitFor(() => expect(screen.getByTestId("video-result")).toBeInTheDocument());
    expect(calls.find((c) => c.method === "POST" && c.route === "gateway/v1/videos")!.body).toEqual(
      {
        model: "veo",
        prompt: "A paper boat drifting down a rainy street, close up",
        seconds: "8",
      },
    );
    expect(screen.getByTestId("video-status").textContent).toBe("Finished.");
    expect(count(CONTENT)).toBe(1);
    expect(screen.getByTestId("video-download").getAttribute("download")).toBe("video.mp4");
    expect(screen.getByTestId("door-report-summary").dataset.driver).toBe("veo-a");
  });

  it("says why a job failed, and fetches nothing", async () => {
    handlers.set("POST gateway/v1/videos", () => json(200, job("queued")));
    handlers.set(POLL, () =>
      json(200, job("failed", { error: { code: "x", message: "no credit left" } })),
    );
    await open();
    confirmSend();
    await waitFor(() =>
      expect(screen.getByTestId("video-status").textContent).toBe("It failed: no credit left."),
    );
    expect(count(CONTENT)).toBe(0);
  });

  it("stops asking when told to stop watching", async () => {
    handlers.set("POST gateway/v1/videos", () => json(200, job("queued")));
    handlers.set(POLL, () => json(200, job("in_progress", { progress: 10 })));
    await open();
    confirmSend();
    await waitFor(() => expect(count(POLL)).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("video-watch"));
    const asked = count(POLL);
    await new Promise((r) => setTimeout(r, 60));
    expect(count(POLL)).toBe(asked);
    expect(screen.getByText(/keeps running at the provider/)).toBeInTheDocument();
  });

  it("sends a first frame as the SDK's form only where the model takes one", async () => {
    flags = { surfaces: ["video"], video_first_frame: true };
    handlers.set("POST gateway/v1/videos", () => json(200, job("completed")));
    handlers.set(
      CONTENT,
      () =>
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-type": "video/mp4" },
        }),
    );
    await open();
    fireEvent.change(screen.getByTestId("video-first-frame"), {
      target: { files: [new File([new Uint8Array([1])], "start.png", { type: "image/png" })] },
    });
    confirmSend();
    await waitFor(() => expect(count("POST gateway/v1/videos")).toBe(1));
    const form = calls.find((c) => c.route === "gateway/v1/videos")!.body as FormData;
    expect((form.get("input_reference") as File).name).toBe("start.png");
  });

  it("offers no first frame to a model that does not take one", async () => {
    await open();
    expect(screen.queryByTestId("video-first-frame")).toBeNull();
  });
});
