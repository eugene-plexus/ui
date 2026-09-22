import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ConfigEditor } from "./ConfigEditor";

let fields: {
  key: string;
  label: string;
  category: string;
  valueType: string;
  showWhen?: { key: string; equals: unknown };
}[];
let doc: Record<string, unknown>;
let reject = false;
let failPatch = false;
let patches: Record<string, unknown>[];
beforeEach(() => {
  fields = [
    "modelRoots",
    "scanOnStartup",
    "catalogueBaseUrl",
    "starterModelsFile",
    "futureSetting",
  ].map((key) => ({
    key,
    label: key,
    category: "library",
    valueType: "string",
  }));
  doc = {
    modelRoots: "models",
    scanOnStartup: "scan",
    catalogueBaseUrl: "hub",
    starterModelsFile: "starters",
    futureSetting: "new",
  };
  patches = [];
  reject = false;
  failPatch = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let body: unknown;
      if (url.endsWith("/v1/config/schema")) body = { component: "library", fields };
      else if (init?.method === "PATCH" && failPatch) {
        return new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Config file not writable",
            status: 500,
            detail: "The library could not write its config file.",
          }),
          { status: 500, headers: { "content-type": "application/problem+json" } },
        );
      } else if (init?.method === "PATCH") {
        const patch = JSON.parse(String(init.body));
        patches.push(patch);
        if (!reject) doc = { ...doc, ...patch };
        body = {
          applied: reject ? [] : Object.keys(patch),
          rejected: reject ? [{ key: "catalogueBaseUrl", message: "Invalid address" }] : [],
          requiresRestart: false,
        };
      } else body = doc;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps the form and the typed value when a save fails", async () => {
  failPatch = true;
  render(<ConfigEditor target="library" label="Library" />);
  fireEvent.change(await screen.findByDisplayValue("new"), { target: { value: "typed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("could not write its config file");
  expect(screen.queryByText(/Failed to load/)).not.toBeInTheDocument();
  expect(screen.getByDisplayValue("typed")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});

it("names saved fields by their label, not their key", async () => {
  fields[4]!.label = "A setting from the future";
  render(<ConfigEditor target="library" label="Library" />);
  fireEvent.change(await screen.findByDisplayValue("new"), { target: { value: "newer" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const saved = await screen.findByText(/Saved:/);
  expect(saved).toHaveTextContent("Saved: A setting from the future");
  expect(saved).not.toHaveTextContent("futureSetting");
});

it("ties each field's name to its input", async () => {
  fields[4]!.label = "A setting from the future";
  render(<ConfigEditor target="library" label="Library" />);
  expect(await screen.findByLabelText("A setting from the future")).toHaveValue("new");
});

it("discards edits back to the saved values", async () => {
  render(<ConfigEditor target="library" label="Library" />);
  fireEvent.change(await screen.findByDisplayValue("new"), { target: { value: "typed" } });
  fireEvent.click(screen.getByTestId("config-discard"));
  expect(screen.getByDisplayValue("typed")).toBeVisible();
  fireEvent.click(screen.getByTestId("config-discard-confirm"));
  expect(screen.getByDisplayValue("new")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("asks before a link or a page close drops unsaved edits", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  // Stands in for Next's <Link>, whose own click handler does the routing:
  // `routed` counts the navigations the router would have made.
  let routed = 0;
  render(
    <>
      <a
        href="/library/"
        onClick={(e) => {
          e.preventDefault();
          routed += 1;
        }}
      >
        Library
      </a>
      <ConfigEditor target="library" label="Library" />
    </>,
  );
  const link = screen.getByRole("link", { name: "Library" });
  await screen.findByDisplayValue("new");
  // Nothing edited yet: leaving is not a question.
  fireEvent.click(link);
  expect(routed).toBe(1);
  expect(confirm).not.toHaveBeenCalled();

  fireEvent.change(screen.getByDisplayValue("new"), { target: { value: "typed" } });
  // Declined: the click never reaches the router.
  fireEvent.click(link);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(routed).toBe(1);
  expect(screen.getByDisplayValue("typed")).toBeVisible();

  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});

it("keeps unknown fields visible and saves edits made behind a collapsed group", async () => {
  render(<ConfigEditor target="library" label="Library" />);
  const more = await screen.findByRole("button", { name: /Show more/ });
  expect(screen.getByDisplayValue("new")).toBeVisible();
  expect(screen.getByDisplayValue("hub")).not.toBeVisible();
  fireEvent.click(more);
  fireEvent.change(screen.getByDisplayValue("hub"), { target: { value: "another-hub" } });
  fireEvent.click(screen.getByRole("button", { name: /Show less/ }));
  expect(screen.getByRole("button", { name: /Show more.*1 unsaved/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(patches).toEqual([{ catalogueBaseUrl: "another-hub" }]));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
});

it("opens rejected hidden settings and preserves their draft", async () => {
  reject = true;
  render(<ConfigEditor target="library" label="Library" />);
  fireEvent.click(await screen.findByRole("button", { name: /Show more/ }));
  fireEvent.change(screen.getByDisplayValue("hub"), { target: { value: "bad-address" } });
  fireEvent.click(screen.getByRole("button", { name: /Show less/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(/Invalid address/);
  expect(screen.getByDisplayValue("bad-address")).toBeVisible();
  expect(screen.getByRole("button", { name: /Show less/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

it("does not make a disclosure when fewer than three applicable settings qualify", async () => {
  fields[1]!.showWhen = { key: "futureSetting", equals: "not-selected" };
  render(<ConfigEditor target="library" label="Library" />);
  expect(await screen.findByDisplayValue("hub")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Show more/ })).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue("scan")).not.toBeInTheDocument();
});
