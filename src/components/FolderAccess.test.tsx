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

it("asks the owner about access Eugene did not add, and says so when it is kept", async () => {
  // R23-UNKNOWN (Troy, 2026-10-24): prompt; Keep leaves it, and the card says so.
  vi.mocked(api.get).mockResolvedValue({
    grants: [
      {
        id: "g1",
        path: "/srv/acme",
        mode: "read",
        state: "incomplete",
        restartNeeded: false,
        message:
          "Workbench's account can still open /srv/acme/sub through an entry Eugene did not add.",
        unknown: [
          {
            id: "e1",
            path: "/srv/acme/sub",
            kind: "entry",
            entry: "group eapp-123456789abc-files has rwx, set outside Eugene",
            decision: "pending",
          },
        ],
      },
      {
        id: "g2",
        path: "/srv/old",
        mode: "read",
        state: "removed",
        restartNeeded: false,
        message: "Eugene's additions were removed.",
        unknown: [
          {
            id: "e2",
            path: "/srv/old/notes",
            kind: "entry",
            entry: "group eapp-123456789abc-files has r--, set outside Eugene",
            decision: "kept",
          },
        ],
      },
    ],
  });
  vi.mocked(api.post).mockResolvedValue({ state: "removed", message: "Done." });
  render(<FolderAccess target="agent" app="workbench" account="files" />);
  expect(
    await screen.findByText(
      "Workbench can still open /srv/acme/sub: group eapp-123456789abc-files has rwx, set outside Eugene. Eugene did not add this entry.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "Workbench can still open /srv/old/notes through an entry Eugene did not add: group eapp-123456789abc-files has r--, set outside Eugene.",
    ),
  ).toBeTruthy();
  // The kept entry asks nothing; the pending one offers both answers.
  expect(screen.getAllByRole("button", { name: "Keep it" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Remove this entry too" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      "agent",
      "/v1/apps/workbench/folder-access/g1/unknown/e1",
      { action: "remove" },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      "agent",
      "/v1/apps/workbench/folder-access/g1/unknown/e1",
      { action: "keep" },
    ),
  );
});

it("says why a file with another name waits, and does not blame an entry", async () => {
  vi.mocked(api.get).mockResolvedValue({
    grants: [
      {
        id: "g1",
        path: "/srv/acme",
        mode: "read",
        state: "incomplete",
        restartNeeded: false,
        message: "Workbench's account can still open /srv/acme/a.txt.",
        unknown: [
          {
            id: "e1",
            path: "/srv/acme/a.txt",
            kind: "hardlink",
            entry:
              "it has another name outside the folder, so changing it here changes it there too",
            decision: "pending",
          },
        ],
      },
    ],
  });
  vi.mocked(api.post).mockResolvedValue({ state: "removed", message: "Done." });
  render(<FolderAccess target="agent" app="workbench" account="files" />);
  expect(
    await screen.findByText(
      "Workbench can still open /srv/acme/a.txt: it has another name outside the folder, so changing it here changes it there too.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/Eugene did not add/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove access here and there" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      "agent",
      "/v1/apps/workbench/folder-access/g1/unknown/e1",
      { action: "remove" },
    ),
  );
});
