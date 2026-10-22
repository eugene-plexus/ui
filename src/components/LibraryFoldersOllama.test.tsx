/**
 * CX9: an Ollama store in the Folders page. It reads as Ollama's and
 * read-only; a found one is stopped, not removed, and is never written back
 * into `modelRoots`.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LibraryFolders } from "./LibraryFolders";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/library/folders",
  useSearchParams: () => new URLSearchParams(),
}));

let sent: { key: string; body: unknown }[];

beforeEach(() => {
  sent = [];
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^\/api\/proxy\//, "");
      const key = `${init?.method ?? "GET"} ${route}`;
      if (init?.method && init.method !== "GET") {
        sent.push({ key, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
      }
      const body =
        key === "GET library/v1/folders"
          ? {
              folders: [
                {
                  path: "/models",
                  mounts: [],
                  readOnly: true,
                  readOnlyReason:
                    "/models is a link into the Ollama model store. Choose another folder.",
                },
                { path: "/home/a/.ollama/models", mounts: [], kind: "ollama", found: true },
              ],
            }
          : key.endsWith("/v1/library/folders/check")
            ? { libraryConsulted: true, folders: [] }
            : key === "GET agent/v1/node"
              ? { enrolled: false, name: null, devices: [] }
              : key === "GET agent/v1/components"
                ? { components: [] }
                : key === "PATCH library/v1/config"
                  ? { applied: ["x"], rejected: [] }
                  : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

async function grid() {
  render(<LibraryFolders nodeName={undefined} />);
  return await screen.findByTestId("folders-grid", {}, { timeout: 5000 });
}

it("labels an Ollama folder read-only and found, with Stop showing instead of remove", async () => {
  const g = await grid();
  const row = (await within(g).findByTestId("folder-ollama")).closest("tr")!;
  expect(within(row).getByTestId("folder-ollama")).toHaveTextContent(
    "Ollama’s models (read-only) · found on this machine",
  );
  expect(within(row).queryByRole("button", { name: "remove" })).toBeNull();
  expect(within(row).getByRole("button", { name: "Stop showing" })).toBeInTheDocument();
  // The ordinary folder keeps remove.
  expect(within(g).getAllByRole("button", { name: "remove" })).toHaveLength(1);
});

it("Stop showing turns the library's own look off", async () => {
  const g = await grid();
  await userEvent.click(await within(g).findByRole("button", { name: "Stop showing" }));
  await vi.waitFor(() =>
    expect(sent.find((s) => s.key === "PATCH library/v1/config")?.body).toEqual({
      findOllama: false,
    }),
  );
});

it("shows why a linked folder is read-only and keeps derived status out of config", async () => {
  const g = await grid();
  expect(await within(g).findByTestId("folder-read-only")).toHaveTextContent(
    "is a link into the Ollama model store",
  );
});

it("never saves a found folder into modelRoots", async () => {
  const g = await grid();
  await userEvent.type((await within(g).findAllByTestId("mount-posix"))[0]!, "/mnt/m");
  await userEvent.click(screen.getByTestId("folders-save"));
  await vi.waitFor(() => expect(sent.some((s) => s.key === "PATCH library/v1/config")).toBe(true));
  expect(sent.find((s) => s.key === "PATCH library/v1/config")?.body).toEqual({
    modelRoots: [{ path: "/models", mounts: ["/mnt/m"] }],
  });
});

it("saves a configured folder as an Ollama store when Holds is changed", async () => {
  const g = await grid();
  const rows = await within(g).findAllByRole("combobox", { name: "Holds" });
  expect(rows).toHaveLength(1); // the found folder has none
  expect(
    within(g).getByLabelText("Folder path on the Library's machine", {
      selector: "input:not([disabled])",
    }),
  ).toBeEnabled();
  await userEvent.selectOptions(rows[0]!, "An Ollama store");
  await userEvent.click(screen.getByTestId("folders-save"));
  await vi.waitFor(() => expect(sent.some((s) => s.key === "PATCH library/v1/config")).toBe(true));
  expect(sent.find((s) => s.key === "PATCH library/v1/config")?.body).toEqual({
    modelRoots: [{ path: "/models", mounts: [], kind: "ollama" }],
  });
});
