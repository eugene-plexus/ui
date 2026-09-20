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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let body: unknown;
      if (url.endsWith("/v1/config/schema")) body = { component: "library", fields };
      else if (init?.method === "PATCH") {
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
afterEach(() => vi.unstubAllGlobals());

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
