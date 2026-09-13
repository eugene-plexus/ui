/**
 * The directory picker, driven (M11).
 *
 * What matters is the sequence of calls: the roots with no path, a
 * directory when one is chosen, the typed path when one is submitted,
 * and that "use this folder" hands back what is currently listed — on
 * the component's host, whose name the header carries.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FolderPicker } from "./FolderPicker";

let calls: string[];
let endpointMissing: boolean;

beforeEach(() => {
  calls = [];
  endpointMissing = false;
  const seen = calls;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (endpointMissing) return json({ detail: "Not Found" }, 404);
      const parsed = new URL(url, "http://ui.invalid");
      const path = parsed.searchParams.get("path");
      if (path === null) {
        return json({
          host: "nas",
          entries: [
            { name: "/", path: "/", kind: "directory" },
            { name: "Home", path: "/home/x", kind: "directory" },
          ],
        });
      }
      if (path === "/home/x") {
        return json({
          host: "nas",
          path: "/home/x",
          parent: "/home",
          entries: [{ name: "models", path: "/home/x/models", kind: "directory" }],
        });
      }
      if (path === "/models") {
        return json({ host: "nas", path: "/models", parent: "/", entries: [] });
      }
      return json(
        {
          detail: {
            title: "No such directory",
            status: 404,
            detail: `${path} does not exist on nas.`,
            component: "library",
          },
        },
        404,
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FolderPicker", () => {
  it("starts at the roots, names the host, descends, and hands back the listed folder", async () => {
    const onPick = vi.fn();
    render(<FolderPicker target="library" onPick={onPick} onClose={() => {}} />);

    await screen.findByText("Home");
    expect(screen.getByText("nas")).toBeInTheDocument();
    expect(calls[0]).toBe("/api/proxy/library/v1/directories");
    // Nothing is listed yet, so nothing can be picked.
    expect(screen.getByRole("button", { name: "use this folder" })).toBeDisabled();

    fireEvent.click(screen.getByText("Home"));
    await screen.findByText("models");
    expect(calls[1]).toBe("/api/proxy/library/v1/directories?path=%2Fhome%2Fx");

    fireEvent.click(screen.getByRole("button", { name: "use this folder" }));
    expect(onPick).toHaveBeenCalledWith("/home/x");
  });

  it("goes up to the parent, and a typed path is listed as typed", async () => {
    render(
      <FolderPicker target="library" initialPath="/home/x" onPick={() => {}} onClose={() => {}} />,
    );
    await screen.findByText("models");
    expect(calls[0]).toBe("/api/proxy/library/v1/directories?path=%2Fhome%2Fx");

    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "/models" } });
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    await screen.findByText("No subdirectories here.");
    expect(calls[1]).toBe("/api/proxy/library/v1/directories?path=%2Fmodels");

    fireEvent.click(screen.getByRole("button", { name: "up" }));
    await waitFor(() => expect(calls[2]).toBe("/api/proxy/library/v1/directories?path=%2F"));
  });

  it("a directory that is not there shows the component's own sentence", async () => {
    render(
      <FolderPicker target="library" initialPath="/nope" onPick={() => {}} onClose={() => {}} />,
    );
    await screen.findByText("/nope does not exist on nas.");
  });

  it("a component without the endpoint says so rather than showing an empty disk", async () => {
    endpointMissing = true;
    render(<FolderPicker target="gateway" onPick={() => {}} onClose={() => {}} />);
    await screen.findByText(/cannot list directories/);
    expect(screen.queryByText("No subdirectories here.")).not.toBeInTheDocument();
  });
});
