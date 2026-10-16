import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfigEditor } from "./ConfigEditor";
import type { ConfigField } from "@/lib/types";

const field = (
  key: string,
  label: string,
  valueType: ConfigField["valueType"],
  value: unknown,
): ConfigField => ({
  key,
  label,
  valueType,
  default: value,
  category: "documents",
  required: false,
  sensitive: false,
  requiresRestart: false,
  pendingRestart: false,
});
let fields: ConfigField[];
let doc: Record<string, unknown>;
let patches: Record<string, unknown>[];

beforeEach(() => {
  fields = [
    field("documentsEnabled", "Read documents", "boolean", true),
    {
      ...field("documentsEmbeddingModel", "Search model", "string", "auto"),
      suggestions: ["auto", "embedding"],
      status: { level: "info", text: "In use: embedding (automatic)." },
    },
    {
      ...field("documentsSortModel", "Result sorter", "string", "auto"),
      suggestions: ["auto", "off", "sorter"],
    },
    { ...field("documentsSortSeconds", "Sorting time", "number", 3), minimum: 0.5, maximum: 120 },
    field("documentsMaxFileMB", "File size limit", "integer", 50),
    field("futureSetting", "A new setting", "string", "new"),
  ];
  doc = Object.fromEntries(fields.map((f) => [f.key, f.default]));
  patches = [];
  window.history.replaceState(null, "", "/apps/settings");
  Element.prototype.scrollIntoView = vi.fn();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      let body: unknown = doc;
      if (url.endsWith("/schema"))
        body = { component: "workbench", categories: { documents: "Documents" }, fields };
      else if (init?.method === "PATCH") {
        const patch = JSON.parse(String(init.body));
        patches.push(patch);
        doc = { ...doc, ...patch };
        body = { applied: Object.keys(patch), rejected: [], requiresRestart: false };
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
const open = () => render(<ConfigEditor target="agent" label="Workbench" />);

it("keeps everyday and unknown settings visible, and explains the active search without a model editor", async () => {
  open();
  expect(await screen.findByLabelText("Read documents")).toBeVisible();
  expect(screen.getByLabelText("A new setting")).toBeVisible();
  expect(screen.getByLabelText("Search model")).not.toBeVisible();
  expect(
    within(screen.getByRole("list", { name: "Current custom settings" })).getByText(
      "In use: embedding (automatic).",
    ),
  ).toBeVisible();
  expect(screen.getByText("documentsEnabled")).not.toBeVisible();
  expect(patches).toEqual([]);
});

it("shows saved overrides and unsaved edits while customization is collapsed, and saves only the edit", async () => {
  doc.documentsMaxFileMB = 75;
  open();
  await screen.findByLabelText("Read documents");
  expect(screen.getByRole("list", { name: "Current custom settings" })).toHaveTextContent(
    "File size limit — 75 · Customized",
  );
  fireEvent.click(screen.getByRole("button", { name: /^Customize/ }));
  fireEvent.change(screen.getByLabelText("Sorting time"), { target: { value: "7.25" } });
  fireEvent.click(screen.getByRole("button", { name: /^Hide customization/ }));
  expect(screen.getByLabelText("Sorting time")).not.toBeVisible();
  expect(screen.getByRole("list", { name: "Current custom settings" })).toHaveTextContent(
    "Sorting time — 7.25 · Unsaved",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(patches).toEqual([{ documentsSortSeconds: 7.25 }]));
  expect(doc.documentsMaxFileMB).toBe(75);
});

it("searches raw config keys, shows the match, and keeps edits when the search changes", async () => {
  open();
  const search = await screen.findByRole("searchbox", { name: "Find a setting" });
  fireEvent.change(search, { target: { value: "documentsSortModel" } });
  expect(screen.getByRole("combobox", { name: "Result sorter" })).toBeVisible();
  fireEvent.change(screen.getByLabelText("Result sorter"), { target: { value: "choice-1" } });
  fireEvent.change(search, { target: { value: "futureSetting" } });
  expect(screen.getByLabelText("Result sorter")).toHaveDisplayValue("Off");
  fireEvent.change(search, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(patches).toEqual([{ documentsSortModel: "off" }]));
});

it("keeps warnings and pending restart state outside collapsed tuning", async () => {
  fields[1]!.status = { level: "warning", text: "Search is paused until you rebuild." };
  fields[4] = { ...fields[4]!, pendingRestart: true, inEffect: 50 };
  doc.documentsMaxFileMB = 80;
  open();
  expect(await screen.findByLabelText("Search model")).toBeVisible();
  expect(screen.getByText("Search is paused until you rebuild.")).toBeVisible();
  expect(screen.getByTestId("pending-documentsMaxFileMB")).toBeVisible();
  expect(screen.getByTestId("pending-documentsMaxFileMB")).toHaveTextContent("50");
});

it("never exposes a credential or nested credential through the collapsed summary", async () => {
  fields[4] = { ...fields[4]!, valueType: "secret", sensitive: true, default: null };
  doc.documentsMaxFileMB = "secret-to-not-display";
  fields.push(field("documentsFolderMaxMB", "Connection entries", "share_credentials", []));
  doc.documentsFolderMaxMB = [{ host: "nas", username: "person", password: "nested-secret" }];
  open();
  await screen.findByLabelText("Read documents");
  const summary = screen.getByRole("list", { name: "Current custom settings" });
  expect(summary).toHaveTextContent("File size limit — Set");
  expect(summary).toHaveTextContent("Connection entries — 1 entry");
  expect(summary).not.toHaveTextContent("secret-to-not-display");
  expect(summary).not.toHaveTextContent("nested-secret");
});

it("opens an app setting from its fragment and follows later fragment changes", async () => {
  window.history.replaceState(null, "", "/apps/settings#documentsSortModel");
  open();
  await waitFor(() => expect(screen.getByLabelText("Result sorter")).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: /^Hide customization/ }));
  window.history.replaceState(null, "", "/apps/settings#documentsMaxFileMB");
  fireEvent(window, new Event("hashchange"));
  await waitFor(() => expect(screen.getByLabelText("File size limit")).toBeVisible());
  expect(patches).toEqual([]);
});
