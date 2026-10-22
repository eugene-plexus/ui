import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { FolderAccess } from "./FolderAccess";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.get).mockResolvedValue({ grants: [] });
  vi.mocked(api.post).mockResolvedValue({ state: "applying", message: "Applying folder access." });
});

it("defaults to read and confirms the account and everything before a grant", async () => {
  render(
    <FolderAccess
      target="node:box"
      app="workbench"
      account={"NT SERVICE\\Workbench"}
      initialPath={"D:\\Projects\\acme"}
    />,
  );
  await screen.findByText("Folders Workbench can open");
  expect(screen.getByLabelText("Access")).toHaveValue("read");
  fireEvent.click(screen.getByRole("button", { name: "Give access" }));
  expect(api.post).not.toHaveBeenCalled();
  expect(
    screen.getByText("New files in it follow the folder's permissions while access is on."),
  ).toBeTruthy();
  expect(
    screen.getByText(
      /Give NT SERVICE\\Workbench read access to D:\\Projects\\acme and everything in it/,
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Give access" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith("node:box", "/v1/apps/workbench/folder-access", {
      path: "D:\\Projects\\acme",
      mode: "read",
    }),
  );
});

it("reports write pending restart and changed permissions in the agent's words", async () => {
  vi.mocked(api.get).mockResolvedValue({
    grants: [
      {
        id: "a",
        path: "/srv/acme",
        mode: "write",
        state: "ready",
        restartNeeded: true,
        message: "Workbench restarts to write in /srv/acme. Answers running in it stop.",
      },
      {
        id: "b",
        path: "/srv/other",
        mode: "read",
        state: "changed_outside",
        message:
          "/srv/other's permissions were changed outside Eugene, so they were left as they are.",
      },
    ],
  });
  render(<FolderAccess target="agent" app="workbench" account="files" />);
  expect(await screen.findByText(/Answers running in it stop/)).toBeTruthy();
  expect(screen.getByText(/were left as they are/)).toBeTruthy();
  expect(screen.queryByText("/srv/acme · read and write · ready")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Restart Workbench" }));
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Restart Workbench" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith("agent", "/v1/apps/workbench/restart", {}),
  );
});

it("confirms the Linux file group that receives the ACL", async () => {
  render(
    <FolderAccess
      target="agent"
      app="workbench"
      account="eapp-123456789abc (the dynamic user of eugene-plexus-app@workbench.service)"
      initialPath="/srv/acme"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Give access" }));
  expect(await screen.findByText(/Give group eapp-123456789abc-files read access/)).toBeTruthy();
});
