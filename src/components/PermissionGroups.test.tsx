/**
 * Row 70: a permission group's Policies section.
 *
 * A root that knows policies answers every group with a `policies` object,
 * null for each policy not set; an older root leaves it out and refuses it
 * on a write, so the section is shown only when the root's records carry it.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import type { PermissionGroup, Person } from "@/lib/types";

import { ActiveGroup, PermissionGroups } from "./PermissionGroups";

const WHEN = "2026-10-21T00:00:00Z";
const UNSET = {
  queueBand: null,
  summaryContextPercent: null,
  roleRouting: null,
  allowedModels: null,
};

function group(id: string, name: string, extra: Partial<PermissionGroup> = {}): PermissionGroup {
  return {
    id,
    name,
    description: "",
    apps: [],
    permissions: [],
    createdAt: WHEN,
    updatedAt: WHEN,
    ...extra,
  };
}

function show(groups: PermissionGroup[]) {
  const changed = vi.fn().mockResolvedValue(undefined);
  render(
    <PermissionGroups groups={groups} clients={[]} people={[]} error={null} onChanged={changed} />,
  );
  return changed;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a group's policies", () => {
  it("shows each policy the group sets, and Not set for the rest", () => {
    show([
      group("g-desk", "Desk", { policies: UNSET }),
      group("g-night", "Night shift", {
        policies: { ...UNSET, queueBand: "background", summaryContextPercent: 70 },
      }),
    ]);
    const desk = within(screen.getByTestId("group-g-desk"));
    expect(desk.getByTestId("group-queue-g-desk")).toHaveTextContent("Queue priority: Not set");
    expect(desk.getByTestId("group-summary-g-desk")).toHaveTextContent(
      "Summarise long chats at: Not set",
    );
    const night = within(screen.getByTestId("group-g-night"));
    expect(night.getByTestId("group-queue-g-night")).toHaveTextContent(
      "Queue priority: Background",
    );
    expect(night.getByTestId("group-summary-g-night")).toHaveTextContent(
      "Summarise long chats at: 70%",
    );
  });

  it("saves the policies chosen, and Not set as null", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    const user = userEvent.setup();
    show([group("g-desk", "Desk", { policies: UNSET })]);
    const card = within(screen.getByTestId("group-g-desk"));
    await user.click(card.getByText("Edit Desk"));
    const queue = card.getByLabelText("Queue priority");
    const summary = card.getByLabelText("Summarise long chats at");
    expect(queue).toHaveDisplayValue("Not set");
    expect(summary).toHaveDisplayValue("Not set");
    await user.selectOptions(queue, "Background");
    await user.selectOptions(summary, "70%");
    await user.click(card.getByRole("button", { name: "Save group" }));
    await card.findByText("Group saved.");
    expect(put).toHaveBeenLastCalledWith(
      "control",
      "/v1/permission-groups/g-desk",
      {
        name: "Desk",
        description: "",
        apps: [],
        permissions: [],
        policies: { ...UNSET, queueBand: "background", summaryContextPercent: 70 },
      },
      { bearer: undefined },
    );
    await user.selectOptions(queue, "Not set");
    await user.selectOptions(summary, "Not set");
    await user.click(card.getByRole("button", { name: "Save group" }));
    await card.findByText("Group saved.");
    expect(put).toHaveBeenLastCalledWith(
      "control",
      "/v1/permission-groups/g-desk",
      expect.objectContaining({ policies: UNSET }),
      { bearer: undefined },
    );
  });

  it("shows a percent the root holds even when it is not a step of five", async () => {
    const user = userEvent.setup();
    show([group("g-odd", "Odd", { policies: { ...UNSET, summaryContextPercent: 72 } })]);
    const card = within(screen.getByTestId("group-g-odd"));
    expect(card.getByTestId("group-summary-g-odd")).toHaveTextContent("72%");
    await user.click(card.getByText("Edit Odd"));
    expect(card.getByLabelText("Summarise long chats at")).toHaveDisplayValue("72%");
  });

  it("hides the section, and sends no policies, for a root that has none", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    const user = userEvent.setup();
    show([group("g-old", "Old root group")]);
    const card = within(screen.getByTestId("group-g-old"));
    expect(card.queryByTestId("group-queue-g-old")).not.toBeInTheDocument();
    await user.click(card.getByText("Edit Old root group"));
    expect(card.queryByLabelText("Queue priority")).not.toBeInTheDocument();
    await user.click(card.getByRole("button", { name: "Save group" }));
    await card.findByText("Group saved.");
    expect(put.mock.calls[0]?.[2]).not.toHaveProperty("policies");
  });

  it("offers policies on a new group once the root shows it knows them", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    const user = userEvent.setup();
    show([group("g-desk", "Desk", { policies: UNSET })]);
    await user.click(screen.getByRole("button", { name: "Add group" }));
    const form = within(screen.getByTestId("group-new"));
    await user.type(form.getByLabelText("Group name"), "Batch");
    await user.selectOptions(form.getByLabelText("Queue priority"), "Sheddable");
    await user.click(form.getByRole("button", { name: "Create group" }));
    expect(post).toHaveBeenCalledWith(
      "control",
      "/v1/permission-groups",
      {
        name: "Batch",
        description: "",
        apps: [],
        permissions: [],
        policies: { ...UNSET, queueBand: "sheddable" },
      },
      { bearer: undefined },
    );
  });

  it("links each group to its memory servers in Workbench Settings", () => {
    const settings = "http://box.example:8190/settings#groups";
    const changed = vi.fn().mockResolvedValue(undefined);
    render(
      <PermissionGroups
        groups={[group("g-desk", "Desk", { policies: UNSET }), group("g-old", "Old")]}
        clients={[]}
        people={[]}
        error={null}
        onChanged={changed}
        workbenchSettings={settings}
      />,
    );
    const desk = within(screen.getByTestId("group-g-desk"));
    expect(desk.getByTestId("group-memory-servers-g-desk")).toHaveTextContent(
      "Memory servers for this group: Workbench Settings",
    );
    expect(desk.getByRole("link", { name: "Workbench Settings" })).toHaveAttribute(
      "href",
      settings,
    );
    // An older root has no policies, and no Workbench has no Settings to link to.
    expect(
      within(screen.getByTestId("group-g-old")).queryByTestId("group-memory-servers-g-old"),
    ).not.toBeInTheDocument();
  });

  it("names no Workbench Settings when this install has no Workbench", () => {
    show([group("g-desk", "Desk", { policies: UNSET })]);
    expect(screen.queryByTestId("group-memory-servers-g-desk")).not.toBeInTheDocument();
  });

  it("shows All models and Install default when a group sets neither (row 37)", () => {
    show([group("g-desk", "Desk", { policies: UNSET })]);
    const desk = within(screen.getByTestId("group-g-desk"));
    expect(desk.getByTestId("group-models-g-desk")).toHaveTextContent("Models: All models");
    expect(desk.getByTestId("group-routing-g-desk")).toHaveTextContent(
      "Routing by role: Install default for every role",
    );
  });

  it("saves Models and Routing by role, and clears them back to the defaults (row 37)", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    const user = userEvent.setup();
    show([group("g-sales", "Sales", { policies: UNSET })]);
    const card = within(screen.getByTestId("group-g-sales"));
    await user.click(card.getByText("Edit Sales"));
    await user.click(card.getByLabelText("Only these models"));
    await user.type(card.getByLabelText("Models this group may use"), "m1{enter}qwen3-*");
    await user.type(card.getByLabelText("Chat"), "m2, m1");
    await user.click(card.getByRole("button", { name: "Save group" }));
    await card.findByText("Group saved.");
    expect(put).toHaveBeenLastCalledWith(
      "control",
      "/v1/permission-groups/g-sales",
      expect.objectContaining({
        policies: {
          ...UNSET,
          allowedModels: ["m1", "qwen3-*"],
          roleRouting: { chat: ["m2", "m1"] },
        },
      }),
      { bearer: undefined },
    );
    await user.click(card.getByLabelText("All models"));
    await user.clear(card.getByLabelText("Chat"));
    await user.click(card.getByRole("button", { name: "Save group" }));
    await card.findByText("Group saved.");
    expect(put).toHaveBeenLastCalledWith(
      "control",
      "/v1/permission-groups/g-sales",
      expect.objectContaining({ policies: UNSET }),
      { bearer: undefined },
    );
  });

  it("shows the models and routing a group sets (row 37)", async () => {
    const user = userEvent.setup();
    show([
      group("g-sales", "Sales", {
        policies: { ...UNSET, allowedModels: [], roleRouting: { chat: ["m2", "m1"] } },
      }),
    ]);
    const card = within(screen.getByTestId("group-g-sales"));
    expect(card.getByTestId("group-models-g-sales")).toHaveTextContent("Models: No models");
    expect(card.getByTestId("group-routing-g-sales")).toHaveTextContent(
      "Routing by role: Chat: m2, then m1. Other roles: install default",
    );
    await user.click(card.getByText("Edit Sales"));
    expect(card.getByLabelText("Only these models")).toBeChecked();
    expect(card.getByLabelText("Chat")).toHaveValue("m2, m1");
    expect(card.getByLabelText("Embeddings")).toHaveValue("");
  });
});

describe("a root from row 70 (row 37 review)", () => {
  const ROW_70 = { queueBand: null, summaryContextPercent: null };

  it("offers no Models or Routing by role, and sends neither", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    const user = userEvent.setup();
    show([group("g-desk", "Desk", { policies: ROW_70 })]);
    const card = within(screen.getByTestId("group-g-desk"));
    expect(card.queryByTestId("group-models-g-desk")).not.toBeInTheDocument();
    await user.click(card.getByText("Edit Desk"));
    expect(card.queryByLabelText("Only these models")).not.toBeInTheDocument();
    expect(card.queryByLabelText("Chat")).not.toBeInTheDocument();
    await user.selectOptions(card.getByLabelText("Queue priority"), "Background");
    await user.click(card.getByRole("button", { name: "Save group" }));
    await card.findByText("Group saved.");
    expect(put.mock.calls[0]?.[2]).toMatchObject({
      policies: { queueBand: "background", summaryContextPercent: null },
    });
    expect(Object.keys((put.mock.calls[0]?.[2] as { policies: object }).policies)).toEqual([
      "queueBand",
      "summaryContextPercent",
    ]);
    await user.click(screen.getByRole("button", { name: "Add group" }));
    const form = within(screen.getByTestId("group-new"));
    await user.type(form.getByLabelText("Group name"), "Batch");
    await user.click(form.getByRole("button", { name: "Create group" }));
    expect(Object.keys((post.mock.calls[0]?.[2] as { policies: object }).policies)).toEqual([
      "queueBand",
      "summaryContextPercent",
    ]);
  });
});

describe("the group a person works from (row 37)", () => {
  const groups = [
    group("g-sales", "Sales", { policies: UNSET }),
    group("g-ops", "Ops", { policies: UNSET }),
  ];
  const person = (extra: Partial<Person> = {}): Person => ({
    id: "p1",
    name: "Ada",
    disabled: false,
    createdAt: WHEN,
    passwordChangedAt: WHEN,
    groups: ["g-ops", "g-sales"],
    ...extra,
  });

  it("shows the first of their groups when they chose none, and saves a choice", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ActiveGroup person={person()} groups={groups} onSave={save} />);
    const select = screen.getByLabelText("Works with");
    expect(select).toHaveDisplayValue("The first of their groups (Ops)");
    await user.selectOptions(select, "Sales");
    await user.click(screen.getByRole("button", { name: "Save group choice" }));
    expect(save).toHaveBeenCalledWith("g-sales");
    await user.selectOptions(select, "The first of their groups (Ops)");
    await user.click(screen.getByRole("button", { name: "Save group choice" }));
    expect(save).toHaveBeenLastCalledWith(null);
  });

  it("shows the choice in effect, and nothing for one group or individual access", () => {
    const { unmount } = render(
      <ActiveGroup person={person({ activeGroup: "g-sales" })} groups={groups} onSave={vi.fn()} />,
    );
    expect(screen.getByLabelText("Works with")).toHaveDisplayValue("Sales");
    unmount();
    render(<ActiveGroup person={person({ groups: ["g-ops"] })} groups={groups} onSave={vi.fn()} />);
    expect(screen.queryByLabelText("Works with")).not.toBeInTheDocument();
  });
});

describe("a group's usage allowances (row 40)", () => {
  const ALLOWANCES_UNSET = {
    ...UNSET,
    tokensPerDay: null,
    tokensPerMonth: null,
    costPerMonthMicros: null,
  };

  it("are offered and saved, the spend as exact micro-dollars, by a root that knows them", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    const user = userEvent.setup();
    show([group("g-sales", "Sales", { policies: ALLOWANCES_UNSET })]);
    const card = within(screen.getByTestId("group-g-sales"));
    expect(card.getByTestId("group-allowances-g-sales")).toHaveTextContent("No limit");
    await user.click(card.getByText("Edit Sales"));
    await user.type(card.getByLabelText("Tokens a day"), "30");
    await user.type(card.getByLabelText("Spend a month"), "4.00");
    await user.click(card.getByRole("button", { name: "Save group" }));
    await card.findByText("Group saved.");
    expect(put).toHaveBeenLastCalledWith(
      "control",
      "/v1/permission-groups/g-sales",
      expect.objectContaining({
        policies: {
          ...ALLOWANCES_UNSET,
          tokensPerDay: 30,
          costPerMonthMicros: 4_000_000,
        },
      }),
      { bearer: undefined },
    );
  });

  it("are neither shown nor sent to a root before row 40", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    const user = userEvent.setup();
    show([group("g-desk", "Desk", { policies: UNSET })]);
    const card = within(screen.getByTestId("group-g-desk"));
    expect(card.queryByTestId("group-allowances-g-desk")).toBeNull();
    await user.click(card.getByText("Edit Desk"));
    expect(card.queryByTestId("group-allowance-fields")).toBeNull();
    await user.click(card.getByRole("button", { name: "Save group" }));
    await card.findByText("Group saved.");
    expect(put).toHaveBeenLastCalledWith(
      "control",
      "/v1/permission-groups/g-desk",
      expect.objectContaining({ policies: UNSET }),
      { bearer: undefined },
    );
  });
});
