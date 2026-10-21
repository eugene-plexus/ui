import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Topology } from "@/lib/resourceTree";
import type { ConfigSchema } from "@/lib/types";
import { AppShell } from "./AppShell";

const push = vi.fn();
const topology: Topology = {
  localNode: "desk",
  nodes: ["desk", "other"],
  components: [{ name: "gateway", kind: "gateway", node: "desk" }],
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/discover",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./ResourceTree", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ResourceTree")>()),
  useTopology: () => ({ topology, ready: true }),
}));
vi.mock("./TasksTray", () => ({ TasksTray: () => null }));
vi.mock("./IssuesBadge", () => ({ IssuesBadge: () => null }));
vi.mock("./RunDialog", () => ({ RunDialog: () => null }));
vi.mock("./TlsProbe", () => ({ TlsProbe: () => null }));
vi.mock("./InstallModeBanner", () => ({ InstallModeBanner: () => null }));

const schema: ConfigSchema = {
  component: "gateway",
  categories: { generation: "Generation" },
  fields: [
    {
      key: "defaultTemperature",
      label: "Answer warmth",
      description: "Temperature for replies",
      category: "generation",
      valueType: "number",
      sensitive: false,
      required: false,
      requiresRestart: false,
      pendingRestart: false,
    },
  ],
};
let fail = false;
let release: (() => void) | undefined;
let pending: Promise<void> | undefined;
let servedSchema: ConfigSchema;

beforeEach(() => {
  push.mockClear();
  localStorage.clear();
  fail = false;
  pending = undefined;
  release = undefined;
  servedSchema = schema;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      await pending;
      const url = String(input);
      return new Response(
        JSON.stringify(
          fail ? { detail: "gateway is locked" } : url.endsWith("/schema") ? servedSchema : {},
        ),
        {
          status: fail ? 503 : 200,
          headers: { "content-type": "application/json" },
        },
      );
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  render(
    <AppShell>
      <input aria-label="Another field" />
    </AppShell>,
  );
  return within(screen.getByRole("banner")).getByRole("combobox", { name: "Find a setting" });
}

describe("header settings search", () => {
  it("typing api key lists client keys and Enter opens its indexed page", async () => {
    const user = userEvent.setup();
    const input = setup();
    await user.type(input, "api key");
    const option = await screen.findByRole("option", { name: /Keys for your apps/ });
    expect(option).toHaveTextContent("Connect apps");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/connect");
  });

  it("loads once on first focus, announces loading, and searches all owners with the page matcher", async () => {
    const user = userEvent.setup();
    pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const input = setup();
    expect(fetch).not.toHaveBeenCalled();
    await user.click(input);
    expect(screen.getByText("Loading settings...")).toBeVisible();
    release!();
    await user.type(input, "warmth generation temperature");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("Answer warmth");
    expect(options[0]).toHaveTextContent("Answer defaults");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("node:other"), expect.anything());
    const calls = vi.mocked(fetch).mock.calls.length;
    await user.tab();
    await user.click(input);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(calls);
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith(
      "/config?q=warmth+generation+temperature&sel=gateway#defaultTemperature",
    );
  });

  it("Down and Up choose matches, clicks open them, and Escape closes the list", async () => {
    const user = userEvent.setup();
    const input = setup();
    await user.type(input, "key");
    const options = await screen.findAllByRole("option");
    expect(options.length).toBeLessThanOrEqual(8);
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[0]!.id);
    await user.keyboard("{ArrowDown}{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", options[0]!.id);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.type(input, "s");
    await user.click(await screen.findByRole("option", { name: /Keys for your apps/ }));
    expect(push).toHaveBeenCalledWith("/connect");
  });

  it("slash opens the search except in another field, and the narrow screen button opens it", async () => {
    const user = userEvent.setup();
    const input = setup();
    const other = screen.getByLabelText("Another field");
    await user.click(other);
    await user.keyboard("/");
    expect(other).toHaveFocus();
    expect(other).toHaveValue("/");
    other.blur();
    await user.keyboard("/");
    await waitFor(() => expect(input).toHaveFocus());
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Find a setting" }));
    expect(input).toHaveFocus();
  });

  it("shows the observed cause when loading fails", async () => {
    fail = true;
    const input = setup();
    fireEvent.focus(input);
    expect(await screen.findByText(/gateway is locked/)).toBeVisible();
  });

  it("slash opens search while keyboard focus is in the resource tree", async () => {
    const user = userEvent.setup();
    const input = setup();
    await user.click(screen.getByRole("treeitem", { name: "Gateway" }));
    await user.keyboard("/");
    await waitFor(() => expect(input).toHaveFocus());
  });

  it("limits results to eight and keeps hidden settings out of the index", async () => {
    servedSchema = {
      ...schema,
      fields: [
        ...Array.from({ length: 12 }, (_, index) => ({
          ...schema.fields[0]!,
          key: `warmth${index}`,
          label: `Warmth ${index}`,
        })),
        { ...schema.fields[0]!, key: "firstRunComplete", label: "Warmth hidden" },
        {
          ...schema.fields[0]!,
          key: "conditional",
          label: "Warmth conditional",
          showWhen: { key: "enabled", equals: true },
        },
      ],
    };
    const user = userEvent.setup();
    const input = setup();
    await user.type(input, "warmth");
    expect(await screen.findAllByRole("option")).toHaveLength(8);
    await user.clear(input);
    await user.type(input, "warmth hidden");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "warmth conditional");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByText("No settings found.")).toBeVisible();
  });

  it("finds browser appearance settings and opens their card", async () => {
    const user = userEvent.setup();
    const input = setup();
    await user.type(input, "font size");
    await user.click(await screen.findByRole("option", { name: /Theme, font size and About/ }));
    expect(push).toHaveBeenCalledWith("/config?q=font+size#appearance");
  });
});
