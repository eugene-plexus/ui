import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NodeHelpers } from "./NodeHelpers";
import type { Person } from "@/lib/types";

const ada: Person = {
  id: "p-ada",
  name: "ada",
  displayName: "Ada",
  disabled: false,
  createdAt: "2026-10-04T00:00:00Z",
  passwordChangedAt: "2026-10-04T00:00:00Z",
  helperGrants: [],
};
const base = {
  node: "desktop",
  nodeKey: "key",
  enrolledAt: "now",
  enabled: true,
  ready: true,
  online: true,
  supported: true,
  account: "isolated-files",
  folders: [
    {
      id: "f1",
      name: "Notes",
      path: "C:\\Notes",
      identity: "identity",
      writable: false,
      ownerAccess: "none",
    },
  ],
};

function stub(helper = base) {
  const mutations: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (init?.method && init.method !== "GET") {
        mutations.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
        return new Response(JSON.stringify({}), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ helpers: [helper] }), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return mutations;
}

describe("central node folders", () => {
  beforeEach(() => sessionStorage.setItem("eugene-session-token", "test-token"));
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("starts each person with no access and saves only that person's chosen folders", async () => {
    const changes = stub();
    const changed = vi.fn(async () => {});
    render(<NodeHelpers people={[ada]} onChanged={changed} />);
    await screen.findByText(/desktop · Ready/);
    fireEvent.change(screen.getByLabelText("Folder access for"), { target: { value: "p-ada" } });
    const access = screen.getByLabelText("ada access to Notes on desktop");
    expect(access).toHaveValue("none");
    expect(
      within(access).queryByRole("option", { name: "Read and write text" }),
    ).not.toBeInTheDocument();
    fireEvent.change(access, { target: { value: "read" } });
    fireEvent.click(screen.getByRole("button", { name: "Save folder access" }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(changes).toEqual([
      {
        path: "/api/proxy/control/v1/people/p-ada",
        body: { helperGrants: [{ folderId: "f1", writable: false }] },
      },
    ]);
  });

  it("registers read-only folders without implicitly granting the owner access", async () => {
    const changes = stub();
    render(<NodeHelpers people={[]} onChanged={async () => {}} />);
    fireEvent.click(await screen.findByText(/desktop · Ready/));
    expect(screen.getByLabelText("Owner access to Notes on desktop")).toHaveValue("none");
    fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "Projects" } });
    fireEvent.change(screen.getByLabelText("Full folder path on desktop"), {
      target: { value: "C:\\Projects" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register folder" }));
    await waitFor(() => expect(changes).toHaveLength(1));
    expect(changes[0]?.body).toEqual({
      name: "Projects",
      path: "C:\\Projects",
      writable: false,
      ownerAccess: "none",
    });
  });

  it("shows unsupported file support in place and does not offer to enable it", async () => {
    stub({ ...base, enabled: false, ready: false, supported: false });
    render(<NodeHelpers people={[]} onChanged={async () => {}} />);
    fireEvent.click(await screen.findByText(/desktop · File support off/));
    expect(screen.getByRole("button", { name: "Enable file support" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("requires deliberate cleanup of grants from removed folders", async () => {
    const changes = stub();
    render(
      <NodeHelpers
        people={[{ ...ada, helperGrants: [{ folderId: "removed", writable: true }] }]}
        onChanged={async () => {}}
      />,
    );
    await screen.findByText(/desktop · Ready/);
    fireEvent.change(screen.getByLabelText("Folder access for"), { target: { value: "p-ada" } });
    expect(screen.getByRole("button", { name: "Save folder access" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Clear unavailable grants" }));
    fireEvent.click(screen.getByRole("button", { name: "Save folder access" }));
    await waitFor(() => expect(changes).toHaveLength(1));
    expect(changes[0]?.body).toEqual({ helperGrants: [] });
  });
});
