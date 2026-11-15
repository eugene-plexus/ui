import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AdministrationGrants } from "./AdministrationGrants";
import { api } from "@/lib/api";

it("delegates independent capabilities and an explicit membership scope", async () => {
  const put = vi.spyOn(api, "put").mockResolvedValue({});
  const changed = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <AdministrationGrants
      person={{ id: "ada", name: "Ada", disabled: false, createdAt: "", passwordChangedAt: "" }}
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
      onChanged={changed}
    />,
  );
  expect(screen.getByRole("region", { name: "Administration permissions" })).toBeVisible();
  expect(screen.getByLabelText("Allow assigning members to Builders")).toBeVisible();
  expect(screen.getByText(/Grant only what/)).toHaveTextContent("Grant only what Ada needs.");
  await user.click(screen.getByRole("checkbox", { name: /^Manage accounts/ }));
  await user.click(screen.getByLabelText("Allow assigning members to Builders"));
  await user.click(screen.getByRole("button", { name: "Save administration access" }));
  await screen.findByText("Administration access saved.");
  expect(put).toHaveBeenCalledWith("control", "/v1/people/ada/administration", {
    managePeople: true,
    manageGroups: false,
    membershipGroups: ["builders"],
    operateModels: false,
    operateMachines: false,
    operationsMachines: null,
  });
  put.mockRestore();
});

it("gives operations powers on chosen machines and says what never comes with them", async () => {
  const put = vi.spyOn(api, "put").mockResolvedValue({});
  const user = userEvent.setup();
  render(
    <AdministrationGrants
      person={{ id: "dana", name: "Dana", disabled: false, createdAt: "", passwordChangedAt: "" }}
      groups={[]}
      machines={[{ name: "gpu-a", label: "Big GPU" }, { name: "gpu-b" }]}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  expect(screen.getByText(/Never: secrets, chats, sign-in keys/)).toBeVisible();
  expect(screen.getByText(/read machine logs/)).toBeVisible();
  await user.click(screen.getByRole("checkbox", { name: /^Models/ }));
  await user.click(screen.getByRole("radio", { name: "Only the machines I choose" }));
  await user.click(screen.getByLabelText("Allow running Big GPU"));
  await user.click(screen.getByRole("button", { name: "Save administration access" }));
  await screen.findByText("Administration access saved.");
  expect(put).toHaveBeenCalledWith("control", "/v1/people/dana/administration", {
    managePeople: false,
    manageGroups: false,
    membershipGroups: [],
    operateModels: true,
    operateMachines: false,
    operationsMachines: ["gpu-a"],
  });
  put.mockRestore();
});
