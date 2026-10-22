import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { ModelRoleChips, ModelRoles } from "./ModelRoles";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: { get: vi.fn(), patch: vi.fn() },
}));

let slots: { model: string; targets: string[] }[];
const roles = [
  { role: "chat", label: "Chat", requiredCapability: "chat", models: [] },
  { role: "reads-pages", label: "Reads pages (OCR)", requiredCapability: "imageInput", models: [] },
];

beforeEach(() => {
  slots = [
    { model: "coder", targets: ["code", "cloud"] },
    { model: "role:chat", targets: ["plain"] },
  ];
  vi.mocked(api.get).mockImplementation(async (_target, path) => {
    if (path === "/v1/config") return { modelSlots: slots } as never;
    if (path === "/v1/roles") return { roles } as never;
    if (path === "/v1/models")
      return {
        data: [
          { id: "plain", x_eugene_plexus: { surfaces: ["chat"], image_input: false } },
          { id: "ocr", x_eugene_plexus: { surfaces: ["chat"], image_input: true } },
          { id: "embed", x_eugene_plexus: { surfaces: ["embeddings"] } },
        ],
      } as never;
    throw new Error(path);
  });
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.patch).mockImplementation(async (_target, _path, body) => {
    slots = (body as { modelSlots: typeof slots }).modelSlots;
    return { applied: ["modelSlots"], rejected: [] } as never;
  });
});

it("adding a model to Reads pages saves role:reads-pages and keeps the other slots", async () => {
  render(<ModelRoles />);
  const picker = await screen.findByRole("combobox", { name: "Add a model to Reads pages (OCR)" });
  const options = within(picker).getAllByRole("option");
  expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
    "",
    "ocr",
    "plain",
    "embed",
    "manual",
  ]);
  // Another editor saved while this page was open: preserve that entry too.
  slots = [...slots, { model: "new-slot", targets: ["other"] }];
  fireEvent.change(picker, { target: { value: "ocr" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to Reads pages (OCR)" }));
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith("gateway", "/v1/config", {
      modelSlots: [
        { model: "coder", targets: ["code", "cloud"] },
        { model: "role:chat", targets: ["plain"] },
        { model: "new-slot", targets: ["other"] },
        { model: "role:reads-pages", targets: ["ocr"] },
      ],
    }),
  );
  expect(
    await screen.findByRole("button", { name: "Remove ocr from Reads pages (OCR)" }),
  ).toBeEnabled();
});

it("chips append to a role and remove only this model, sharing the same slots", async () => {
  slots.push({ model: "role:reads-pages", targets: ["ocr", "other"] });
  render(<ModelRoleChips model="plain" />);
  const picker = await screen.findByRole("combobox", { name: "Add a role to plain" });
  fireEvent.change(picker, { target: { value: "reads-pages" } });
  fireEvent.click(screen.getByRole("button", { name: "Add role" }));
  await waitFor(() => expect(slots[2]!.targets).toEqual(["ocr", "other", "plain"]));
  fireEvent.click(await screen.findByRole("button", { name: "Remove Chat from plain" }));
  await waitFor(() => expect(slots.map((s) => s.model)).toEqual(["coder", "role:reads-pages"]));
  expect(slots[0]!.targets).toEqual(["code", "cloud"]);
});

it("reorders a role and permits a model with unknown capability", async () => {
  slots.push({ model: "role:reads-pages", targets: ["ocr", "plain"] });
  render(<ModelRoles />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Move plain up in Reads pages (OCR)" }),
  );
  await waitFor(() => expect(slots[2]!.targets).toEqual(["plain", "ocr"]));
  fireEvent.click(await screen.findByRole("button", { name: "Remove ocr from Reads pages (OCR)" }));
  await waitFor(() => expect(slots[2]!.targets).toEqual(["plain"]));
});

it("a refused save keeps the effective chips and names the cause", async () => {
  vi.mocked(api.patch).mockResolvedValue({
    applied: [],
    rejected: [{ key: "modelSlots", message: "config is read-only" }],
  } as never);
  render(<ModelRoleChips model="plain" />);
  fireEvent.click(await screen.findByRole("button", { name: "Remove Chat from plain" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("config is read-only");
  expect(screen.getByRole("button", { name: "Remove Chat from plain" })).toBeInTheDocument();
});

it("a successful save followed by a failed refresh does not show the old roles as effective", async () => {
  vi.mocked(api.patch).mockImplementation(async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("gateway disconnected after saving"));
    return { applied: ["modelSlots"], rejected: [] } as never;
  });
  render(<ModelRoleChips model="plain" />);
  fireEvent.click(await screen.findByRole("button", { name: "Remove Chat from plain" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("gateway disconnected after saving");
  expect(screen.queryByRole("button", { name: "Remove Chat from plain" })).not.toBeInTheDocument();
});
