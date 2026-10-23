/**
 * Settings lists the programs an owner approved for Eugene's own account
 * (row 8, part 8c), on every machine, and takes one back with Remove.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExecApprovals } from "./ExecApprovals";

const ADA_S = {
  id: "a1",
  path: "/home/ada/bin/llama-server",
  account: "ada",
  accountUid: 501,
  sha256: "ab".repeat(32),
  chain: [],
  approvedAt: "2026-10-23T10:00:00Z",
  approvedBy: "operator",
};

let approvals: Record<string, unknown[]>;
let deleted: string[];

beforeEach(() => {
  approvals = { agent: [ADA_S], "node:Amish_Station": [] };
  deleted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const m = /^\/api\/proxy\/([^/]+)(\/.*)$/.exec(String(input));
      const target = m?.[1] ?? "";
      const path = m?.[2] ?? "";
      if (init?.method === "DELETE" && path.startsWith("/v1/exec-approvals/")) {
        deleted.push(`${target} ${path}`);
        approvals[target] = [];
        return new Response(null, { status: 204 });
      }
      if (path === "/v1/exec-approvals" && approvals[target]) {
        return new Response(JSON.stringify({ approvals: approvals[target] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const MACHINES = [
  { target: "agent", label: "This machine" },
  { target: "node:Amish_Station", label: "Amish_Station" },
];

describe("approved programs (row 8c)", () => {
  it("lists each approval with who can change the program, and Remove takes it back", async () => {
    render(<ExecApprovals machines={MACHINES} />);
    const card = await screen.findByTestId("exec-approvals");
    const row = within(card).getByTestId("exec-approval-row");
    expect(row).toHaveTextContent("/home/ada/bin/llama-server");
    expect(row).toHaveTextContent("This machine");
    expect(row).toHaveTextContent("ada can change it, and so act as Eugene");
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(deleted).toEqual(["agent /v1/exec-approvals/a1"]));
    await waitFor(() => expect(screen.queryByTestId("exec-approvals")).toBeNull());
  });

  it("shows nothing when no machine has an approval, or an agent has no such list", async () => {
    approvals = { agent: [] };
    render(<ExecApprovals machines={MACHINES} />);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(2));
    expect(screen.queryByTestId("exec-approvals")).toBeNull();
  });
});
