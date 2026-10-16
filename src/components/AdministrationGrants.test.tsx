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
  });
  put.mockRestore();
});
