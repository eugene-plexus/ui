import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it } from "vitest";
import { PeopleDirectory } from "./PeopleDirectory";
import type { Person } from "@/lib/types";

const people: Person[] = Array.from({ length: 26 }, (_, index) => ({
  id: `p-${index + 1}`,
  name: `Member ${index + 1}`,
  email: `member${index + 1}@example.org`,
  disabled: index === 25,
  groups: index === 25 ? ["builders"] : [],
  createdAt: "",
  passwordChangedAt: "",
}));

function Editor({ person }: { person: Person }) {
  const [draft, setDraft] = useState(person.name);
  return (
    <input aria-label="Account draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
  );
}

function Directory({ members = people }: { members?: Person[] }) {
  return (
    <PeopleDirectory
      people={members}
      groups={[
        {
          id: "builders",
          name: "Builders",
          description: "",
          apps: [],
          permissions: [],
          createdAt: "",
          updatedAt: "",
        },
      ]}
      renderPerson={(person) => <Editor person={person} />}
    >
      <p>Directory tools</p>
    </PeopleDirectory>
  );
}

beforeEach(() => window.history.replaceState(null, "", "/people"));

it("pages the directory and opens only one editor, retaining page and drafts across refresh", async () => {
  const user = userEvent.setup();
  const view = render(<Directory />);
  expect(screen.getAllByRole("link", { name: /^Manage / })).toHaveLength(10);
  expect(screen.queryByLabelText("Account draft")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("11–20 of 26 people")).toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Manage Member 11" }));
  expect(window.location.hash).toBe("#person-p-11");
  expect(screen.getByText("Directory tools")).not.toBeVisible();
  await user.type(screen.getByLabelText("Account draft"), " draft");
  view.rerender(<Directory members={[...people]} />);
  expect(screen.getByLabelText("Account draft")).toHaveValue("Member 11 draft");
  await user.click(screen.getByRole("button", { name: /Back to people/ }));
  expect(screen.getByText("11–20 of 26 people")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Manage Member 11" })).toHaveFocus();
  await user.click(screen.getByRole("link", { name: "Manage Member 12" }));
  expect(screen.getByLabelText("Account draft")).toHaveValue("Member 12");
});

it("searches across all pages by email and group, filters status, and resets pagination", async () => {
  const user = userEvent.setup();
  render(<Directory />);
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByRole("searchbox"), "member26@");
  expect(screen.getByRole("link", { name: "Manage Member 26" })).toBeInTheDocument();
  expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  await user.clear(screen.getByRole("searchbox"));
  await user.type(screen.getByRole("searchbox"), "Builders");
  expect(screen.getAllByRole("link", { name: /^Manage / })).toHaveLength(1);
  await user.selectOptions(screen.getByLabelText("Account status"), "active");
  expect(screen.getByText("No people match these filters.")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Account status"), "disabled");
  await user.click(screen.getByRole("link", { name: "Manage Member 26" }));
  await user.click(screen.getByRole("button", { name: /Back to people/ }));
  expect(screen.getByRole("searchbox")).toHaveValue("Builders");
  expect(screen.getByLabelText("Account status")).toHaveValue("disabled");
});

it("clamps a page after deletions and supports choosing the page size", async () => {
  const user = userEvent.setup();
  const view = render(<Directory />);
  await user.selectOptions(screen.getByLabelText("Per page"), "25");
  expect(screen.getAllByRole("link", { name: /^Manage / })).toHaveLength(25);
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("26–26 of 26 people")).toBeInTheDocument();
  view.rerender(<Directory members={people.slice(0, 25)} />);
  expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(26);
});

it("opens existing person links and follows browser history without exposing other editors", async () => {
  window.history.replaceState(null, "", "/people#person-p-26");
  render(<Directory />);
  expect(await screen.findByLabelText("Account draft")).toHaveValue("Member 26");
  act(() => {
    window.history.replaceState(null, "", "/people#person-p-1");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(screen.getByLabelText("Account draft")).toHaveValue("Member 1");
  act(() => {
    window.history.replaceState(null, "", "/people");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(screen.queryByLabelText("Account draft")).not.toBeInTheDocument();
});

it("removes a deleted person's editor instead of switching silently to someone else", async () => {
  window.history.replaceState(null, "", "/people#person-p-1");
  const view = render(<Directory />);
  expect(await screen.findByLabelText("Account draft")).toBeInTheDocument();
  view.rerender(<Directory members={people.slice(1)} />);
  expect(screen.queryByLabelText("Account draft")).not.toBeInTheDocument();
  expect(screen.getByText(/This person was removed/)).toBeInTheDocument();
});
