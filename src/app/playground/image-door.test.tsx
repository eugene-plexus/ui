/**
 * The Images door, driven as a page (U5 of playground-doors.md): nothing
 * is sent until the spending is confirmed, only the choices the model
 * lists are offered, and the pictures land on screen.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlaygroundPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/playground",
  useSearchParams: () => new URLSearchParams("door=image"),
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
let extraModels: Array<Record<string, unknown>>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
  flags = { surfaces: ["image"], image_edits: false, image_streaming: false, image_mask: false };
  extraModels = [];
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
            { id: "flux", object: "model", created: 0, owned_by: "x", x_eugene_plexus: flags },
            ...extraModels,
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

function sent(route: string): Call[] {
  return calls.filter((c) => c.method === "POST" && c.route === route);
}

async function open() {
  render(<PlaygroundPage />);
  await waitFor(() => expect(screen.getByTestId("image-door")).toBeInTheDocument());
}

describe("the images door", () => {
  it("asks before spending, sends nothing on Not now, and shows the pictures when confirmed", async () => {
    handlers.set("POST gateway/v1/images/generations", () =>
      json(200, {
        created: 0,
        data: [{ b64_json: "iVBORa", revised_prompt: "a sleeping fox" }],
        output_format: "png",
        usage: { total_tokens: 12 },
        x_eugene_plexus: { driver: "flux-a" },
      }),
    );
    await open();
    fireEvent.click(screen.getByTestId("image-send"));
    expect(screen.getByText(/bills the account/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("image-send-cancel"));
    expect(sent("gateway/v1/images/generations")).toHaveLength(0);

    fireEvent.change(screen.getByTestId("image-size"), { target: { value: "512x512" } });
    fireEvent.click(screen.getByTestId("image-send"));
    fireEvent.click(screen.getByTestId("image-send-confirm"));

    await waitFor(() => expect(screen.getByTestId("image-result")).toBeInTheDocument());
    expect(sent("gateway/v1/images/generations")[0]!.body).toMatchObject({
      model: "flux",
      size: "512x512",
    });
    expect(screen.getByTestId("image-result").getAttribute("src")).toBe(
      "data:image/png;base64,iVBORa",
    );
    expect(screen.getByTestId("image-download").getAttribute("download")).toBe("picture-1.png");
    expect(screen.getByText(/Drawn from: a sleeping fox/)).toBeInTheDocument();
    expect(screen.getByTestId("door-report-summary").dataset.driver).toBe("flux-a");
  });

  it("offers no editing, streaming or mask to a model that lists none", async () => {
    await open();
    expect(screen.queryByTestId("image-mode-edit")).toBeNull();
    expect(screen.queryByTestId("image-stream")).toBeNull();
  });

  it("edits with several pictures and a mask, as the SDK's form, where the model lists both", async () => {
    flags = { surfaces: ["image"], image_edits: true, image_streaming: false, image_mask: true };
    handlers.set("POST gateway/v1/images/edits", () =>
      json(200, { created: 0, data: [{ b64_json: "iVBORe" }], output_format: "png" }),
    );
    await open();
    fireEvent.click(screen.getByTestId("image-mode-edit"));
    const files = [
      new File([new Uint8Array([1])], "a.png", { type: "image/png" }),
      new File([new Uint8Array([2])], "b.png", { type: "image/png" }),
    ];
    fireEvent.change(screen.getByTestId("image-files"), { target: { files } });
    fireEvent.change(screen.getByTestId("image-mask"), {
      target: { files: [new File([new Uint8Array([3])], "m.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByTestId("image-send"));
    fireEvent.click(screen.getByTestId("image-send-confirm"));

    await waitFor(() => expect(screen.getByTestId("image-result")).toBeInTheDocument());
    const form = sent("gateway/v1/images/edits")[0]!.body as FormData;
    expect(form.getAll("image[]").map((f) => (f as File).name)).toEqual(["a.png", "b.png"]);
    expect((form.get("mask") as File).name).toBe("m.png");
    expect(form.get("model")).toBe("flux");
  });

  it("drops a mask picked for one model when the next model takes none", async () => {
    flags = { surfaces: ["image"], image_edits: true, image_streaming: false, image_mask: true };
    extraModels = [
      {
        id: "no-mask",
        object: "model",
        created: 0,
        owned_by: "x",
        x_eugene_plexus: { surfaces: ["image"], image_edits: true, image_mask: false },
      },
    ];
    handlers.set("POST gateway/v1/images/edits", () =>
      json(200, { created: 0, data: [{ b64_json: "iVBORe" }], output_format: "png" }),
    );
    await open();
    fireEvent.click(screen.getByTestId("image-mode-edit"));
    fireEvent.change(screen.getByTestId("image-files"), {
      target: { files: [new File([new Uint8Array([1])], "a.png", { type: "image/png" })] },
    });
    fireEvent.change(screen.getByTestId("image-mask"), {
      target: { files: [new File([new Uint8Array([3])], "m.png", { type: "image/png" })] },
    });
    fireEvent.change(screen.getByTestId("door-model"), { target: { value: "no-mask" } });
    expect(screen.queryByTestId("image-mask")).toBeNull();
    fireEvent.click(screen.getByTestId("image-send"));
    fireEvent.click(screen.getByTestId("image-send-confirm"));
    await waitFor(() => expect(sent("gateway/v1/images/edits")).toHaveLength(1));
    const form = sent("gateway/v1/images/edits")[0]!.body as FormData;
    expect(form.get("model")).toBe("no-mask");
    expect(form.get("mask")).toBeNull();
  });

  it("shows a streamed picture as it is drawn, then the finished one", async () => {
    flags = { surfaces: ["image"], image_edits: false, image_streaming: true, image_mask: false };
    const events = [
      {
        type: "image_generation.partial_image",
        b64_json: "iVBORp",
        partial_image_index: 0,
      },
      {
        type: "image_generation.completed",
        b64_json: "iVBORf",
        output_format: "png",
        x_eugene_plexus: { driver: "gpt-image-a" },
      },
    ];
    handlers.set(
      "POST gateway/v1/images/generations",
      () =>
        new Response(
          events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
    );
    await open();
    fireEvent.click(screen.getByTestId("image-stream"));
    fireEvent.click(screen.getByTestId("image-send"));
    fireEvent.click(screen.getByTestId("image-send-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("image-result").getAttribute("src")).toBe(
        "data:image/png;base64,iVBORf",
      ),
    );
    expect(sent("gateway/v1/images/generations")[0]!.body).toMatchObject({ stream: true });
    expect(screen.getByTestId("door-report-summary").dataset.driver).toBe("gpt-image-a");
  });
});
