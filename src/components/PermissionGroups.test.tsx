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
import type { PermissionGroup } from "@/lib/types";

import { PermissionGroups } from "./PermissionGroups";

const WHEN = "2026-10-21T00:00:00Z";
const UNSET = { queueBand: null, summaryContextPercent: null };

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
        policies: { queueBand: "background", summaryContextPercent: 70 },
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
        policies: { queueBand: "background", summaryContextPercent: 70 },
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
    show([group("g-odd", "Odd", { policies: { queueBand: null, summaryContextPercent: 72 } })]);
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
        policies: { queueBand: "sheddable", summaryContextPercent: null },
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
});
