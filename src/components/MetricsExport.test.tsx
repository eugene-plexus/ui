import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api";
import * as clipboard from "@/lib/clipboard";
import type { MetricsExport } from "@/lib/types";

import { MetricsExportPanel } from "./MetricsExport";

afterEach(() => vi.restoreAllMocks());

function serve(info: MetricsExport | Error) {
  return vi.spyOn(api, "get").mockImplementation(async (target: string, path: string) => {
    if (path === "/v1/metrics/export") {
      if (info instanceof Error) throw info;
      return info;
    }
    if (path === "/v1/nodes") {
      return { nodes: [{ name: "box", url: "http://192.168.1.10:8079" }] };
    }
    if (path === "/v1/components") {
      return {
        components: [{ kind: "gateway", url: "http://127.0.0.1:8080", name: "gateway" }],
      };
    }
    return { name: "box" };
  });
}

describe("the Export panel", () => {
  it("says Prometheus is not scraped yet and the collector is off", async () => {
    serve({ prometheus: { path: "/metrics" }, otlp: { state: "off" } });
    render(<MetricsExportPanel />);
    expect(await screen.findByTestId("export-prometheus")).toHaveTextContent("Not scraped yet.");
    expect(screen.getByTestId("export-otlp")).toHaveTextContent("Not sending to a collector.");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/config?sel=gateway#telemetryOtlpEndpoint",
    );
    expect(screen.getByText(/Never a prompt, an answer or a person/)).toBeInTheDocument();
  });

  it("names the cause of a failing export and says requests are served as usual", async () => {
    serve({
      prometheus: { path: "/metrics" },
      otlp: {
        state: "failing",
        endpoint: "http://collector:4318",
        lastError: "could not connect to collector:4318: connection refused",
      },
    });
    render(<MetricsExportPanel />);
    const line = await screen.findByTestId("export-otlp");
    await waitFor(() => expect(line).toHaveTextContent("is failing"));
    expect(line).toHaveTextContent("connection refused");
    expect(line).toHaveTextContent("Requests are served as usual.");
  });

  it("makes a scrape key that reads numbers and runs no model, and shows it once", async () => {
    serve({ prometheus: { path: "/metrics" }, otlp: { state: "off" } });
    const post = vi
      .spyOn(api, "post")
      .mockResolvedValue({ key: { id: "k1" }, token: "shown-once-token" });
    const copied: string[] = [];
    vi.spyOn(clipboard, "copyText").mockImplementation(async (text: string) => {
      copied.push(text);
      return true;
    });
    render(<MetricsExportPanel />);
    await screen.findByTestId("export-prometheus");
    fireEvent.click(screen.getByRole("button", { name: "Make a scrape key" }));
    expect(await screen.findByTestId("export-fresh-key")).toHaveTextContent("shown once");
    expect(post).toHaveBeenCalledWith("agent", "/v1/auth/client-keys", {
      name: "Prometheus",
      limits: { allowedModels: [], readMetrics: true },
    });
    expect(screen.getByText("shown-once-token")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Copy scrape configuration/ }));
    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copied[0]).toContain("credentials: 'shown-once-token'");
    expect(copied[0]).toContain("targets: ['192.168.1.10:8079']");
  });

  it("copies a file with a placeholder before a key is made", async () => {
    serve({ prometheus: { path: "/metrics" }, otlp: { state: "off" } });
    const copied: string[] = [];
    vi.spyOn(clipboard, "copyText").mockImplementation(async (text: string) => {
      copied.push(text);
      return true;
    });
    render(<MetricsExportPanel />);
    await screen.findByTestId("export-prometheus");
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("control", "/v1/nodes"));
    fireEvent.click(screen.getByRole("button", { name: /Copy scrape configuration/ }));
    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copied[0]).toContain("YOUR_SCRAPE_KEY");
  });

  it("says why a key could not be made", async () => {
    serve({ prometheus: { path: "/metrics" }, otlp: { state: "off" } });
    vi.spyOn(api, "post").mockRejectedValue(new Error("The key authority did not answer."));
    render(<MetricsExportPanel />);
    await screen.findByTestId("export-prometheus");
    fireEvent.click(screen.getByRole("button", { name: "Make a scrape key" }));
    expect(await screen.findByText(/key authority did not answer/)).toBeInTheDocument();
    expect(screen.queryByTestId("export-fresh-key")).toBeNull();
  });

  it("says the gateway did not answer, and does not say the export is off", async () => {
    serve(new Error("The gateway did not answer."));
    render(<MetricsExportPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Export state unavailable. The gateway did not answer.",
    );
    expect(screen.getByTestId("export-otlp")).not.toHaveTextContent("Not sending");
  });

  it("says an older gateway has no export, rather than that the export is off", async () => {
    vi.spyOn(api, "get").mockImplementation(async (_target: string, path: string) => {
      if (path === "/v1/metrics/export") throw new ApiError(404, "Not Found", {});
      return { name: "box", components: [], nodes: [] };
    });
    render(<MetricsExportPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("older than metrics export");
    expect(screen.getByTestId("export-otlp")).not.toHaveTextContent("Not sending");
  });
});
